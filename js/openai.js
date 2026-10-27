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
   * Send a chat completion and return the assistant's text.
   * No temperature is sent, because reasoning models reject non-default values.
   */
  OpenAIClient.prototype.chat = async function (model, messages, opts) {
    opts = opts || {};
    const body = { model: model, messages: messages };
    if (opts.json !== false) body.response_format = { type: 'json_object' };
    const data = await this._request('POST', '/chat/completions', body);
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : null;
    if (!content) throw new Error('OpenAI returned an empty reply.');
    return content;
  };

  root.PL = root.PL || {};
  root.PL.OpenAIClient = OpenAIClient;
})(typeof window !== 'undefined' ? window : globalThis);

