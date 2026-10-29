/* Unit tests for js/core.js */
(function () {
  const PL = window.PL;

  // ---- vocabulary
  function words(entries) { return entries.map(function (e) { return e.word; }); }

  test('parseVocabulary: headings become categories (shipped vocabulary.md format)', function () {
    const text = '# Nouns\r\nagricola\r\naqua\r\n\r\n# Verbs\r\namo\r\nsum';
    assert.deepEqual(PL.parseVocabulary(text), [
      { word: 'agricola', category: 'Nouns' },
      { word: 'aqua', category: 'Nouns' },
      { word: 'amo', category: 'Verbs' },
      { word: 'sum', category: 'Verbs' },
    ]);
  });

  test('parseVocabulary: any heading level, trailing #s and whitespace', function () {
    const entries = PL.parseVocabulary('## Adjectives ##\n  bonus  \n###   Adverbs\nbene\n');
    assert.deepEqual(entries, [
      { word: 'bonus', category: 'Adjectives' },
      { word: 'bene', category: 'Adverbs' },
    ]);
  });

  test('parseVocabulary: words before any heading are uncategorised', function () {
    assert.deepEqual(PL.parseVocabulary('dea\n# Nouns\nnauta'), [
      { word: 'dea', category: '' },
      { word: 'nauta', category: 'Nouns' },
    ]);
  });

  test('parseVocabulary: markdown list markers are stripped, whole line kept', function () {
    const text = '# Verbs\n- amo, amare - to love\n* fugo\n+ porto\n1. sum';
    assert.deepEqual(words(PL.parseVocabulary(text)), ['amo, amare - to love', 'fugo', 'porto', 'sum']);
  });

  test('parseVocabulary: HTML comments, BOM, empty headings and duplicates', function () {
    const text = '\uFEFF<!-- my list -->\n# Nouns\nnauta <!-- sailor -->\n#\nNauta\nsilva\n';
    assert.deepEqual(PL.parseVocabulary(text), [
      { word: 'nauta', category: 'Nouns' },
      { word: 'silva', category: 'Nouns' },
    ]);
  });

  test('parseVocabulary: a "#word" without a space is not a heading but is skipped', function () {
    assert.deepEqual(words(PL.parseVocabulary('#hashtag\namo')), ['amo']);
  });

  test('parseVocabulary: non-string input gives empty list', function () {
    assert.deepEqual(PL.parseVocabulary(undefined), []);
    assert.deepEqual(PL.parseVocabulary(''), []);
    assert.deepEqual(PL.parseVocabulary('# Nouns\n\n# Verbs\n'), []);
  });

  test('groupVocabulary groups by category in first-seen order and accepts strings', function () {
    const groups = PL.groupVocabulary([
      { word: 'nauta', category: 'Nouns' },
      { word: 'amo', category: 'Verbs' },
      { word: 'silva', category: 'Nouns' },
      'dea',
    ]);
    assert.deepEqual(groups, [
      { category: 'Nouns', words: ['nauta', 'silva'] },
      { category: 'Verbs', words: ['amo'] },
      { category: '', words: ['dea'] },
    ]);
    assert.deepEqual(PL.groupVocabulary(undefined), []);
  });

  // ---- grammar
  test('DEFAULT_GRAMMAR: Nominative, Accusative, Genitive, Singular, Plural, Present, Indicative', function () {
    assert.deepEqual(PL.DEFAULT_GRAMMAR.slice().sort(),
      ['accusative', 'genitive', 'indicative', 'nominative', 'plural', 'present', 'singular']);
  });

  test('all grammar ids are unique and defaults exist', function () {
    const ids = [];
    PL.GRAMMAR_GROUPS.forEach(function (g) { g.items.forEach(function (i) { ids.push(i.id); }); });
    assert.equal(new Set(ids).size, ids.length, 'unique ids');
    PL.DEFAULT_GRAMMAR.forEach(function (id) { assert.ok(ids.indexOf(id) !== -1, id + ' exists'); });
  });

  test('describeGrammar groups labels by category in display order', function () {
    assert.deepEqual(PL.describeGrammar(['plural', 'genitive', 'accusative', 'singular']),
      ['Case: Genitive, Accusative', 'Number: Singular, Plural']);
    assert.deepEqual(PL.describeGrammar([]), []);
  });

  // ---- prompts
  test('buildSystemPrompt contains vocabulary, grammar, English-only and JSON rules', function () {
    const p = PL.buildSystemPrompt(['nauta', 'silva'], ['accusative', 'plural']);
    assert.includes(p, '- nauta');
    assert.includes(p, '- silva');
    assert.includes(p, 'Case: Accusative');
    assert.includes(p, 'Number: Plural');
    assert.includes(p, 'Always communicate in English');
    assert.includes(p, '**double asterisks**');
    assert.includes(p, 'JSON');
  });

  test('buildSystemPrompt lists vocabulary under its categories', function () {
    const p = PL.buildSystemPrompt(PL.parseVocabulary('# Nouns\nnauta\n# Verbs\namo'), ['accusative']);
    assert.includes(p, 'Nouns:\n- nauta\nVerbs:\n- amo');
  });

  test('buildSystemPrompt asks for a single short statement or question, not compound sentences', function () {
    const p = PL.buildSystemPrompt(['nauta'], ['accusative', 'genitive']);
    assert.includes(p, 'exactly ONE short, simple sentence (either a statement or a question)');
    assert.includes(p, 'interrogative words');
    assert.includes(p, 'No semicolons');
    assert.includes(p, '"The island\'s goddess loves the country\'s waters."');
    assert.includes(p, '"Who loves the farmer\'s daughter?"');
    assert.includes(p, 'do not try to fit them all into one sentence');
    assert.ok(p.indexOf('as many of these as is natural') === -1, 'old "as many as possible" instruction removed');
  });

  test('buildNewProblemMessage repeats the single-sentence and question rules', function () {
    const m = PL.buildNewProblemMessage([]);
    assert.includes(m, 'one new English challenge sentence');
    assert.includes(m, 'single short statement or question');
    assert.includes(m, 'interrogative words');
  });

  test('buildNewProblemMessage asks for JSON and lists recent sentences', function () {
    const m = PL.buildNewProblemMessage(['The sailor loves the forest.']);
    assert.includes(m, '"english"');
    assert.includes(m, '"latin"');
    assert.includes(m, '- The sailor loves the forest.');
    assert.ok(PL.buildNewProblemMessage([]).indexOf('Do not repeat') === -1);
  });

  test('pickChallengeHint picks statements and questions with different interrogative words and vocabulary', function () {
    const vocab = PL.parseVocabulary('# Nouns\nagricola\naqua\nfilia\n# Verbs\namo\nporto\n# Interrogative pronouns\nquid\nquis');
    const seq1 = [0.1, 0.0, 0.5, 0.9];
    const hQ1 = PL.pickChallengeHint(vocab, function () { return seq1.shift(); });
    assert.equal(hQ1.kind, 'question');
    assert.equal(hQ1.interrogative, 'quid');
    assert.deepEqual(hQ1.picks, [
      { category: 'Nouns', words: ['aqua'] },
      { category: 'Verbs', words: ['porto'] },
    ]);

    const seq2 = [0.39, 0.9, 0.0, 0.0];
    const hQ2 = PL.pickChallengeHint(vocab, function () { return seq2.shift(); });
    assert.equal(hQ2.kind, 'question');
    assert.equal(hQ2.interrogative, 'quis');

    const seq3 = [0.4, 0.0, 0.5, 0.0];
    const hS = PL.pickChallengeHint(vocab, function () { return seq3.shift(); });
    assert.equal(hS.kind, 'statement');
    assert.equal(hS.interrogative, null);
    assert.deepEqual(hS.picks, [
      { category: 'Nouns', words: ['agricola', 'filia'] },
      { category: 'Verbs', words: ['amo'] },
    ]);

    const noQ = PL.parseVocabulary('# Nouns\nnauta\n# Verbs\namo');
    assert.equal(PL.pickChallengeHint(noQ, function () { return 0.0; }).kind, 'statement');
  });

  test('buildNewProblemMessage formats question and statement hints', function () {
    const qMsg = PL.buildNewProblemMessage([], {
      kind: 'question',
      interrogative: 'quis',
      picks: [{ category: 'Nouns', words: ['aqua'] }, { category: 'Verbs', words: ['porto'] }],
    });
    assert.includes(qMsg, 'QUESTION that uses **quis**');
    assert.includes(qMsg, '**aqua**');
    assert.includes(qMsg, '**porto**');

    const sMsg = PL.buildNewProblemMessage([], {
      kind: 'statement',
      interrogative: null,
      picks: [{ category: 'Nouns', words: ['filia', 'aqua'] }, { category: 'Verbs', words: ['porto'] }],
    });
    assert.includes(sMsg, 'STATEMENT (not a question)');
    assert.includes(sMsg, '**filia**, **aqua**');
  });

  test('buildAnswerMessage includes the answer and asks for hints without the solution', function () {
    const m = PL.buildAnswerMessage('nautae aquam amant');
    assert.includes(m, 'nautae aquam amant');
    assert.includes(m, '"correct"');
    assert.includes(m, 'do NOT reveal');
  });

  test('buildDiscussionSystemPrompt & buildDiscussionMessages preload challenge context and discussion turns', function () {
    const vocab = PL.parseVocabulary('# Nouns\nnauta\nsilva\n# Verbs\namo');
    const challenge = {
      id: 1,
      english: 'The sailors love the forests.',
      latin: 'Nautae silvas amant.',
      solved: false,
      attempts: [
        { answer: 'Nauta silvas amat', feedback: '- **nauta** should be plural', correct: false },
      ],
    };
    const msgs = PL.buildDiscussionMessages(vocab, ['accusative', 'plural'], challenge, [
      { role: 'user', content: 'Why is nauta plural here?' },
    ]);
    assert.equal(msgs[0].role, 'system');
    assert.includes(msgs[0].content, 'Do NOT wrap your reply in JSON');
    assert.includes(msgs[0].content, 'The sailors love the forests.');
    assert.includes(msgs[0].content, '**Nautae silvas amant.**');
    assert.includes(msgs[0].content, 'still working on this challenge');
    assert.equal(msgs[1].role, 'assistant');
    assert.includes(msgs[1].content, 'The sailors love the forests.');
    assert.equal(msgs[2].role, 'user');
    assert.includes(msgs[2].content, 'Nauta silvas amat');
    assert.equal(msgs[3].role, 'assistant');
    assert.includes(msgs[3].content, '**nauta** should be plural');
    assert.equal(msgs[4].role, 'user');
    assert.equal(msgs[4].content, 'Why is nauta plural here?');

    // Solved challenge mentions completed status
    const solvedPrompt = PL.buildDiscussionSystemPrompt(vocab, ['accusative'], Object.assign({}, challenge, { solved: true }));
    assert.includes(solvedPrompt, 'already been completed');
  });

  // ---- reply parsing
  test('parseJsonReply: plain JSON', function () {
    assert.deepEqual(PL.parseJsonReply('{"a":1}'), { a: 1 });
  });

  test('parseJsonReply: JSON inside code fences / chatter', function () {
    assert.deepEqual(PL.parseJsonReply('Sure!\n```json\n{"english":"Hi"}\n```'), { english: 'Hi' });
  });

  test('parseJsonReply: garbage throws', function () {
    assert.throws(function () { PL.parseJsonReply('no json here'); }, /JSON/);
    assert.throws(function () { PL.parseJsonReply(null); });
  });

  test('validateProblem trims and requires english', function () {
    assert.deepEqual(PL.validateProblem({ english: ' The girl. ', latin: ' Puella. ' }),
      { english: 'The girl.', latin: 'Puella.' });
    assert.deepEqual(PL.validateProblem({ english: 'X' }), { english: 'X', latin: '' });
    assert.throws(function () { PL.validateProblem({ latin: 'x' }); });
    assert.throws(function () { PL.validateProblem({ english: '  ' }); });
  });

  test('validateEvaluation handles booleans, strings and missing feedback', function () {
    assert.deepEqual(PL.validateEvaluation({ correct: true, feedback: 'Bene!' }), { correct: true, feedback: 'Bene!' });
    assert.equal(PL.validateEvaluation({ correct: 'true' }).correct, true);
    assert.equal(PL.validateEvaluation({ correct: 'false', feedback: 'x' }).correct, false);
    assert.ok(PL.validateEvaluation({ correct: false }).feedback.length > 0);
    assert.throws(function () { PL.validateEvaluation({ feedback: 'x' }); });
  });

  // ---- models
  test('filterChatModels keeps chat models only, sorted and unique', function () {
    const ids = ['whisper-1', 'gpt-4o', 'gpt-4o-mini', 'text-embedding-3-small', 'gpt-4o-realtime-preview',
      'o3-mini', 'dall-e-3', 'gpt-4o', 'tts-1', 'gpt-4o-mini-tts', 'gpt-image-1', 'chatgpt-4o-latest', 'davinci-002'];
    assert.deepEqual(PL.filterChatModels(ids), ['chatgpt-4o-latest', 'gpt-4o', 'gpt-4o-mini', 'o3-mini']);
  });

  test('pickDefaultModel prefers saved, then preferred list, then first', function () {
    assert.equal(PL.pickDefaultModel(['gpt-4o', 'o3'], 'o3'), 'o3');
    assert.equal(PL.pickDefaultModel(['gpt-4o', 'gpt-4o-mini'], 'gone'), 'gpt-4o-mini');
    assert.equal(PL.pickDefaultModel(['zzz', 'aaa'], null), 'zzz');
    assert.equal(PL.pickDefaultModel([], null), '');
  });

  test('gpt-6-luna is the default model when available, and in the fallback list', function () {
    assert.equal(PL.pickDefaultModel(['gpt-4o', 'gpt-5-mini', 'gpt-6-luna'], null), 'gpt-6-luna');
    assert.equal(PL.pickDefaultModel(PL.FALLBACK_MODELS, null), 'gpt-6-luna');
    assert.equal(PL.FALLBACK_MODELS[0], 'gpt-6-luna');
    assert.deepEqual(PL.filterChatModels(['gpt-6-luna']), ['gpt-6-luna'], 'not filtered out');
  });

  // ---- rendering
  test('escapeHtml escapes special characters', function () {
    assert.equal(PL.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });

  test('renderRichText highlights Latin in bold and builds lists', function () {
    const html = PL.renderRichText('Mistakes:\n- **nauta** should be plural\n- check *case*');
    assert.includes(html, '<p>Mistakes:</p>');
    assert.includes(html, '<ul><li><strong class="latin">nauta</strong> should be plural</li>');
    assert.includes(html, '<em>case</em></li></ul>');
  });

  test('renderRichText is XSS-safe', function () {
    const html = PL.renderRichText('<img src=x onerror=alert(1)> **<b>x</b>**');
    assert.ok(html.indexOf('<img') === -1);
    assert.ok(html.indexOf('<b>') === -1);
  });

  // ---- history store
  function memoryStorage() {
    const data = {};
    return {
      getItem: function (k) { return k in data ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      _data: data,
    };
  }

  test('history store adds, loads, caps and clears entries', function () {
    const s = memoryStorage();
    const h = PL.createHistoryStore(s, 'h', 3);
    assert.deepEqual(h.load(), []);
    for (let i = 0; i < 5; i++) h.add({ role: 'student', text: 'm' + i });
    const entries = h.load();
    assert.equal(entries.length, 3);
    assert.equal(entries[0].text, 'm2');
    assert.ok(typeof entries[0].ts === 'number');
    h.clear();
    assert.deepEqual(h.load(), []);
  });

  test('history store survives corrupt storage and missing storage', function () {
    const s = memoryStorage();
    s.setItem('h', '{not json');
    assert.deepEqual(PL.createHistoryStore(s, 'h').load(), []);
    const h = PL.createHistoryStore(null, 'h');
    h.add({ text: 'x' });
    assert.deepEqual(h.load(), []);
  });
})();
