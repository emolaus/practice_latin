/* Unit tests for js/openai.js using a fake fetch */
(function () {
  const PL = window.PL;

  function fakeFetch(status, body, calls) {
    return function (url, init) {
      calls && calls.push({ url: url, init: init });
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status: status,
        json: function () {
          return body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body);
        },
      });
    };
  }

  test('OpenAIClient.chat posts model/messages with json mode and auth header', async function () {
    const calls = [];
    const c = new PL.OpenAIClient({
      apiKey: 'sk-test',
      fetchImpl: fakeFetch(200, { choices: [{ message: { content: '{"ok":1}' } }] }, calls),
    });
    const msgs = [{ role: 'user', content: 'hi JSON' }];
    const out = await c.chat('gpt-4o-mini', msgs);
    assert.equal(out, '{"ok":1}');
    assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.deepEqual(body.messages, msgs);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.ok(!('temperature' in body), 'no temperature sent');
  });

  test('OpenAIClient.chat can disable json mode', async function () {
    const calls = [];
    const c = new PL.OpenAIClient({ apiKey: 'k', fetchImpl: fakeFetch(200, { choices: [{ message: { content: 'x' } }] }, calls) });
    await c.chat('m', [], { json: false });
    assert.ok(!('response_format' in JSON.parse(calls[0].init.body)));
  });

  test('OpenAIClient.listModels returns ids', async function () {
    const calls = [];
    const c = new PL.OpenAIClient({ apiKey: 'k', fetchImpl: fakeFetch(200, { data: [{ id: 'gpt-4o' }, { id: 'o3' }] }, calls) });
    assert.deepEqual(await c.listModels(), ['gpt-4o', 'o3']);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
  });

  test('OpenAIClient surfaces API error messages and status', async function () {
    const c = new PL.OpenAIClient({ apiKey: 'k', fetchImpl: fakeFetch(401, { error: { message: 'Incorrect API key' } }) });
    try {
      await c.chat('m', []);
      throw new Error('should have thrown');
    } catch (e) {
      assert.includes(e.message, 'Incorrect API key');
      assert.equal(e.status, 401);
    }
  });

  test('OpenAIClient handles non-JSON error bodies', async function () {
    const c = new PL.OpenAIClient({ apiKey: 'k', fetchImpl: fakeFetch(500, undefined) });
    await assert.rejects(c.listModels(), /HTTP 500/);
  });

  test('OpenAIClient requires an API key', async function () {
    const c = new PL.OpenAIClient({ apiKey: '', fetchImpl: fakeFetch(200, {}) });
    await assert.rejects(c.chat('m', []), /API key/);
  });

  test('OpenAIClient wraps network errors', async function () {
    const c = new PL.OpenAIClient({ apiKey: 'k', fetchImpl: function () { return Promise.reject(new TypeError('Failed to fetch')); } });
    await assert.rejects(c.chat('m', []), /Network error.*Failed to fetch/);
  });

  test('OpenAIClient rejects empty replies', async function () {
    const c = new PL.OpenAIClient({ apiKey: 'k', fetchImpl: fakeFetch(200, { choices: [] }) });
    await assert.rejects(c.chat('m', []), /empty/);
  });
})();

