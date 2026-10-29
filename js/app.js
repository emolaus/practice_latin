/*
 * app.js - DOM wiring for practice_latin.html.
 */
(function () {
  'use strict';
  const PL = window.PL;

  const KEYS = {
    apiKey: 'pl.apiKey',
    model: 'pl.model',
    grammar: 'pl.grammar',
    // New keys for the markdown format, so a stale cached vocabulary.txt is not reused.
    vocabText: 'pl.vocabMd',
    vocabSource: 'pl.vocabMdSource',
    tutor: 'pl.tutorState',
    history: 'pl.history',
  };

  const VOCAB_FILE = 'vocabulary.md';

  const storage = (function () {
    try { localStorage.setItem('pl.test', '1'); localStorage.removeItem('pl.test'); return localStorage; }
    catch (e) { return null; }
  })();
  function sget(k) { try { return storage ? storage.getItem(k) : null; } catch (e) { return null; } }
  function sset(k, v) { try { storage && storage.setItem(k, v); } catch (e) { /* ignore */ } }
  function sdel(k) { try { storage && storage.removeItem(k); } catch (e) { /* ignore */ } }

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    apiKey: $('api-key'), toggleKey: $('toggle-key'), rememberKey: $('remember-key'),
    model: $('model-select'), refreshModels: $('refresh-models'), modelStatus: $('model-status'),
    vocabStatus: $('vocab-status'), vocabList: $('vocab-list'), vocabFile: $('vocab-file'), vocabDrop: $('vocab-drop'),
    grammar: $('grammar-options'), grammarReset: $('grammar-reset'),
    newSentence: $('new-sentence'), showAnswer: $('show-answer'), discussCurrent: $('discuss-current'),
    clearHistory: $('clear-history'),
    history: $('history'), form: $('answer-form'), answer: $('answer'), send: $('send'),
    discussionPanel: $('discussion-panel'), discussionTitle: $('discussion-title'),
    discussionContext: $('discussion-context'), discussionHistory: $('discussion-history'),
    discussionForm: $('discussion-form'), discussionInput: $('discussion-input'),
    discussionSend: $('discussion-send'), closeDiscussion: $('close-discussion'),
  };

  const client = new PL.OpenAIClient({ apiKey: '' });
  let vocabulary = [];
  let busy = false;
  let discussingBusy = false;
  let activeDiscussionId = null;
  const cardMap = {}; // contextId -> { card, body, badge, discussBtn }

  const history = PL.createHistoryStore(storage, KEYS.history);
  const tutor = new PL.Tutor({
    client: client,
    getModel: function () { return el.model.value; },
    getVocabulary: function () { return vocabulary; },
    getGrammar: selectedGrammar,
  });

  // ---------------------------------------------------------------- status
  function setStatus(node, text, kind) {
    node.textContent = text;
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ---------------------------------------------------------------- API key & models
  function initApiKey() {
    const saved = sget(KEYS.apiKey);
    if (saved) { el.apiKey.value = saved; el.rememberKey.checked = true; }
    client.apiKey = el.apiKey.value.trim();

    el.apiKey.addEventListener('input', function () {
      client.apiKey = el.apiKey.value.trim();
      persistKey();
    });
    el.apiKey.addEventListener('change', function () { if (client.apiKey) loadModels(); });
    el.rememberKey.addEventListener('change', persistKey);
    el.toggleKey.addEventListener('click', function () {
      const show = el.apiKey.type === 'password';
      el.apiKey.type = show ? 'text' : 'password';
      el.toggleKey.textContent = show ? 'Hide' : 'Show';
    });
  }

  function persistKey() {
    if (el.rememberKey.checked && client.apiKey) sset(KEYS.apiKey, client.apiKey);
    else sdel(KEYS.apiKey);
  }

  function fillModels(ids) {
    const saved = sget(KEYS.model);
    const list = ids.slice();
    if (saved && list.indexOf(saved) === -1 && !client.apiKey) list.unshift(saved);
    el.model.innerHTML = '';
    list.forEach(function (id) {
      const o = document.createElement('option');
      o.value = o.textContent = id;
      el.model.appendChild(o);
    });
    el.model.value = PL.pickDefaultModel(list, saved);
  }

  async function loadModels() {
    if (!client.apiKey) {
      setStatus(el.modelStatus, 'Enter your API key to load the models available to you.');
      return;
    }
    setStatus(el.modelStatus, 'Loading models…');
    try {
      const ids = PL.filterChatModels(await client.listModels());
      if (!ids.length) throw new Error('No chat models found for this key.');
      fillModels(ids);
      setStatus(el.modelStatus, ids.length + ' models available.', 'ok');
    } catch (e) {
      fillModels(PL.FALLBACK_MODELS);
      setStatus(el.modelStatus, e.message + ' Showing a default model list.', 'error');
    }
  }

  // ---------------------------------------------------------------- vocabulary
  function applyVocabulary(text, source, persist) {
    const entries = PL.parseVocabulary(text);
    vocabulary = entries;
    el.vocabList.innerHTML = '';
    PL.groupVocabulary(entries).forEach(function (group) {
      if (group.category) {
        const h = document.createElement('div');
        h.className = 'vocab-category';
        h.textContent = group.category;
        el.vocabList.appendChild(h);
      }
      const chips = document.createElement('div');
      chips.className = 'chips';
      group.words.forEach(function (w) {
        const c = document.createElement('span');
        c.className = 'chip';
        c.textContent = w;
        chips.appendChild(c);
      });
      el.vocabList.appendChild(chips);
    });
    if (!entries.length) {
      setStatus(el.vocabStatus,
        'The vocabulary file has no words. Add a heading such as "# Nouns" followed by one Latin word per line.',
        'error');
    } else {
      setStatus(el.vocabStatus, entries.length + ' words loaded from ' + source + '.', 'ok');
    }
    if (persist) {
      sset(KEYS.vocabText, text);
      sset(KEYS.vocabSource, source);
    }
  }

  /** Try to read ./vocabulary.md. Browsers often block this on file:// URLs. */
  function fetchVocabularyFile() {
    return new Promise(function (resolve, reject) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', VOCAB_FILE + '?t=' + Date.now(), true);
        xhr.overrideMimeType('text/plain; charset=utf-8');
        xhr.onload = function () {
          // status is 0 for successful file:// loads
          if ((xhr.status === 200 || xhr.status === 0) && xhr.responseText) resolve(xhr.responseText);
          else reject(new Error('status ' + xhr.status));
        };
        xhr.onerror = function () { reject(new Error('blocked')); };
        xhr.send();
      } catch (e) {
        reject(e);
      }
    });
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      applyVocabulary(String(reader.result), file.name + ' (' + new Date().toLocaleString() + ')', true);
    };
    reader.onerror = function () { setStatus(el.vocabStatus, 'Could not read ' + file.name + '.', 'error'); };
    reader.readAsText(file);
  }

  async function initVocabulary() {
    el.vocabFile.addEventListener('change', function () {
      if (el.vocabFile.files[0]) readFile(el.vocabFile.files[0]);
      el.vocabFile.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      el.vocabDrop.addEventListener(ev, function (e) { e.preventDefault(); el.vocabDrop.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      el.vocabDrop.addEventListener(ev, function (e) { e.preventDefault(); el.vocabDrop.classList.remove('dragover'); });
    });
    el.vocabDrop.addEventListener('drop', function (e) {
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    try {
      const text = await fetchVocabularyFile();
      applyVocabulary(text, VOCAB_FILE, true);
    } catch (e) {
      const cached = sget(KEYS.vocabText);
      if (cached) {
        applyVocabulary(cached, 'saved copy of ' + (sget(KEYS.vocabSource) || VOCAB_FILE), false);
        el.vocabStatus.textContent += ' Your browser blocked reading the file directly; choose the file again after editing it.';
      } else {
        setStatus(el.vocabStatus,
          'Your browser does not allow reading ' + VOCAB_FILE + ' automatically from disk. Please choose or drop the file below.',
          'error');
      }
    }
  }

  // ---------------------------------------------------------------- grammar
  function selectedGrammar() {
    return Array.prototype.map.call(
      el.grammar.querySelectorAll('input[type=checkbox]:checked'),
      function (cb) { return cb.value; });
  }

  function setGrammar(ids) {
    const set = new Set(ids);
    el.grammar.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = set.has(cb.value); });
  }

  function initGrammar() {
    PL.GRAMMAR_GROUPS.forEach(function (group) {
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = group.name;
      fs.appendChild(lg);
      const box = document.createElement('div');
      box.className = 'options';
      group.items.forEach(function (item) {
        const label = document.createElement('label');
        label.className = 'checkbox';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = item.id;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + item.label));
        box.appendChild(label);
      });
      fs.appendChild(box);
      el.grammar.appendChild(fs);
    });

    let saved = null;
    try { saved = JSON.parse(sget(KEYS.grammar)); } catch (e) { /* ignore */ }
    setGrammar(Array.isArray(saved) ? saved : PL.DEFAULT_GRAMMAR);

    el.grammar.addEventListener('change', function () { sset(KEYS.grammar, JSON.stringify(selectedGrammar())); });
    el.grammarReset.addEventListener('click', function () {
      setGrammar(PL.DEFAULT_GRAMMAR);
      sset(KEYS.grammar, JSON.stringify(PL.DEFAULT_GRAMMAR));
    });
  }

  // ---------------------------------------------------------------- challenge cards & chat log
  function getOrCreateCard(contextId) {
    if (cardMap[contextId]) return cardMap[contextId];

    const card = document.createElement('section');
    card.className = 'challenge-card';
    card.setAttribute('data-context-id', String(contextId));

    const header = document.createElement('div');
    header.className = 'challenge-header';

    const title = document.createElement('span');
    title.className = 'challenge-title';
    title.textContent = 'Challenge #' + contextId;
    header.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'context-badge';
    header.appendChild(badge);

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    header.appendChild(spacer);

    const discussBtn = document.createElement('button');
    discussBtn.type = 'button';
    discussBtn.className = 'secondary small discuss-btn';
    discussBtn.textContent = 'Discuss this challenge';
    discussBtn.addEventListener('click', function () { openDiscussion(contextId); });
    header.appendChild(discussBtn);

    const body = document.createElement('div');
    body.className = 'challenge-body';

    card.appendChild(header);
    card.appendChild(body);
    el.history.appendChild(card);

    cardMap[contextId] = { card: card, body: body, badge: badge, discussBtn: discussBtn };
    refreshCardStates();
    return cardMap[contextId];
  }

  function refreshCardStates() {
    const openId = tutor.hasOpenProblem() ? tutor.currentContextId : null;
    Object.keys(cardMap).forEach(function (k) {
      const id = Number(k);
      const info = cardMap[id];
      const isOpen = id === openId;
      const ch = tutor.getChallenge(id);
      const discCount = ch && ch.discussion ? Math.floor(ch.discussion.length / 2) : 0;

      info.card.classList.toggle('active', isOpen);
      info.card.classList.toggle('discussing', id === activeDiscussionId);
      info.badge.className = 'context-badge' + (isOpen ? ' active' : '');
      info.badge.textContent = isOpen
        ? 'Active API context'
        : 'Isolated context \u00b7 closed';
      info.discussBtn.textContent = discCount > 0
        ? 'Discuss (' + discCount + ')'
        : 'Discuss this challenge';
    });
  }

  function buildMessageBubble(entry) {
    const div = document.createElement('div');
    div.className = 'msg ' + (entry.role || 'system') + (entry.kind ? ' ' + entry.kind : '');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const who = entry.role === 'student' ? 'You' : entry.role === 'tutor' ? 'Tutor' : '';
    meta.textContent = (who ? who + ' \u00b7 ' : '') + new Date(entry.ts || Date.now()).toLocaleTimeString();
    div.appendChild(meta);
    const body = document.createElement('div');
    if (entry.kind === 'problem') {
      body.innerHTML = '<p>Translate into Latin:</p><p class="english">' + PL.escapeHtml(entry.text) + '</p>';
    } else if (entry.role === 'student') {
      body.innerHTML = '<p class="latin">' + PL.escapeHtml(entry.text) + '</p>';
    } else {
      body.innerHTML = PL.renderRichText(entry.text);
    }
    div.appendChild(body);
    return div;
  }

  function renderEntry(entry) {
    const div = buildMessageBubble(entry);
    const cid = entry.contextId || (entry.kind !== 'error' && tutor.currentContextId ? tutor.currentContextId : 0);
    if (cid) {
      const cardInfo = getOrCreateCard(cid);
      cardInfo.body.appendChild(div);
    } else {
      el.history.appendChild(div);
    }
    el.history.scrollTop = el.history.scrollHeight;
    return div;
  }

  function log(entry, persist) {
    if (!entry.contextId && tutor.currentContextId && entry.role !== 'system') {
      entry = Object.assign({ contextId: tutor.currentContextId }, entry);
    }
    const full = persist === false ? Object.assign({ ts: Date.now() }, entry) : history.add(entry);
    return renderEntry(full);
  }

  function pending(text, targetContainer) {
    const div = buildMessageBubble({ role: 'tutor', kind: 'pending', text: text });
    const container = targetContainer ||
      (tutor.currentContextId && cardMap[tutor.currentContextId] ? cardMap[tutor.currentContextId].body : el.history);
    container.appendChild(div);
    el.history.scrollTop = el.history.scrollHeight;
    return div;
  }

  function saveTutor() {
    sset(KEYS.tutor, JSON.stringify(tutor.serialize()));
    refreshCardStates();
  }

  // ---------------------------------------------------------------- discussion panel
  function openDiscussion(contextId) {
    const ch = tutor.getChallenge(contextId);
    if (!ch) return;
    activeDiscussionId = ch.id;
    el.discussionPanel.hidden = false;
    renderDiscussionPanel();
    refreshCardStates();
    el.discussionInput.focus();
  }

  function closeDiscussion() {
    activeDiscussionId = null;
    el.discussionPanel.hidden = true;
    refreshCardStates();
  }

  function renderDiscussionPanel() {
    if (!activeDiscussionId) return;
    const ch = tutor.getChallenge(activeDiscussionId);
    if (!ch) return;

    el.discussionTitle.textContent = 'Discuss Challenge #' + ch.id;

    const attemptsCount = (ch.attempts || []).length;
    let ctxHtml = '<p><strong>Challenge sentence:</strong> ' + PL.escapeHtml(ch.english) + '</p>';
    if (ch.solved && ch.latin) {
      ctxHtml += '<p><strong>Reference Latin:</strong> <span class="latin">' + PL.escapeHtml(ch.latin) + '</span></p>';
    }
    ctxHtml += '<p class="context-meta">' +
      (ch.solved ? 'Completed challenge' : 'Active challenge (in progress)') +
      ' \u00b7 ' + attemptsCount + (attemptsCount === 1 ? ' attempt' : ' attempts') +
      ' preloaded into this discussion context.</p>';
    el.discussionContext.innerHTML = ctxHtml;

    el.discussionHistory.innerHTML = '';
    if (!ch.discussion || !ch.discussion.length) {
      const intro = buildMessageBubble({
        role: 'system',
        text: 'This is a separate conversation context preloaded with **Challenge #' + ch.id + '** and your attempts so far. Ask anything about the grammar, vocabulary, endings, or alternative translations!',
      });
      el.discussionHistory.appendChild(intro);
    } else {
      ch.discussion.forEach(function (turn) {
        const bubble = buildMessageBubble({
          role: turn.role === 'user' ? 'student' : 'tutor',
          kind: 'discussion-msg',
          text: turn.content,
          ts: turn.ts,
        });
        if (turn.role === 'user') {
          // Student discussion questions are in English/mixed, so render rich text instead of all-italic Latin
          bubble.lastChild.innerHTML = PL.renderRichText(turn.content);
        }
        el.discussionHistory.appendChild(bubble);
      });
    }
    el.discussionHistory.scrollTop = el.discussionHistory.scrollHeight;
  }

  async function submitDiscussion() {
    if (discussingBusy || !activeDiscussionId) return;
    const question = el.discussionInput.value.trim();
    if (!question) return;

    const targetId = activeDiscussionId;
    discussingBusy = true;
    el.discussionSend.disabled = true;
    el.discussionInput.value = '';

    const userBubble = buildMessageBubble({ role: 'student', text: question });
    userBubble.lastChild.innerHTML = PL.renderRichText(question);
    el.discussionHistory.appendChild(userBubble);

    const p = buildMessageBubble({ role: 'tutor', kind: 'pending', text: 'Tutor is thinking…' });
    el.discussionHistory.appendChild(p);
    el.discussionHistory.scrollTop = el.discussionHistory.scrollHeight;

    try {
      await tutor.discuss(targetId, question);
      saveTutor();
      if (activeDiscussionId === targetId) renderDiscussionPanel();
    } catch (e) {
      p.remove();
      el.discussionInput.value = question;
      const errBubble = buildMessageBubble({ role: 'system', kind: 'error', text: e.message });
      el.discussionHistory.appendChild(errBubble);
      el.discussionHistory.scrollTop = el.discussionHistory.scrollHeight;
    } finally {
      discussingBusy = false;
      el.discussionSend.disabled = false;
      el.discussionInput.focus();
    }
  }

  // ---------------------------------------------------------------- actions
  function setBusy(b) {
    busy = b;
    [el.newSentence, el.showAnswer, el.send].forEach(function (x) { x.disabled = b; });
    if (!b) updateButtons();
  }

  function updateButtons() {
    el.showAnswer.disabled = busy || !tutor.hasOpenProblem();
    el.discussCurrent.disabled = !tutor.currentContextId || !tutor.getChallenge(tutor.currentContextId);
    refreshCardStates();
  }

  async function newSentence() {
    if (busy) return;
    setBusy(true);
    const p = pending('Starting a new challenge context…', el.history);
    try {
      const problem = await tutor.newProblem();
      p.remove();
      log({
        role: 'tutor',
        kind: 'problem',
        text: problem.english,
        latin: problem.latin,
        contextId: tutor.currentContextId,
      });
      saveTutor();
      el.answer.focus();
    } catch (e) {
      p.remove();
      log({ role: 'system', kind: 'error', text: e.message }, false);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (busy) return;
    const answer = el.answer.value.trim();
    if (!answer) return;
    if (!tutor.hasOpenProblem()) {
      log({ role: 'system', text: 'There is no open sentence. Click **New sentence** to get one.' }, false);
      return;
    }
    const cid = tutor.currentContextId;
    setBusy(true);
    log({ role: 'student', text: answer, contextId: cid });
    el.answer.value = '';
    const p = pending('Checking…');
    let correct = false;
    try {
      const ev = await tutor.submitAnswer(answer);
      p.remove();
      correct = ev.correct;
      log({ role: 'tutor', kind: ev.correct ? 'correct' : 'incorrect', text: ev.feedback, contextId: cid });
      saveTutor();
      if (activeDiscussionId === cid) renderDiscussionPanel();
    } catch (e) {
      p.remove();
      el.answer.value = answer;
      log({ role: 'system', kind: 'error', text: e.message, contextId: cid }, false);
    } finally {
      setBusy(false);
    }
    if (correct) {
      log({ role: 'system', text: 'Well done! Context closed — starting a fresh API context with a new sentence.', contextId: cid });
      await newSentence();
    } else {
      el.answer.focus();
    }
  }

  function showAnswer() {
    if (busy || !tutor.hasOpenProblem()) return;
    const cid = tutor.currentContextId;
    const latin = tutor.revealAnswer();
    log({
      role: 'tutor',
      kind: 'incorrect',
      contextId: cid,
      text: latin ? 'One correct translation is: **' + latin + '**\nClick New sentence to start a fresh context.'
        : 'Sorry, no reference translation is available. Click New sentence to start a fresh context.',
    });
    saveTutor();
    if (activeDiscussionId === cid) renderDiscussionPanel();
    updateButtons();
  }

  /**
   * Replay saved history entries into challenge cards and ensure `tutor` knows
   * about every challenge in the log (including legacy entries saved before
   * per-challenge contextIds were introduced).
   */
  function restoreHistoryAndChallenges(entries) {
    let currentId = 0;
    const byId = {};

    entries.forEach(function (entry) {
      if (entry.kind === 'problem') {
        currentId = entry.contextId || (currentId + 1);
        entry.contextId = currentId;
        byId[currentId] = {
          id: currentId,
          english: entry.text,
          latin: entry.latin || '',
          solved: true,
          attempts: [],
        };
      } else if (currentId && !entry.contextId) {
        entry.contextId = currentId;
      }

      if (entry.contextId && byId[entry.contextId]) {
        const snap = byId[entry.contextId];
        if (entry.role === 'student') {
          snap.attempts.push({ answer: entry.text, feedback: '', correct: false });
        } else if (entry.role === 'tutor' && (entry.kind === 'correct' || entry.kind === 'incorrect')) {
          const last = snap.attempts[snap.attempts.length - 1];
          if (last && !last.feedback) {
            last.feedback = entry.text;
            last.correct = entry.kind === 'correct';
          } else {
            snap.attempts.push({ answer: '', feedback: entry.text, correct: entry.kind === 'correct' });
          }
        }
      }
    });

    Object.keys(byId).forEach(function (k) {
      const snap = byId[k];
      if (tutor.hasOpenProblem() && tutor.currentContextId === snap.id) {
        snap.solved = false;
      }
      tutor.ensureChallenge(snap);
    });

    entries.forEach(renderEntry);
    refreshCardStates();
  }

  function initChat() {
    try { tutor.restore(JSON.parse(sget(KEYS.tutor))); } catch (e) { /* ignore */ }
    const entries = history.load();
    restoreHistoryAndChallenges(entries);

    if (!entries.length) {
      log({ role: 'system', text: 'Welcome! Paste your OpenAI API key, check your vocabulary and grammar choices, then click **New sentence**.' }, false);
    } else if (tutor.hasOpenProblem()) {
      log({ role: 'system', text: 'Welcome back! Continue with the active challenge above, or click **New sentence**.', contextId: tutor.currentContextId }, false);
    }

    el.newSentence.addEventListener('click', newSentence);
    el.showAnswer.addEventListener('click', showAnswer);
    el.discussCurrent.addEventListener('click', function () {
      if (tutor.currentContextId) openDiscussion(tutor.currentContextId);
    });
    el.closeDiscussion.addEventListener('click', closeDiscussion);
    el.discussionForm.addEventListener('submit', function (e) { e.preventDefault(); submitDiscussion(); });
    el.discussionInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitDiscussion(); }
    });
    el.form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    el.answer.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });
    el.clearHistory.addEventListener('click', function () {
      if (!confirm('Clear the whole conversation history?')) return;
      history.clear();
      tutor.restore({});
      sdel(KEYS.tutor);
      Object.keys(cardMap).forEach(function (k) { delete cardMap[k]; });
      closeDiscussion();
      el.history.innerHTML = '';
      updateButtons();
    });
    el.model.addEventListener('change', function () { sset(KEYS.model, el.model.value); });
    el.refreshModels.addEventListener('click', loadModels);
    updateButtons();
  }

  // ---------------------------------------------------------------- start
  initApiKey();
  fillModels(PL.FALLBACK_MODELS);
  initGrammar();
  initChat();
  initVocabulary();
  loadModels();
})();
