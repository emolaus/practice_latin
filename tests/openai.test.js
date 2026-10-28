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

  /** A minimal Responses API result as returned by the REST endpoint. */
  function responseWithText(text) {
    return {
      object: 'response',
      status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: text, annotations: [] }] },
      ],
    };
  }

  test('OpenAIClient.respond posts to /v1/responses with auth header', async function () {
    const calls = [];
    const c = new PL.OpenAIClient({ apiKey: 'sk-test', fetchImpl: fakeFetch(200, responseWithText('{"ok":1}'), calls) });
    const out = await c.respond('gpt-6-luna', [{ role: 'user', content: 'hi JSON' }]);
    assert.equal(out, '{"ok":1}');
    assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
  });

  test('Responses body: system -> instructions, other turns -> input, json mode, store false', function () {
    const body = PL.OpenAIClient.buildResponsesBody('gpt-6-luna', [
      { role: 'system', content: 'You are a tutor. Reply in JSON.' },
      { role: 'user', content: 'New sentence please' },
      { role: 'assistant', content: '{"english":"x"}' },
      { role: 'user', content: 'My answer' },
    ]);
    assert.equal(body.model, 'gpt-6-luna');
    assert.equal(body.instructions, 'You are a tutor. Reply in JSON.');
    assert.deepEqual(body.input, [
      { role: 'user', content: 'New sentence please' },
      { role: 'assistant', content: '{"english":"x"}' },
      { role: 'user', content: 'My answer' },
    ]);
    assert.deepEqual(body.text, { format: { type: 'json_object' } });
    assert.equal(body.store, false);
    assert.ok(!('messages' in body), 'no chat completions field');
    assert.ok(!('response_format' in body), 'no chat completions field');
    assert.ok(!('temperature' in body), 'no temperature sent');
    assert.ok(!('previous_response_id' in body), 'context is managed client-side');
  });

  test('Responses body: json mode can be disabled; no instructions when no system message', function () {
    const body = PL.OpenAIClient.buildResponsesBody('m', [{ role: 'user', content: 'x' }], { json: false });
    assert.ok(!('text' in body));
    assert.ok(!('instructions' in body));
  });

  test('extractOutputText joins output_text parts and skips non-message items', function () {
    const data = {
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: '{"a":' }, { type: 'output_text', text: '1}' }] },
      ],
    };
    assert.equal(PL.OpenAIClient.extractOutputText(data), '{"a":1}');
  });

  test('extractOutputText uses output_text convenience field when present', function () {
    assert.equal(PL.OpenAIClient.extractOutputText({ output_text: 'hello', output: [] }), 'hello');
  });

  test('extractOutputText reports refusals, incomplete and failed responses', function () {
    const X = PL.OpenAIClient.extractOutputText;
    assert.throws(function () {
      X({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] });
    }, /refused: No\./);
    assert.throws(function () {
      X({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning' }] });
    }, /incomplete \(max_output_tokens\)/);
    assert.throws(function () { X({ status: 'failed', error: { message: 'server_error' } }); }, /server_error/);
    assert.throws(function () { X({ status: 'completed', output: [] }); }, /empty/);
    assert.throws(function () { X(null); }, /empty/);
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
      await c.respond('m', []);
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
    await assert.rejects(c.respond('m', []), /API key/);
  });

  test('OpenAIClient wraps network errors', async function () {
    const c = new PL.OpenAIClient({ apiKey: 'k', fetchImpl: function () { return Promise.reject(new TypeError('Failed to fetch')); } });
    await assert.rejects(c.respond('m', []), /Network error.*Failed to fetch/);
  });

  test('OpenAIClient rejects empty replies', async function () {
    const c = new PL.OpenAIClient({ apiKey: 'k', fetchImpl: fakeFetch(200, { status: 'completed', output: [] }) });
    await assert.rejects(c.respond('m', []), /empty/);
  });

  test('OpenAIClient no longer uses chat completions', function () {
    assert.ok(typeof PL.OpenAIClient.prototype.chat === 'undefined');
  });
})();
