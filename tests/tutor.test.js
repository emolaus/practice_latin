/* Unit tests for js/tutor.js using a scripted fake client */
(function () {
  const PL = window.PL;

  /** Fake client that returns queued replies and records every call. */
  function fakeClient(replies) {
    const calls = [];
    return {
      calls: calls,
      respond: function (model, messages) {
        calls.push({ model: model, messages: JSON.parse(JSON.stringify(messages)) });
        const r = replies.shift();
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve(typeof r === 'string' ? r : JSON.stringify(r));
      },
    };
  }

  function makeTutor(replies, opts) {
    opts = opts || {};
    const client = fakeClient(replies);
    const tutor = new PL.Tutor({
      client: client,
      getModel: function () { return 'model' in opts ? opts.model : 'gpt-test'; },
      getVocabulary: function () {
        return opts.vocab || [
          { word: 'nauta', category: 'Nouns' },
          { word: 'silva', category: 'Nouns' },
          { word: 'amo', category: 'Verbs' },
        ];
      },
      getGrammar: function () { return opts.grammar || ['accusative', 'plural']; },
    });
    return { tutor: tutor, client: client };
  }

  const PROBLEM = { english: 'The sailors love the forests.', latin: 'Nautae silvas amant.' };

  test('newProblem starts a fresh context with system + user message', async function () {
    const t = makeTutor([PROBLEM]);
    const p = await t.tutor.newProblem();
    assert.deepEqual(p, PROBLEM);
    const call = t.client.calls[0];
    assert.equal(call.model, 'gpt-test');
    assert.equal(call.messages.length, 2);
    assert.equal(call.messages[0].role, 'system');
    assert.includes(call.messages[0].content, '- nauta');
    assert.equal(call.messages[1].role, 'user');
    assert.ok(t.tutor.hasOpenProblem());
  });

  test('wrong answer keeps the context, correct answer discards it', async function () {
    const t = makeTutor([
      PROBLEM,
      { correct: false, feedback: '- **nauta** must be plural' },
      { correct: true, feedback: 'Optime!' },
      { english: 'The goddess loves the girl.', latin: 'Dea puellam amat.' },
    ]);
    await t.tutor.newProblem();

    const ev1 = await t.tutor.submitAnswer('Nauta silvas amat');
    assert.equal(ev1.correct, false);
    assert.equal(t.client.calls[1].messages.length, 4, 'system, problem request, problem reply, answer');
    assert.includes(t.client.calls[1].messages[3].content, 'Nauta silvas amat');

    const ev2 = await t.tutor.submitAnswer('Nautae silvas amant');
    assert.equal(ev2.correct, true);
    assert.equal(t.client.calls[2].messages.length, 6, 'includes the previous wrong attempt');
    assert.ok(!t.tutor.hasOpenProblem());
    assert.deepEqual(t.tutor.messages, [], 'context discarded after a correct answer');

    await t.tutor.newProblem();
    const fresh = t.client.calls[3].messages;
    assert.equal(fresh.length, 2, 'new problem starts with a fresh context');
    assert.includes(fresh[1].content, PROBLEM.english, 'recent sentence passed to avoid repeats');
  });

  test('failed API call does not corrupt the context', async function () {
    const t = makeTutor([PROBLEM, new Error('boom'), { correct: false, feedback: 'x' }]);
    await t.tutor.newProblem();
    await assert.rejects(t.tutor.submitAnswer('abc'), /boom/);
    assert.equal(t.tutor.messages.length, 3);
    await t.tutor.submitAnswer('abc');
    assert.equal(t.client.calls[2].messages.length, 4);
  });

  test('unparseable evaluation reply rejects and keeps the problem open', async function () {
    const t = makeTutor([PROBLEM, 'I think it is fine']);
    await t.tutor.newProblem();
    await assert.rejects(t.tutor.submitAnswer('abc'), /JSON/);
    assert.ok(t.tutor.hasOpenProblem());
  });

  test('submitAnswer validates input and state', async function () {
    const t = makeTutor([PROBLEM]);
    await assert.rejects(t.tutor.submitAnswer('abc'), /no open sentence/);
    await t.tutor.newProblem();
    await assert.rejects(t.tutor.submitAnswer('   '), /type your Latin/);
  });

  test('newProblem checks model, vocabulary and grammar', async function () {
    await assert.rejects(makeTutor([PROBLEM], { model: '' }).tutor.newProblem(), /model/);
    await assert.rejects(makeTutor([PROBLEM], { vocab: [] }).tutor.newProblem(), /vocabulary/);
    await assert.rejects(makeTutor([PROBLEM], { grammar: [] }).tutor.newProblem(), /grammar/);
  });

  test('revealAnswer returns reference and closes the problem', async function () {
    const t = makeTutor([PROBLEM]);
    await t.tutor.newProblem();
    assert.equal(t.tutor.revealAnswer(), PROBLEM.latin);
    assert.ok(!t.tutor.hasOpenProblem());
    assert.deepEqual(t.tutor.messages, []);
  });

  test('recent sentence list is capped', async function () {
    const replies = [];
    for (let i = 0; i < 15; i++) replies.push({ english: 'S' + i, latin: 'L' });
    const t = makeTutor(replies);
    for (let i = 0; i < 15; i++) await t.tutor.newProblem();
    assert.equal(t.tutor.recent.length, 10);
    assert.equal(t.tutor.recent[0], 'S5');
  });

  test('serialize/restore round-trips an open problem', async function () {
    const t = makeTutor([PROBLEM]);
    await t.tutor.newProblem();
    const state = JSON.parse(JSON.stringify(t.tutor.serialize()));
    const t2 = makeTutor([{ correct: true, feedback: 'ok' }]);
    t2.tutor.restore(state);
    assert.ok(t2.tutor.hasOpenProblem());
    const ev = await t2.tutor.submitAnswer('Nautae silvas amant');
    assert.equal(ev.correct, true);
    assert.equal(t2.client.calls[0].messages.length, 4);
  });

  test('restore tolerates garbage', function () {
    const t = makeTutor([]);
    t.tutor.restore(null);
    t.tutor.restore({ problem: 'x', messages: 'y' });
    assert.ok(!t.tutor.hasOpenProblem());
    assert.deepEqual(t.tutor.messages, []);
  });
})();

