# Backlog

## Google Antigravity instructions
Document all implementation in implementation_description.md.
Maintain a test suite under tests/.
Update the app description when the specification changes.

## App description
The Practice Latin web app allows a student of the Latin language to practice vocabulary and grammar in written form. The app loads a vocabulary of latin nouns, verbs and so on from the vocabulary.md file. This file is maintained by the user. It is a very simple markdown file: a heading names a word category (for example "# Nouns" or "# Verbs"), followed by one Latin word per line:

```
# Nouns
agricola
aqua

# Verbs
amo
porto
```

The user decides which grammar forms to practice by means of check boxes (Default on: Nominative, Accusative, Genitive, Singular, Plural, Present, Indicative). The app then generates problem sentences in English, using only the loaded vocabulary. Each challenge is a single short statement or question (one main clause, no semicolons or joined clauses), for example
"The sailors love the water of the forests" or "Who loves the farmer's daughter?". When the vocabulary includes interrogative words, questions are included among the challenges. To ensure diverse challenges across fresh API contexts, the app randomly selects whether each new challenge is a statement or a question (including which interrogative word to use) and samples suggested vocabulary words (nouns, verbs, etc.) for the model to build the sentence around. The user tries to translate this to latin. The app responds with helpful hints for each mistake.

The app keeps a history of the conversation. Each challenge is visually grouped into its own card in the main area (`Challenge #1`, `Challenge #2`, etc.) with a status badge (`Active API context` vs `Isolated context · closed`) so it is clear that each challenge is an isolated API context.

The user can also choose to **discuss** the current challenge or any previous challenge. Clicking **Discuss** opens a dedicated side panel with its own text input and starts a separate API context preloaded with the challenge context (the English sentence, reference Latin translation, student attempts, tutor feedback, and system instructions), allowing the user to converse openly with the model about the problem without cluttering or altering the grading context.

The app uses the OpenAI Responses API. The app always communicates in English except when highlighting certain words in Latin. When the user responds correctly, a new context is started with the API, in order to keep the context windows decluttered.

The web app can be run without a server - just double-click practice_latin.html to open it in your default browser.

The user starts by pasting an OpenAI API KEY into a text field.

The user can choose which model from OpenAI to interact with. The default model is gpt-6-luna.

The app's title is "Practice Latin Vocabulary and Grammar".

The app's title is "Practice Latin Vocabulary and Grammar".