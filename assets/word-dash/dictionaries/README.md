# Word Dash dictionaries

`english.v1.txt` is the project-owned English bootstrap dictionary. It includes a broader common-English short-word set so ordinary 3-letter paths are recognized. The backend also unions it with the MIT-licensed `word-list` package at runtime for broad English coverage. The runtime publishes this expanded content as dictionary version `english.v2`.

Before enabling ranked Word Dash in production, replace it with a reviewed, licensed English word list if full dictionary coverage is required, preserve the normalization rules, and update the dictionary version/checksum together. Set:

```text
WORD_DASH_DICTIONARY_SHA256=<sha256 of the exact source file>
WORD_DASH_REQUIRE_DICTIONARY_CHECKSUM=true
```

The checksum covers the project file and the bundled `word-list` package file together. If either source changes, recalculate the checksum and deploy the matching dependency lockfile.

Set `WORD_DASH_DISABLE_WORD_LIST=true` only when a deliberately restricted custom dictionary is required; otherwise the broad list is included even when `WORD_DASH_DICTIONARY_PATH` points to a custom project file.

The API never exposes this file to mobile clients. The backend loads it once into memory and stores only the dictionary version and checksum with an active match.
