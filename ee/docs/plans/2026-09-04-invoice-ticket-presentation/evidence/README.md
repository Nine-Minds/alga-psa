# Invoice ticket presentation draft verification

**Independent mitigation-round verification (latest):** [verification-evidence.md](verification-evidence.md) re-executed the draft-review failure findings from scratch after closure commit `aac6f70597` — start with its **ten-case verdict table** and the recurring bucket/cap sections, which answer the failed review's exact claims. Fresh this round: 22 files / 296 focused tests (293 committed + 3 reviewer probes), all six live production variants including the recurring bucket (147500 net, periods `billed` with charge-detail links) and contracted recurring cap (20000 billed / 32500 write-down, 55000 net / 5500 tax), the full T015/T016 closure matrix against the designer-saved template, the authenticated HTTP spot check (201 / wrong-tenant 401), T009/T017 disclosure spot-checks, and all four build gates — billing build/typecheck and server typecheck exit 0; the isolated full server build's first attempt was killed by session teardown, was relaunched detached, and completed successfully (73/73 static pages, `BUILD_ID`, no compile errors — durable receipt `server-build-result.json`). Artifact root: `/home/robert/alga-artifacts/invoice-ticket-reverify-2026-09-05/evidence/`; hashed manifest committed as `verification-artifact-manifest.json`.

**Acceptance closure:** [closure-evidence.md](closure-evidence.md) closes the final three cases — T009 (task-identity/hour-block production variants plus the disclosed historical ticketless fixtures; read its disclosure section first), T015 (visual from-scratch detail authoring with new palette presets, template `ccf9a9fb`) and T016 (6-fixture × 3-locale canvas/preview/PDF matrix). All 19 checklist tests are now implemented.

**Prior mitigation:** [mitigation-evidence.md](mitigation-evidence.md) records repaired recurring bucket/cap generation, authenticated HTTP generation/read, immutable before/after PDFs, malformed-history guards, portal walkthrough and empty-transform repair. Seven of the ten open cases passed there; T009, T015 and T016 were completed by the closure round above. The sections below are historical evidence.

**Review revisions (September 5):** see [revision-evidence.md](revision-evidence.md) for the three corrected designer defects, new cap/inline-adjustment and multi-tax generation, saved nested aliases, multi-page PDF inspection, and independently reproduced recurring billing blockers. The remainder of this file describes the earlier draft run.

Review `attachTicketPresentation` in `packages/billing/src/lib/adapters/invoiceAdapters.ts` first. A charge is replaced only after every owned immutable link passes validation and its snapshot net amounts equal the canonical charge exactly. Then review `invoiceTimeSnapshot.ts`, calculator snapshot creation, and the saved-layout preview/PDF evidence below.

The approved specification is design commit `d42325cf38`. This is a standalone follow-up to merged PR #3314. The implementation was already substantially present in the worktree when this verification run began. This run reviewed and completed it, fixed missing quote/sales-order collection descriptors, made group schemas match evaluator output, strengthened production/export and calculator tests, and recorded evidence. The pre-existing lockfile edits and migration CLI executable-bit change are excluded from the draft commit.

## Fresh checks on 2026-09-05 UTC

Artifacts for this run are under `/tmp/invoice-ticket-review-run/`. They contain only synthetic acceptance records, but are kept outside the repository because raw snapshots and UI captures include local tenant/record identifiers. Keep this directory with the review packet; `/tmp` is not durable storage.

