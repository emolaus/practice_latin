# Implementation description

This document describes how the Practice Latin web app (see [backlog.md](backlog.md)) is implemented.

## Overview

Practice Latin is a static, serverless web app. Double-click `practice_latin.html` and it opens in
your default browser. The browser talks to the OpenAI REST API directly, using the API key you paste in.

```
practice-latin/
├── practice_latin.html      Entry point (open by double-clicking)
├── vocabulary.md            User-maintained vocabulary: "# Category" headings, one word per line
├── css/style.css            Styling
├── js/
│   ├── core.js              Pure logic: vocabulary parsing, grammar options, prompts,
│   │                        reply parsing, model filtering, safe rendering, history store
│   ├── openai.js            Minimal OpenAI REST client (fetch can be injected for tests)
│   ├── tutor.js             Practice session logic: one API context per problem sentence
│   └── app.js               DOM wiring, persistence (localStorage), event handlers
├── tests/
│   ├── index.html           Browser test runner page
│   ├── harness.js           Small zero-dependency test harness
│   ├── core.test.js         Tests for core.js
│   ├── openai.test.js       Tests for openai.js (fake fetch)
│   ├── tutor.test.js        Tests for tutor.js (scripted fake client)
│   └── run_tests.ps1        Runs tests + app smoke test in headless Chrome/Edge
└── docs/
    ├── backlog.md
    └── implementation_description.md
```

### Why classic scripts and no build step
Browsers block ES modules (`<script type="module">`) and most `fetch`/XHR requests on `file://`
pages. To keep "double-click to run", every JS file is a classic script that attaches its exports to
one global namespace, `window.PL`. There are no dependencies and no build step.

## Features and how they work

### API key
- You paste the key into a password field. The **Show** button toggles visibility.
- **Remember key in this browser** saves the key in `localStorage` (`pl.apiKey`). If the box is not
  ticked, the key is only kept in memory and is gone when the page closes.
- The key is only ever sent to `https://api.openai.com/v1`.

### Model selection
- After you enter a key (on the `change` event), or when you click ↻, the app calls `GET /v1/models`.
  `PL.filterChatModels` then keeps only chat-capable models (`gpt-*`, `o<digit>*`, `chatgpt-*`). It
  drops audio, realtime, TTS, transcription, image, search, embedding, moderation, codex and similar models.
- Default choice (`PL.pickDefaultModel`): your last saved model (`pl.model`), otherwise the first
  available model from `gpt-5-mini`, `gpt-4.1-mini`, `gpt-4o-mini`, `gpt-5`, `gpt-4.1` or `gpt-4o`,
  otherwise the first model in the list.
- If the list can't be fetched, a fallback list (`PL.FALLBACK_MODELS`) is shown along with the error.

### Vocabulary (`vocabulary.md`)
- Format (`PL.parseVocabulary`): a very simple markdown file.
  ```markdown
  # Nouns
  agricola
  aqua

  # Verbs
  amo
  ```
  - A heading of any level (`#` to `######`) starts a **category**, such as Nouns or Verbs.
  - Every other non-blank line is one entry. The whole line is kept, so `amo, amare - to love` works.
  - List markers (`- `, `* `, `+ `, `1. `) are stripped, so bulleted lists work too.
  - Single-line HTML comments (`<!-- … -->`) are ignored, and so is a bare `#` or a `#word` with no space.
  - Words placed before any heading are uncategorised.
  - Duplicates (case-insensitive) are dropped, and a UTF-8 BOM is stripped.
  - The parser returns `[{word, category}]`. `PL.groupVocabulary` groups the entries by category in
    the order they first appear. It also accepts plain strings and treats them as uncategorised.
- The system prompt lists the vocabulary under its categories (for example `Nouns:` followed by
  `- agricola`), so the model knows each word's part of speech.
- Loading strategy:
  1. On startup, the app tries to read `./vocabulary.md` with `XMLHttpRequest`. This works when a
     browser allows `file://` reads, or when the page is served over HTTP.
  2. Chrome and Edge block this by default on `file://`. In that case you choose or drag-and-drop
     `vocabulary.md` once. The file picker accepts `.md`, `.markdown` and `.txt`.
  3. The last loaded vocabulary text is cached in `localStorage` (`pl.vocabMd`, `pl.vocabMdSource`)
     and reused on later visits. The status line says it is a saved copy. **After editing
     vocabulary.md, choose the file again** to refresh it. The cache keys changed when the app moved
     from `vocabulary.txt` to `vocabulary.md`, so an old cached `.txt` vocabulary is never reused.
- The loaded words appear in the sidebar as chips, grouped under their category headings.

