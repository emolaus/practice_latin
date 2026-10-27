/*
 * core.js - Pure, DOM-free logic for Practice Latin.
 *
 * Everything in here is deterministic and side-effect free (apart from the
 * history store, which writes to an injected Storage object), so it can be
 * unit tested in tests/index.html.
 *
 * Loaded as a classic script (ES modules are blocked on file:// URLs), so all
 * exports are attached to the global `PL` namespace.
 */
(function (root) {
  'use strict';

  /** Grammar forms the user can toggle. `id` is stable and used in storage. */
  const GRAMMAR_GROUPS = [
    {
      name: 'Case',
      items: [
        { id: 'nominative', label: 'Nominative' },
        { id: 'genitive', label: 'Genitive' },
        { id: 'dative', label: 'Dative' },
        { id: 'accusative', label: 'Accusative' },
        { id: 'ablative', label: 'Ablative' },
        { id: 'vocative', label: 'Vocative' },
      ],
    },
    {
      name: 'Number',
      items: [
        { id: 'singular', label: 'Singular' },
        { id: 'plural', label: 'Plural' },
      ],
    },
    {
      name: 'Tense',
      items: [
        { id: 'present', label: 'Present' },
        { id: 'imperfect', label: 'Imperfect' },
        { id: 'future', label: 'Future' },
        { id: 'perfect', label: 'Perfect' },
        { id: 'pluperfect', label: 'Pluperfect' },
        { id: 'futureperfect', label: 'Future perfect' },
      ],
    },
    {
      name: 'Person',
      items: [
        { id: 'person1', label: '1st person' },
        { id: 'person2', label: '2nd person' },
        { id: 'person3', label: '3rd person' },
      ],
    },
    {
      name: 'Mood & voice',
      items: [
        { id: 'indicative', label: 'Indicative' },
        { id: 'imperative', label: 'Imperative' },
        { id: 'infinitive', label: 'Infinitive' },
        { id: 'passive', label: 'Passive voice' },
      ],
    },
  ];

  const DEFAULT_GRAMMAR = ['accusative', 'genitive', 'singular', 'plural'];

  /** Used when the model list cannot be fetched from the API. */
  const FALLBACK_MODELS = ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'];

  /** Preferred default models, best first (cheap + capable enough). */
  const PREFERRED_MODELS = ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5', 'gpt-4.1', 'gpt-4o'];

  /**
   * Parse the contents of vocabulary.txt.
   * - One entry per line; the whole line is kept (e.g. "amo, amare - to love").
   * - Text after '#' is a comment. Blank lines are ignored.
   * - Duplicates (case-insensitive) are removed, first occurrence wins.
   */
  function parseVocabulary(text) {
    if (typeof text !== 'string') return [];
    const seen = new Set();
    const out = [];
    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach(function (line) {
      const clean = line.replace(/#.*$/, '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(clean);
    });
    return out;
  }

  /** Map grammar ids to human readable labels grouped by category. */
  function describeGrammar(ids) {
    const selected = new Set(ids || []);
    const parts = [];
    GRAMMAR_GROUPS.forEach(function (group) {
      const labels = group.items.filter(function (i) { return selected.has(i.id); })
        .map(function (i) { return i.label; });
      if (labels.length) parts.push(group.name + ': ' + labels.join(', '));
    });
    return parts;
  }

  function buildSystemPrompt(vocabulary, grammarIds) {
    const grammar = describeGrammar(grammarIds);
    return [
      'You are a patient, encouraging Latin tutor helping a student practise translating English sentences into Latin.',
      '',
      'Language rules:',
      '- Always communicate in English.',
      '- Use Latin only when quoting or highlighting specific Latin words; wrap every Latin word or phrase in **double asterisks**.',
      '',
      'Vocabulary - the Latin sentence must use ONLY these Latin words (in any inflected form):',
      vocabulary.map(function (w) { return '- ' + w; }).join('\n'),
      '',
      'Grammar forms to practise (each sentence should exercise as many of these as is natural):',
      grammar.map(function (g) { return '- ' + g; }).join('\n'),
      'Other forms may appear only when strictly necessary to form a grammatical sentence (for example a nominative subject or a present tense verb).',
      '',
      'Marking rules:',
      '- Ignore missing or extra macrons, capitalisation and punctuation.',
      '- Accept any grammatically correct Latin word order.',
      '- Accept any correct translation, not only your reference translation.',
      '',
      'Always reply with a single JSON object and nothing else.',
    ].join('\n');
  }

  function buildNewProblemMessage(recentSentences) {
    const lines = [
      'Create a new English sentence for me to translate into Latin.',
      'Reply as JSON: {"english": "<the English sentence>", "latin": "<your reference Latin translation>"}.',
    ];
    if (recentSentences && recentSentences.length) {
      lines.push('Do not repeat any of these recent sentences:');
      recentSentences.forEach(function (s) { lines.push('- ' + s); });
    }
    return lines.join('\n');
  }

  function buildAnswerMessage(answer) {
    return [
      'My Latin translation: ' + answer,
      '',
      'Check it. Reply as JSON: {"correct": true|false, "feedback": "<text>"}.',
      'If it is correct, give brief praise (and optionally mention a valid alternative).',
      'If it is not correct, list each mistake as a separate "- " bullet with a helpful hint (which word, what case/number/ending is needed and why), but do NOT reveal the full correct sentence.',
    ].join('\n');
  }

  /** Extract a JSON object from a model reply, tolerating code fences or chatter. */
  function parseJsonReply(text) {
    if (typeof text !== 'string') throw new Error('Empty reply from model.');
    try {
      return JSON.parse(text);
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch (e2) { /* fall through */ }
      }
    }
    throw new Error('Could not understand the model reply (expected JSON).');
  }

  function validateProblem(obj) {
    if (!obj || typeof obj.english !== 'string' || !obj.english.trim()) {
      throw new Error('Model reply did not contain an English sentence.');
    }
    return {
      english: obj.english.trim(),
      latin: typeof obj.latin === 'string' ? obj.latin.trim() : '',
    };
  }

  function validateEvaluation(obj) {
    if (!obj || !('correct' in obj)) throw new Error('Model reply did not say whether the answer was correct.');
    const c = obj.correct;
    const correct = c === true || (typeof c === 'string' && c.trim().toLowerCase() === 'true');
    const feedback = typeof obj.feedback === 'string' && obj.feedback.trim()
      ? obj.feedback.trim()
      : (correct ? 'Correct!' : 'Not quite - try again.');
    return { correct: correct, feedback: feedback };
  }

  /** Keep only models usable for text chat completions. */
  function filterChatModels(ids) {
    const include = /^(gpt-|o\d|chatgpt-)/i;
    const exclude = /(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex|dall-e|whisper)/i;
    return Array.from(new Set(ids || []))
      .filter(function (id) { return include.test(id) && !exclude.test(id); })
      .sort();
  }

  function pickDefaultModel(ids, saved) {
    if (!ids || !ids.length) return '';
    if (saved && ids.indexOf(saved) !== -1) return saved;
    for (let i = 0; i < PREFERRED_MODELS.length; i++) {
      if (ids.indexOf(PREFERRED_MODELS[i]) !== -1) return PREFERRED_MODELS[i];
    }
    return ids[0];
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong class="latin">$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  }

  /**
   * Render a tiny, safe subset of markdown: **bold** (Latin highlight),
   * *italic*, "- " bullet lists and line breaks. All input is HTML-escaped.
   */
  function renderRichText(text) {
    const lines = String(text || '').split(/\r?\n/);
    let html = '';
    let inList = false;
    lines.forEach(function (line) {
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      if (bullet) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + renderInline(bullet[1]) + '</li>';
        return;
      }
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += '<p>' + renderInline(line) + '</p>';
    });
    if (inList) html += '</ul>';
    return html;
  }

  /**
   * Persistent conversation history (what the user sees in the chat log).
   * `storage` is any object with getItem/setItem/removeItem (e.g. localStorage).
   */
  function createHistoryStore(storage, key, maxEntries) {
    key = key || 'pl.history';
    maxEntries = maxEntries || 500;
    function load() {
      try {
        const raw = storage && storage.getItem(key);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        return [];
      }
    }
    function save(entries) {
      try { storage && storage.setItem(key, JSON.stringify(entries)); } catch (e) { /* quota etc. */ }
    }
    return {
      load: load,
      add: function (entry) {
        const entries = load();
        const full = Object.assign({ ts: Date.now() }, entry);
        entries.push(full);
        save(entries.slice(-maxEntries));
        return full;
      },
      clear: function () {
        try { storage && storage.removeItem(key); } catch (e) { /* ignore */ }
      },
    };
  }

  root.PL = root.PL || {};
  Object.assign(root.PL, {
    GRAMMAR_GROUPS: GRAMMAR_GROUPS,
    DEFAULT_GRAMMAR: DEFAULT_GRAMMAR,
    FALLBACK_MODELS: FALLBACK_MODELS,
    parseVocabulary: parseVocabulary,
    describeGrammar: describeGrammar,
    buildSystemPrompt: buildSystemPrompt,
    buildNewProblemMessage: buildNewProblemMessage,
    buildAnswerMessage: buildAnswerMessage,
    parseJsonReply: parseJsonReply,
    validateProblem: validateProblem,
    validateEvaluation: validateEvaluation,
    filterChatModels: filterChatModels,
    pickDefaultModel: pickDefaultModel,
    escapeHtml: escapeHtml,
    renderRichText: renderRichText,
    createHistoryStore: createHistoryStore,
  });
})(typeof window !== 'undefined' ? window : globalThis);

