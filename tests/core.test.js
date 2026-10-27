/* Unit tests for js/core.js */
(function () {
  const PL = window.PL;

  // ---- vocabulary
  test('parseVocabulary: one word per line, CRLF, blank lines', function () {
    assert.deepEqual(PL.parseVocabulary('dea\r\nnauta\r\n\r\n  silva  \n'), ['dea', 'nauta', 'silva']);
  });

  test('parseVocabulary: comments, BOM and duplicates', function () {
    const text = '\uFEFF# my words\namo, amare - to love  # verb\nAmo, amare - to love\nfugo\n';
    assert.deepEqual(PL.parseVocabulary(text), ['amo, amare - to love', 'fugo']);
  });

  test('parseVocabulary: non-string input gives empty list', function () {
    assert.deepEqual(PL.parseVocabulary(undefined), []);
    assert.deepEqual(PL.parseVocabulary(''), []);
  });

  test('parseVocabulary: handles the shipped vocabulary.txt format (no trailing newline)', function () {
    const text = 'dea\r\nnauta\r\nacricola\r\npuella\r\nsilva\r\namo\r\nfugo';
    assert.equal(PL.parseVocabulary(text).length, 7);
  });

  // ---- grammar
  test('DEFAULT_GRAMMAR is Accusative, Genitive, Singular, Plural', function () {
    assert.deepEqual(PL.DEFAULT_GRAMMAR.slice().sort(), ['accusative', 'genitive', 'plural', 'singular']);
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

  test('buildNewProblemMessage asks for JSON and lists recent sentences', function () {
    const m = PL.buildNewProblemMessage(['The sailor loves the forest.']);
    assert.includes(m, '"english"');
    assert.includes(m, '"latin"');
    assert.includes(m, '- The sailor loves the forest.');
    assert.ok(PL.buildNewProblemMessage([]).indexOf('Do not repeat') === -1);
  });

  test('buildAnswerMessage includes the answer and asks for hints without the solution', function () {
    const m = PL.buildAnswerMessage('nautae aquam amant');
    assert.includes(m, 'nautae aquam amant');
    assert.includes(m, '"correct"');
    assert.includes(m, 'do NOT reveal');
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

