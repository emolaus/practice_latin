/*
 * openai.js - Minimal OpenAI REST client usable directly from the browser.
 * `fetchImpl` can be injected for testing.
 */
(function (root) {
  'use strict';

  function OpenAIClient(options) {
    options = options || {};
    this.apiKey = options.apiKey || '';
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || function () { return root.fetch.apply(root, arguments); };
  }

  OpenAIClient.prototype._request = async function (method, path, body) {
    if (!this.apiKey) throw new Error('Please enter your OpenAI API key first.');
    const init = {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + this.apiKey,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    let res;
    try {
      res = await this.fetchImpl(this.baseUrl + path, init);
    } catch (e) {
      throw new Error('Network error contacting OpenAI: ' + (e && e.message ? e.message : e));
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }

    if (!res.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : ('HTTP ' + res.status);
      const err = new Error('OpenAI error (' + res.status + '): ' + msg);
      err.status = res.status;
      throw err;
    }
    return data;
  };

  /** Returns an array of model ids available to this key. */
  OpenAIClient.prototype.listModels = async function () {
    const data = await this._request('GET', '/models');
    return (data && Array.isArray(data.data) ? data.data : []).map(function (m) { return m.id; });
  };

  /**
   * Convert a chat-style message list ([{role, content}]) into a Responses API
   * request body. System messages become `instructions`; all other messages
   * (user / assistant) are passed as `input` items, so earlier turns of the
   * current problem are sent along with each request.
   */
  function buildResponsesBody(model, messages, opts) {
    opts = opts || {};
    const instructions = [];
    const input = [];
    (messages || []).forEach(function (m) {
      if (m.role === 'system' || m.role === 'developer') instructions.push(m.content);
      else input.push({ role: m.role, content: m.content });
    });
    const body = {
      model: model,
      input: input,
      // The app keeps the conversation itself (and resets it after a correct
      // answer), so nothing needs to be stored on OpenAI's side.
      store: false,
    };
    if (instructions.length) body.instructions = instructions.join('\n\n');
    if (opts.json !== false) body.text = { format: { type: 'json_object' } };
    return body;
  }

  /** Extract the assistant text from a Responses API result. */
  function extractOutputText(data) {
    if (!data) throw new Error('OpenAI returned an empty reply.');
    if (data.status === 'failed') {
      throw new Error('OpenAI could not complete the request: ' +
        (data.error && data.error.message ? data.error.message : 'unknown error'));
    }
    if (typeof data.output_text === 'string' && data.output_text) return data.output_text;

    let text = '';
    let refusal = '';
    (Array.isArray(data.output) ? data.output : []).forEach(function (item) {
      if (!item || item.type !== 'message' || !Array.isArray(item.content)) return;
      item.content.forEach(function (part) {
        if (part.type === 'output_text' && typeof part.text === 'string') text += part.text;
        else if (part.type === 'refusal' && part.refusal) refusal += part.refusal;
      });
    });
    if (text) return text;
    if (refusal) throw new Error('The model refused: ' + refusal);
    if (data.status === 'incomplete') {
      const reason = data.incomplete_details && data.incomplete_details.reason;
      throw new Error('OpenAI reply was incomplete' + (reason ? ' (' + reason + ')' : '') + '.');
    }
    throw new Error('OpenAI returned an empty reply.');
  }

  /**
   * Create a model response with the Responses API (POST /v1/responses) and
   * return the assistant's text. `messages` is a chat-style list.
   * No temperature is sent, because reasoning models reject non-default values.
   */
  OpenAIClient.prototype.respond = async function (model, messages, opts) {
    const data = await this._request('POST', '/responses', buildResponsesBody(model, messages, opts));
    return extractOutputText(data);
  };

  OpenAIClient.buildResponsesBody = buildResponsesBody;
  OpenAIClient.extractOutputText = extractOutputText;

  root.PL = root.PL || {};
  root.PL.OpenAIClient = OpenAIClient;
})(typeof window !== 'undefined' ? window : globalThis);

