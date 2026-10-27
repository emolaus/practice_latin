# Backlog

## Google Antigravity instructions
Document all implementation in implementation_description.md.
Maintain a test suite under tests/.

## App description
The Practice Latin web app allows a student of the Latin language to practice vocabulary and grammar in written form. The app loads a vocabulary of latin nouns, verbs and so on from the vocabulary.txt file. This file is maintained by the user. The user decides which grammar forms to practice by means of check boxes (Default on: Accusative, Genitive, Singular, Plural). The app then generates problem sentences in English, using only the loaded vocabulary, for example
"The sailors love the water of the forests". The user tries to translate this to latin. The app responds with helpful hints for each mistake.

The app keeps a history of the conversation.

The app uses the OpenAI API. The app always communicates in English except when highlighting certain words in Latin. When the user responds correctly, a new context is started with the API, in order to keep the context windows decluttered.

The web app can be run without a server - just double-click practice_latin.html to open it in your default browser.

The user starts by pasting an OpenAI API KEY into a text field.

The user can choose which model from OpenAI to interact with.