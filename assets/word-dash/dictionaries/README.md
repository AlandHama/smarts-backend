# Word Dash dictionaries

`english.v1.txt` is a small project-owned bootstrap dictionary used for local development and phase-0/phase-3 verification. It is intentionally not presented as a complete production English dictionary.

Before enabling ranked Word Dash in production, replace it with a reviewed, licensed English word list, preserve the `english.v1` normalization rules or publish a new dictionary version, and set:

```text
WORD_DASH_DICTIONARY_SHA256=<sha256 of the exact normalized source file>
WORD_DASH_REQUIRE_DICTIONARY_CHECKSUM=true
```

The API never exposes this file to mobile clients. The backend loads it once into memory and stores only the dictionary version and checksum with an active match.
