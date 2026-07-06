# Tests

This directory contains Markdown rendering regression cases and CommonMark compatibility helpers.

## Files

- `commonmark-spec.md`: core CommonMark syntax samples
- `gfm-extensions.md`: GitHub Flavored Markdown cases
- `edge-cases.md`: tricky nesting and rendering edge cases
- `run-tests.cjs`: local markdown regression runner
- `run-spec-tests.cjs`: CommonMark spec runner

## Regenerating the full CommonMark dataset

```bash
curl -L -o tests/spec.json https://spec.commonmark.org/0.31.2/spec.json
```

## Running

```bash
npm run test:markdown
npm run test:spec
```
