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

The user decides which grammar forms to practice by means of check boxes (Default on: Nominative, Accusative, Genitive, Singular, Plural, Present, Indicative). The app then generates problem sentences in English, using only the loaded vocabulary. Each challenge is a single short statement (one main clause, no semicolons or joined clauses), for example
"The sailors love the water of the forests". The user tries to translate this to latin. The app responds with helpful hints for each mistake.

The app keeps a history of the conversation.

The app uses the OpenAI Responses API. The app always communicates in English except when highlighting certain words in Latin. When the user responds correctly, a new context is started with the API, in order to keep the context windows decluttered.

The web app can be run without a server - just double-click practice_latin.html to open it in your default browser.

The user starts by pasting an OpenAI API KEY into a text field.

The user can choose which model from OpenAI to interact with. The default model is gpt-6-luna.

The app's title is "Practice Latin Vocabulary and Grammar".