### Grammar selection
- The checkboxes come from `PL.GRAMMAR_GROUPS`:
  - Case: Nominative, Genitive, Dative, Accusative, Ablative, Vocative
  - Number: Singular, Plural
  - Tense: Present, Imperfect, Future, Perfect, Pluperfect, Future perfect
  - Person: 1st, 2nd, 3rd
  - Mood & voice: Indicative, Imperative, Infinitive, Passive voice
- Defaults (`PL.DEFAULT_GRAMMAR`), as the backlog requires: **Nominative, Accusative, Genitive,
  Singular, Plural, Present, Indicative**.
- Your selection is saved in `localStorage` (`pl.grammar`) as soon as you change a checkbox. Once it
  is saved, it is used instead of the defaults. **Reset to defaults** restores the defaults.
- The prompt tells the model to practise the selected forms. Other forms may appear only when a
  grammatical sentence needs them (for example a nominative subject and a present-tense verb).

### Practice loop and API contexts (`PL.Tutor`)
Each problem sentence gets its own API **context** (a message list):

1. **New sentence** → `tutor.newProblem()` builds a fresh context:
   - `system`: tutor persona and rules (`PL.buildSystemPrompt`): always communicate in English;
     wrap Latin words in `**…**`; use only the loaded vocabulary; the grammar focus; lenient
     marking (ignore macrons, capitalisation and punctuation; accept any valid word order or
     translation); always reply with JSON.
   - `user`: asks for `{"english": …, "latin": …}` (`PL.buildNewProblemMessage`). It includes up to
     10 recent English sentences so the model doesn't repeat itself across contexts.
   - The English sentence is shown. The Latin reference stays hidden.
2. **Check** (or Enter) → `tutor.submitAnswer(text)` appends the attempt (`PL.buildAnswerMessage`).
   It asks for `{"correct": bool, "feedback": …}`. If the answer is wrong, the feedback lists each
   mistake as a bullet with a hint, without revealing the full solution.
   - **Wrong** → the attempt and the reply stay in the context, so the tutor can see your earlier
     tries when it gives the next hints.
   - **Correct** → the context is **discarded**, and the app automatically starts a new sentence in a
     **fresh context**. This keeps the context window uncluttered, as the backlog requires.
3. **Show answer** reveals the hidden reference translation (no API call) and closes the problem.

State is only updated after a successful API call. A network or parse error does not corrupt the
context. You can simply retry.

Requests use `POST /v1/chat/completions` with `response_format: {type: "json_object"}`. No
`temperature` is sent, because reasoning models (o-series, gpt-5) reject non-default values.
`PL.parseJsonReply` also accepts JSON wrapped in code fences or extra text.

### Conversation history
- Every problem, attempt, piece of feedback and info message is stored in `localStorage`
  (`pl.history`, capped at 500 entries) by `PL.createHistoryStore`. It is shown again when the page is reopened.
- The tutor's session state (current context, problem, recent sentences) is saved in `pl.tutorState`.
  If you reload the page mid-problem, you can keep answering the same sentence.
- **Clear history** erases both after asking you to confirm.
- Transient messages (errors, "Thinking…" placeholders, the welcome message) are not saved.

### Rendering and safety
`PL.renderRichText` renders a tiny markdown subset: `**Latin**` is highlighted in the accent colour,
plus `*italic*`, `- ` bullet lists and paragraphs. All model output is HTML-escaped first, so a
model reply can't inject markup or scripts.

## localStorage keys

| Key | Content |
|---|---|
| `pl.apiKey` | API key (only if "Remember key" is ticked) |
| `pl.model` | Last chosen model |
| `pl.grammar` | JSON array of selected grammar ids |
| `pl.vocabMd`, `pl.vocabMdSource` | Cached vocabulary.md contents and where they came from |
| `pl.history` | JSON array of chat log entries `{role, kind, text, ts}` |
| `pl.tutorState` | JSON snapshot of the current tutor session |

## Tests

- **In a browser:** open `tests/index.html`. The results are listed on the page, and the page title
  shows `PASS n/n` or `FAIL n/n`.
- **From the command line (headless):**
  ```powershell
  powershell -ExecutionPolicy Bypass -File tests\run_tests.ps1
  ```
  This runs the unit tests in headless Chrome or Edge. It then smoke-tests `practice_latin.html`: the
  page loads, the grammar options and model list are built, and the welcome message appears. The
  script exits with code 1 on any failure.
- Coverage: markdown vocabulary parsing (categories, heading levels, list markers, comments,
  duplicates) and grouping, grammar defaults and description, prompt contents, JSON reply
  parsing and validation, model filtering and default choice, HTML escaping and rendering (including
  XSS), the history store, the OpenAI client (request shape, errors, network failures), and the
  tutor (fresh context per problem, context discarded after a correct answer, error resilience,
  input validation, reveal, recent-sentence cap, serialize/restore).
- No Node.js or Python is needed. The tests run in the same browser environment as the app.

