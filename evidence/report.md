# Quote PDF filename mitigation verification

Date: 2026-09-26
Branch: `feature/alga-2026-0002563-quote-pdf-filename-from-the-qu`

## Specification and starting state

- No approved quote-PDF plan was present in `git log main..HEAD --name-only -- docs/plans/`; implementation follows the work order and the existing captain decision recorded on the workflow card.
- The checkout initially had no `evidence/report.md`; the preceding smoke report and redacted browser artifacts were available at `/tmp/alga-smoke-evidence/alga-2026-0002563-20260926T0128/`.
- Branch started clean at `bc89030a2b` (`feat(quotes): name quote PDFs after the quote title`). Existing implementation already centralizes sanitization in `packages/core/src/lib/fileNames.ts`, uses it for email/MSP/client portal file names, and stores new quote PDFs with the sanitized title.

## Runtime diagnosis

- `alga-dev workflow-list-services --projectId=8d66540d-7753-41f1-85c4-41a8203b39c4 --live=true` reported no running services. `ss -ltnp | rg ':3050\\b'` showed no listener and `curl http://127.0.0.1:3050/` failed to connect. The board suspended `dev-server` when this step began. Per work order, this pass did not start the service.
- Prior board smoke run verified the process cwd was this worktree's `server`, compose project `alga-psa-local-test` had Postgres/PgBouncer/Redis running, and a clean curl got HTTP 200. The real browser got HTTP 431 for `localhost`; `127.0.0.1` and fresh `127.0.0.2` rendered the page shell but stayed at “Loading translations…” with no inputs.
- Archived network capture records the `127.0.0.2` sign-in page and its script requests as HTTP 200. It contains no locale request events. Archived console output repeatedly records `/_next/webpack-hmr` WebSocket `ERR_INVALID_HTTP_RESPONSE`. These observations do not establish whether the stall is a client initialization issue or a board/dev-server transport issue, or whether HMR failure causes the stall. Runtime root cause remains unconfirmed.
- Browser login, authenticated navigation, live email attachment, and actual browser download/header checks could not be rerun because port 3050 was unavailable. Do not interpret the previous clean curl response as UI readiness.

## Changes and code-level filename review

- The client portal formerly selected the latest stored quote `file_id` but returned the current title as the anchor filename. The download endpoint serves stored document metadata, so after a quote rename the real `Content-Disposition` could remain stale. The action now selects `document_name`, reuses a stored PDF only when that name matches the sanitized current quote title, and otherwise generates a fresh stored PDF. It uses the existing core helper and adds no billing dependency.
- Added regression coverage for a renamed quote with an old stored document name. Updated PDF generation service expectations to verify title-derived storage names.
- Static source review confirms email attachments use `getQuotePdfFileName`, MSP quote download actions return the sanitized title, generated stored PDFs set `documents.document_name` to that title, and the client portal uses `buildDocumentFileName` directly. The shared helper still falls back to `Quote_<number>.pdf` (or quote ID when number is absent) when the title sanitizes empty.
- Actual response `Content-Disposition`, resulting browser filename, renamed-record download, and email attachment delivery remain unverified in a live session.

## Checks

- `npm run test -w @alga-psa/client-portal -- --run src/actions/client-portal-actions/client-billing.quote.test.ts` — passed, 16 tests.
- `npm run test -w @alga-psa/core -- --run src/lib/fileNames.test.ts` — passed, 9 tests.
- `npm run test -w @alga-psa/billing -- --run tests/quote/quoteFileNames.test.ts tests/quote/quoteActions.test.ts tests/quote/quotePdfGenerationService.test.ts` — passed, 56 tests.
- `npm run typecheck -w @alga-psa/client-portal`, `npm run typecheck -w @alga-psa/billing`, and `npm run build -w @alga-psa/core` — completed successfully.

## Prior browser artifacts

The prior smoke evidence is redacted and stored outside the repository at `/tmp/alga-smoke-evidence/alga-2026-0002563-20260926T0128/` (`report.md`, screenshots, `network.json`, `console.json`, and `dom.json`). No credentials or session secrets are included here.