| Check | Result and evidence |
| --- | --- |
| Production generation | `production-final.log`, `generated/generated.json`, `generated/recurring-preview.json`: real supported `previewInvoice` and `generateInvoice`, four approved entries, two tickets, usage. Five canonical charges become three primary rows. Net 87500, tax 8750, total 96250. Each charge's contribution IDs and integer amounts reconcile independently. |
| Rate provenance | `strengthened-behavior.log`: 19 cases, including the actual 120-minute/37500 overtime calculation, between-entry mixed rates, equal-rate/free controls, mixed plus historical unknown, and both contract normalization directions. |
| Source immutability and privacy | Production fixture changes ticket titles/descriptions and time notes after generation, then uses a fresh reader and compares the full renderer model. Snapshot/renderer data excludes distinct private ticket/time-note sentinels. PDFs are rendered after source edits. |
| Accounting | `generated/accounting-export.json`: real QuickBooks CSV transform reads persisted invoice charges and synthetic service mappings. Payload, descriptions, mapped service names, quantities, amounts, and stored charges are unchanged after source edits and projection. No accounting delivery occurs. |
| Credit and manual additions | `generated/credited.json`, `generated/adjusted.json`: supported 2500 account-credit grant/application leaves primary rows unchanged. Supported line discount -1000, negative credit -500 and zero information row each occur once. Adjusted net 86000, tax 8750, total 94750; stored applied credit remains 2500. |
| Legacy/corrupt history | Production test deliberately nulls generated snapshots or changes their version inside rolled-back transactions. Legacy, partial, unsupported version and v1 reads retain exact coverage; v1 rates are unknown. Calculator-driven guard cases also exercise duplicate/conflicting ownership, wrong tenant, invalid money, mixed origin and cap mismatch. |
| UI save/reopen | Existing custom layout opened on port 3967, billed-time source selected, Date quick-add used, sort changed to amount descending, table rebound to transform output, saved, closed and reopened. `canvas-fr.png`, `reopened-preview-fr.png`, `preview-detail-fr.png`, `reopened-preview-fr-dom.json`. DOM clicks were used where CLI pointer targeting did not select reliably; no React/store injection. |
| Saved AST, full preview and PDF | `custom.log`, `custom/custom-template.json`, `custom/custom-canvas-rows.json`, `custom/custom-preview.html`, `custom/custom.pdf`, `custom/custom.txt`, `custom/custom.png`. Actual persisted AST resolves four entries in the same order in canvas/evaluator/PDF, mixed 37500 first. Primary rows include all six post-adjustment presentation rows. Canvas intentionally shows at most five rows plus a count; full preview/PDF show every row. |
| French standard layout | `generated/production-fr.pdf`, `.txt`, `.png`: three primary rows, translated mixed-rate state, quantities, currency, totals, and provider-breakdown guidance. PDF pages visually inspected. Custom literal headings remain as authored; document-key labels and semantic rates localize. |
| Compatibility | `behavior.log`: 51 earlier checks across projection, canvas bindings, evaluator and template roundtrip. `regression.log`: 67 checks across adapters, standard templates, renderer, formatting, designer presets and contract domain. Additional strengthened checks render saved quote and sales-order field presets using their actual row fields. |
| Calculator regression | `compute-regression-final.log`: 41 passing existing calculator/hour-block/golden tests. One stale version-1 expectation was fixed; rounding, user-type override, custom-rate and overtime cases now assert immutable rate provenance too. |
| Typechecks/build | Billing typecheck and package build passed. Server typecheck passed with `NODE_OPTIONS=--max-old-space-size=12288`; default 4 GB failed with heap exhaustion. Full webpack build at its default 8 GB also exhausted heap. The isolated 16 GB retry passed with exit 0 (`server-build-retry.log`), including all 73 static pages. It emitted warnings about conflicting scheduling exports, workflow inference imports and dynamic dependencies in unchanged files; a baseline build was not repeated. Next skips type validation during build, so both explicit typechecks were run separately. No pre-existing code blocker is claimed from a memory failure. |
| Locale and hygiene | `translations.log`: all nine shipped/pseudo locales passed, zero warnings. `git diff --check` passed. Plan schema validation is part of final checks. |

The older dossier evidence is at `/tmp/invoice-ticket-evidence/` and `/tmp/invoice-ticket-*-final.log`. Selected original generated/PDF artifacts were preserved in this run's `prior/` directory before rerunning. These are prior evidence, not new checks. The UI journey uses the first invoice generated during this run; the strengthened export fixture generates a second invoice of the same shape. Their record numbers differ deliberately.

## Reproduction

Use the existing `alga-psa-local-test` infrastructure and application from this worktree's `server` directory on port 3967. HTTP 307 at the root is expected. Do not bootstrap or reset the shared database.

```bash
cd server
INVOICE_TICKET_LIVE=1 INVOICE_TICKET_EVIDENCE_DIR=/tmp/invoice-ticket-review-run/generated \
  npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts --coverage.enabled=false
npx vitest run src/test/unit/billing/invoiceTicketPresentation.test.ts --coverage.enabled=false
```

The opt-in source fixture reads local `.env.local`, uses the existing direct PostgreSQL port 5472, and requires the previously provisioned synthetic `invoice-draft-verifier@example.invalid` user and seeded service/ticket reference data. It creates isolated clients/contracts/services/tax settings and retains the resulting invoices for browser inspection. It never inserts completed snapshots to prove generation.

After editing a layout through the UI, use its actual saved template ID and the invoice number selected in preview:

```bash
INVOICE_TICKET_CUSTOM=1 INVOICE_TICKET_CUSTOM_NUMBER='<invoice number>' \
INVOICE_TICKET_CUSTOM_TEMPLATE='<saved template id>' \
INVOICE_TICKET_EVIDENCE_DIR=/tmp/invoice-ticket-review-run/custom \
  npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts --coverage.enabled=false
```

## Mocks, shortcuts and remaining matrix

- Integration authentication/session helpers are stubbed with a real local fixture user's identity and tenant context. This proves billing/persistence/rendering behavior, not authentication enforcement. Browser work used the existing authenticated local session.
- Source records are inserted by the fixture. Post-generation source edits and corrupt-history simulations use direct DB writes because billed fields are locked in the UI. Corrupt-history mutations roll back; acceptance source records and invoices remain for inspection.
- Unit tests use the real calculator with a no-tax port; integration generation uses actual configured 10% tax. The CSV export envelope is fixture-built; invoice reads, charges, mapping resolution and transformation are real. No accounting delivery, customer messaging or support-ticket edits occur.
- No client-portal capability was verified live. Accordingly, default guidance only requests a breakdown from the provider; it makes no portal ledger or ticket-update promise.
- At the earlier draft checkpoint, multi-tax tickets, live cap/bucket behavior and multi-page nested detail had not been checked. The revision run now covers multi-tax generation, standalone cap write-downs with supported inline additions, and saved/reopened multi-page nested PDF detail. Recurring bucket generation and contracted recurring caps have independently reproduced blockers documented in [revision-evidence.md](revision-evidence.md). Cross-tenant adversarial generation and a full portal walkthrough remain unverified requirements; they are not represented as passed. Checklist tests remain false where their full scenario is only partly exercised.
- Existing custom layouts retain their structure and literal copy. The shared designer now preserves canonical invoice, quote and sales-order bindings. There is no historical snapshot backfill and no automatic rewrite of custom templates.
