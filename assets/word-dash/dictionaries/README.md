# Word Dash dictionaries

`english.v1.txt` is the project-owned curated gameplay dictionary. It includes common English words and a broader short-word set so ordinary 3-letter paths are recognized without accepting obscure word-game, medical, technical, or proper-noun entries. The runtime publishes this curated content as dictionary version `english.v3`.

Before enabling ranked Word Dash in production, replace it with a reviewed, licensed gameplay word list only if the allowlist is intentionally changed, preserve the normalization rules, and update the dictionary version/checksum together. Set:

```text
WORD_DASH_DICTIONARY_SHA256=<sha256 of the exact source file>
WORD_DASH_REQUIRE_DICTIONARY_CHECKSUM=true
```

The checksum covers the project dictionary file. If it changes, recalculate the checksum and deploy the matching dictionary version.

The API never exposes this file to mobile clients. The backend loads it once into memory and stores only the dictionary version and checksum with an active match.
