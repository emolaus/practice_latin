/*
 * tutor.js - Practice session logic (no DOM).
 *
 * One API "context" (message list) is used per problem sentence. When the
 * student answers correctly the context is discarded, so the next sentence
 * starts with a fresh, uncluttered context window.
 *
 * Each challenge is also archived by id (`challenges`) so the student can open
 * a separate "Discuss challenge" API context preloaded with either the current
 * challenge or any previous challenge.
 */
(function (root) {
  'use strict';
  const PL = root.PL;

  /**
   * @param {object} deps
   *   client:        object with respond(model, messages, opts) -> Promise<string>
   *   getModel:      () => string
   *   getVocabulary: () => Array<{word, category}> (plain strings also accepted)
   *   getGrammar:    () => string[]  (grammar ids)
   *   rng:           optional () => number in [0, 1)
   */
  function Tutor(deps) {
    this.client = deps.client;
    this.getModel = deps.getModel;
    this.getVocabulary = deps.getVocabulary;
    this.getGrammar = deps.getGrammar;
    this.rng = deps.rng || Math.random;
    this.maxRecent = deps.maxRecent || 10;
    this.maxChallenges = deps.maxChallenges || 50;

    this.messages = [];      // current grading API context
    this.problem = null;     // { english, latin }
    this.solved = false;
    this.recent = [];        // recent English sentences, to avoid repeats
    this.contextsStarted = 0;
    this.currentContextId = 0;
    this.challenges = [];    // [{ id, english, latin, solved, attempts, discussion }]
  }

  Tutor.prototype._checkReady = function () {
    if (!this.getModel()) throw new Error('Please choose a model.');
    if (!this.getVocabulary().length) throw new Error('No vocabulary loaded. Please load vocabulary.md.');
    if (!this.getGrammar().length) throw new Error('Please tick at least one grammar form.');
  };

  /** Start a fresh context and ask for a new problem sentence. */
  Tutor.prototype.newProblem = async function () {
    this._checkReady();
    const vocab = this.getVocabulary();
    const hint = PL.pickChallengeHint(vocab, this.rng);
    const messages = [
      { role: 'system', content: PL.buildSystemPrompt(vocab, this.getGrammar()) },
      { role: 'user', content: PL.buildNewProblemMessage(this.recent, hint) },
    ];
    const reply = await this.client.respond(this.getModel(), messages);
    const problem = PL.validateProblem(PL.parseJsonReply(reply));

    // Close any previously open challenge snapshot before starting the new one.
    const prev = this.getChallenge(this.currentContextId);
    if (prev && !prev.solved) prev.solved = true;

    // Only commit state once the call succeeded.
    messages.push({ role: 'assistant', content: reply });
    this.messages = messages;
    this.problem = problem;
    this.solved = false;
    this.contextsStarted++;
    this.currentContextId = this.contextsStarted;
    this.challenges.push({
      id: this.currentContextId,
      english: problem.english,
      latin: problem.latin,
      solved: false,
      attempts: [],
      discussion: [],
    });
    if (this.challenges.length > this.maxChallenges) this.challenges.shift();
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
    const reply = await this.client.respond(this.getModel(), messages);
    const evaluation = PL.validateEvaluation(PL.parseJsonReply(reply));

    const ch = this.getChallenge(this.currentContextId);
    if (ch) {
      ch.attempts.push({ answer: answer, feedback: evaluation.feedback, correct: evaluation.correct });
    }

    if (evaluation.correct) {
      this.solved = true;
      this.messages = []; // discard context; next problem starts fresh
      if (ch) ch.solved = true;
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
    const ch = this.getChallenge(this.currentContextId);
    if (ch) ch.solved = true;
    return this.problem.latin;
  };

  Tutor.prototype.hasOpenProblem = function () {
    return !!this.problem && !this.solved;
  };

  /** Look up a challenge snapshot by id (defaults to the current challenge). */
  Tutor.prototype.getChallenge = function (id) {
    const targetId = id === undefined ? this.currentContextId : Number(id);
    for (let i = this.challenges.length - 1; i >= 0; i--) {
      if (this.challenges[i].id === targetId) return this.challenges[i];
    }
    return null;
  };

  /**
   * Register or merge a challenge snapshot (for example reconstructed from chat
   * history after a reload). Returns the stored challenge object.
   */
  Tutor.prototype.ensureChallenge = function (snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.id) return null;
    const id = Number(snapshot.id);
    let ch = this.getChallenge(id);
    if (!ch) {
      ch = {
        id: id,
        english: String(snapshot.english || ''),
        latin: String(snapshot.latin || ''),
        solved: !!snapshot.solved,
        attempts: Array.isArray(snapshot.attempts) ? snapshot.attempts.slice() : [],
        discussion: Array.isArray(snapshot.discussion) ? snapshot.discussion.slice() : [],
      };
      this.challenges.push(ch);
      if (id > this.contextsStarted) this.contextsStarted = id;
      if (!this.currentContextId) this.currentContextId = id;
    }
    return ch;
  };

  /**
   * Send a message in the separate "Discuss challenge" API context for `contextId`.
   * Preloads the challenge context (sentence, reference, attempts/feedback) plus
   * any prior discussion messages for that challenge, without touching `this.messages`.
   */
  Tutor.prototype.discuss = async function (contextId, userText) {
    this._checkReady();
    userText = String(userText || '').trim();
    if (!userText) throw new Error('Please type a question or message to discuss.');
    const ch = this.getChallenge(contextId);
    if (!ch) throw new Error('Could not find that challenge context to discuss.');

    const nextTurns = ch.discussion.concat({ role: 'user', content: userText });
    const apiMessages = PL.buildDiscussionMessages(this.getVocabulary(), this.getGrammar(), ch, nextTurns);
    const reply = await this.client.respond(this.getModel(), apiMessages, { json: false });
    const cleanReply = String(reply || '').trim();

    const now = Date.now();
    ch.discussion.push({ role: 'user', content: userText, ts: now });
    ch.discussion.push({ role: 'assistant', content: cleanReply, ts: now });
    return cleanReply;
  };

  /** Snapshot of the session so it survives a page reload. */
  Tutor.prototype.serialize = function () {
    return {
      messages: this.messages,
      problem: this.problem,
      solved: this.solved,
      recent: this.recent,
      contextsStarted: this.contextsStarted,
      currentContextId: this.currentContextId,
      challenges: this.challenges,
    };
  };

  Tutor.prototype.restore = function (state) {
    if (!state || typeof state !== 'object') return;
    this.messages = Array.isArray(state.messages) ? state.messages : [];
    this.problem = state.problem && typeof state.problem.english === 'string' ? state.problem : null;
    this.solved = !!state.solved;
    this.recent = Array.isArray(state.recent) ? state.recent.slice(-this.maxRecent) : [];
    this.challenges = Array.isArray(state.challenges)
      ? state.challenges.slice(-this.maxChallenges).map(function (c) {
        return {
          id: Number(c.id) || 1,
          english: String(c.english || ''),
          latin: String(c.latin || ''),
          solved: !!c.solved,
          attempts: Array.isArray(c.attempts) ? c.attempts : [],
          discussion: Array.isArray(c.discussion) ? c.discussion : [],
        };
      })
      : [];
    this.contextsStarted = Number(state.contextsStarted) || this.challenges.length || 0;
    this.currentContextId = Number(state.currentContextId) ||
      (this.challenges.length ? this.challenges[this.challenges.length - 1].id : 0);
    if (this.problem && !this.solved && !this.messages.length) this.problem = null;
    if (!this.problem && this.Solved === undefined) {
      // If state was empty (`{}`), reset counters cleanly.
      if (!Object.keys(state).length) {
        this.contextsStarted = 0;
        this.currentContextId = 0;
        this.challenges = [];
      }
    }
    if (this.problem && !this.getChallenge(this.currentContextId)) {
      const id = this.currentContextId || 1;
      this.currentContextId = id;
      if (id > this.contextsStarted) this.contextsStarted = id;
      this.challenges.push({
        id: id,
        english: this.problem.english,
        latin: this.problem.latin || '',
        solved: this.solved,
        attempts: [],
        discussion: [],
      });
    }
  };

  PL.Tutor = Tutor;
})(typeof window !== 'undefined' ? window : globalThis);
