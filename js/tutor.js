/*
 * tutor.js - Practice session logic (no DOM).
 *
 * One API "context" (message list) is used per problem sentence. When the
 * student answers correctly the context is discarded, so the next sentence
 * starts with a fresh, uncluttered context window.
 */
(function (root) {
  'use strict';
  const PL = root.PL;

  /**
   * @param {object} deps
   *   client:        object with chat(model, messages) -> Promise<string>
   *   getModel:      () => string
   *   getVocabulary: () => Array<{word, category}> (plain strings also accepted)
   *   getGrammar:    () => string[]  (grammar ids)
   */
  function Tutor(deps) {
    this.client = deps.client;
    this.getModel = deps.getModel;
    this.getVocabulary = deps.getVocabulary;
    this.getGrammar = deps.getGrammar;
    this.maxRecent = deps.maxRecent || 10;

    this.messages = [];      // current API context
    this.problem = null;     // { english, latin }
    this.solved = false;
    this.recent = [];        // recent English sentences, to avoid repeats
    this.contextsStarted = 0;
  }

  Tutor.prototype._checkReady = function () {
    if (!this.getModel()) throw new Error('Please choose a model.');
    if (!this.getVocabulary().length) throw new Error('No vocabulary loaded. Please load vocabulary.md.');
    if (!this.getGrammar().length) throw new Error('Please tick at least one grammar form.');
  };

  /** Start a fresh context and ask for a new problem sentence. */
  Tutor.prototype.newProblem = async function () {
    this._checkReady();
    const messages = [
      { role: 'system', content: PL.buildSystemPrompt(this.getVocabulary(), this.getGrammar()) },
      { role: 'user', content: PL.buildNewProblemMessage(this.recent) },
    ];
    const reply = await this.client.chat(this.getModel(), messages);
    const problem = PL.validateProblem(PL.parseJsonReply(reply));

    // Only commit state once the call succeeded.
    messages.push({ role: 'assistant', content: reply });
    this.messages = messages;
    this.problem = problem;
    this.solved = false;
    this.contextsStarted++;
    this.recent.push(problem.english);
    if (this.recent.length > this.maxRecent) this.recent.shift();
    return problem;
  };

  /** Submit a translation attempt for the current problem. */
  Tutor.prototype.submitAnswer = async function (answer) {
    answer = String(answer || '').trim();
    if (!answer) throw new Error('Please type your Latin translation.');
    if (!this.problem || this.solved) throw new Error('There is no open sentence. Ask for a new sentence first.');

    const messages = this.messages.concat({ role: 'user', content: PL.buildAnswerMessage(answer) });
    const reply = await this.client.chat(this.getModel(), messages);
    const evaluation = PL.validateEvaluation(PL.parseJsonReply(reply));

    if (evaluation.correct) {
      this.solved = true;
      this.messages = []; // discard context; next problem starts fresh
    } else {
      this.messages = messages.concat({ role: 'assistant', content: reply });
    }
    return evaluation;
  };

  /** Give up: return the reference translation and close the problem. */
  Tutor.prototype.revealAnswer = function () {
    if (!this.problem) throw new Error('There is no sentence to reveal.');
    this.solved = true;
    this.messages = [];
    return this.problem.latin;
  };

  Tutor.prototype.hasOpenProblem = function () {
    return !!this.problem && !this.solved;
  };

  /** Snapshot of the session so it survives a page reload. */
  Tutor.prototype.serialize = function () {
    return {
      messages: this.messages,
      problem: this.problem,
      solved: this.solved,
      recent: this.recent,
    };
  };

  Tutor.prototype.restore = function (state) {
    if (!state || typeof state !== 'object') return;
    this.messages = Array.isArray(state.messages) ? state.messages : [];
    this.problem = state.problem && typeof state.problem.english === 'string' ? state.problem : null;
    this.solved = !!state.solved;
    this.recent = Array.isArray(state.recent) ? state.recent.slice(-this.maxRecent) : [];
    if (this.problem && !this.solved && !this.messages.length) this.problem = null;
  };

  PL.Tutor = Tutor;
})(typeof window !== 'undefined' ? window : globalThis);
