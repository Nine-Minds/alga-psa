# Translation QA tooling

This directory contains locale-agnostic QA tools for the supported translated locales: `de`, `es`, `fr`, `it`, `nl`, `pl`, and `pt`. English is the source of truth; the `xx` and `yy` pseudo-locales are intentionally excluded. Every locale uses a directory matching its language code.

`locales.registry.json` maps each locale to its QA directory, glossary, review ledger, and BCP 47 dialect. `lib/translation-utils.cjs` contains shared helpers and `lib/glossary.schema.json` documents the common glossary shape. Each locale directory owns its review state, optional baseline, glossary, and generated `reports/` files.

Run the tools from the repository root, substituting any registered locale:

```sh
node tools/i18n/audit.cjs --locale de
node tools/i18n/audit.cjs --locale de --namespace common --no-write-report
node tools/i18n/audit.cjs --locale de --baseline --no-write-report
node tools/i18n/audit.cjs --locale de --write-baseline --no-write-report
node tools/i18n/export-review.cjs --locale de --format both
node tools/i18n/check-template-parity.cjs --locale de
```

`reports/`, `review-state.json` and `baseline.json` are local working state and are gitignored — the checks read only the glossaries. Audit reports are written to `<locale-dir>/reports/audit.json` and `audit.md`. `--baseline` compares untranslated, forbidden, unreviewed, and structural counts with `<locale-dir>/baseline.json`; a missing baseline is reported and does not fail. `--write-baseline` records the current counts. If a locale glossary is not present yet, glossary-dependent work is skipped with a clear message. Template parity still checks coverage and placeholders without a glossary, but skips forbidden-term checks. It exits nonzero when templates exist and parity violations are found; a locale with no templates is reported as uncovered and exits successfully.

To add a locale, add its exact configuration to `locales.registry.json`, create `<locale-dir>/review-state.json` with an empty `reviewed` object and a `reports/` directory, then add a glossary conforming to the shared schema. Locale JSON must live under `server/public/locales/<code>/` with matching English namespaces.

## Hardcoded-English sweep

`find-untranslated-ui.cjs` is the source-side counterpart to the locale audits: it reads `server/src` and `ee/server/src` looking for English that never reached a locale file.

```sh
node tools/i18n/find-untranslated-ui.cjs                 # ranked report
node tools/i18n/find-untranslated-ui.cjs --severity=high # only files with no i18n at all
node tools/i18n/find-untranslated-ui.cjs --file=PATH     # every literal in one file
```

The top section lists files that render JSX yet never import `useTranslation` or call `t()`. Rank those by the fact that they appear, not by their literal count — the count only reflects the shapes the heuristics recognize, so a file with one hit and no i18n import is a whole-file translation pass, while a file with eight hits and a hundred `t()` calls is a cleanup.

Know what it cannot see. Copy that reaches the UI from outside the scanned roots — `packages/*`, server actions, workflow templates, seeded database rows — is out of range, and a clean report is not evidence that a file is translated. It flags positions it understands (JSX text, props, object values, ternaries, fallbacks, returns, call arguments), so copy assembled at runtime or held in a shape it does not model passes silently. In the other direction, brand names and enum-like values (`'Google'`, `'Pro'`, keyboard key names) are the residual false positives; skim before filing work.

## Customer document labels

The `documents` namespace holds the chrome of the documents clients receive — invoices, quotes, sales order confirmations, packing slips and pick lists. Those strings are template content in `packages/billing`, not UI copy, so the hardcoded-English sweep cannot see them and the audits are the only gate that does. They render in the recipient's locale, and the glossaries carry the document-specific decisions (rate versus unit price, neutral tax wording, fulfillment and pick-list terms). See [`docs/billing/document-template-translation.md`](../../docs/billing/document-template-translation.md) before adding or re-wording one.

Run all shared tests with:

```sh
node --test tools/i18n/tests/*.test.mjs
```

Glossary and baseline cases skip individually until their corresponding files exist.
