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
- Board-service restoration is an external prerequisite for any browser rerun. This mitigation did not start or restart the application server.

## Offline i18n reproduction and repair

- Source inspection found `i18nInitialized` was set only after awaiting `i18next.init()`, so overlapping provider effects could both call `init()` (React StrictMode does this on mount in development). The provider effect also attached only `.then()`: a rejected initialization promise was unhandled and left `isInitialized` false indefinitely.
- Added a shared in-flight initialization promise. All concurrent mounts await the same `i18next.init()` call; a rejected promise clears the shared slot so a later mount can retry.
- Added a rejection handler in `I18nProvider` that logs the initialization error and releases children instead of keeping the bootstrap screen forever. i18next hooks use `useSuspense: false` because the provider owns readiness; they can return fallback keys after init failure rather than suspending indefinitely.
- `client.initialization.test.tsx` reproduces StrictMode effect replay with a rejected initializer. It confirms one `init()` call, no lingering loading screen, rendered sign-in content, and successful retry on a later mount. Namespace-load rejection and load ordering remain covered by `namespaceReadiness.test.tsx`.

## Download response headers

- Extracted the production document download `Response` construction into `createDocumentDownloadResponse`; `downloadDocument` uses this function directly.
- RFC 5987 encoding now percent-encodes `!'()*` left untouched by `encodeURIComponent`, preventing invalid `filename*` values for ordinary apostrophes and parentheses.
- `quotePdfDownloadResponse.test.ts` creates actual `Response` objects through that production function and parses `Content-Disposition` with the installed `content-disposition` parser. Seven cases recover the filename for stored, renamed, apostrophe, parentheses, Unicode, Unicode plus punctuation, and `Quote_Q-0042.pdf` fallback artifacts.
- This verifies response header construction offline. Browser download UX and live route/database/storage integration remain unverified until the board service is restored.

## Changes and code-level filename review

- The client portal formerly selected the latest stored quote `file_id` but returned the current title as the anchor filename. The download endpoint serves stored document metadata, so after a quote rename the real `Content-Disposition` could remain stale. The action now selects `document_name`, reuses a stored PDF only when that name matches the sanitized current quote title, and otherwise generates a fresh stored PDF. It uses the existing core helper and adds no billing dependency.
- Added regression coverage for a renamed quote with an old stored document name. Updated PDF generation service expectations to verify title-derived storage names.
- Static source review confirms email attachments use `getQuotePdfFileName`, MSP quote download actions return the sanitized title, generated stored PDFs set `documents.document_name` to that title, and the client portal uses `buildDocumentFileName` directly. The shared helper still falls back to `Quote_<number>.pdf` (or quote ID when number is absent) when the title sanitizes empty.
- Actual response `Content-Disposition`, resulting browser filename, renamed-record download, and email attachment delivery remain unverified in a live session.

## Checks

- `npm run test -w @alga-psa/client-portal -- --run src/actions/client-portal-actions/client-billing.quote.test.ts` — passed, 16 tests.
- `npm run test -w @alga-psa/core -- --run src/lib/fileNames.test.ts` — passed, 9 tests.
- `npm run test -w @alga-psa/billing -- --run tests/quote/quoteFileNames.test.ts tests/quote/quoteActions.test.ts tests/quote/quotePdfGenerationService.test.ts` — passed, 56 tests.
- `npm run test -w @alga-psa/ui -- --run src/lib/i18n/client.initialization.test.tsx src/lib/i18n/namespaceReadiness.test.tsx` — passed, 4 tests.
- `npm run test -w @alga-psa/documents -- --run tests/quotePdfDownloadResponse.test.ts` — passed, 7 parsed response-header cases.
- `npm run typecheck -w @alga-psa/client-portal`, `npm run typecheck -w @alga-psa/billing`, and `npm run build -w @alga-psa/core` — completed successfully.
- `npm run typecheck -w @alga-psa/ui` and `npm run typecheck -w @alga-psa/documents` — completed successfully.

## Prior browser artifacts

The prior smoke evidence is redacted and stored outside the repository at `/tmp/alga-smoke-evidence/alga-2026-0002563-20260926T0128/` (`report.md`, screenshots, `network.json`, `console.json`, and `dom.json`). No credentials or session secrets are included here.

## Mitigation round recheck (2026-09-26)

- Re-established state in this checkout: clean at start, branch `feature/alga-2026-0002563-quote-pdf-filename-from-the-qu`, four task commits ahead of `origin/main`. `git log main..HEAD --name-only -- docs/plans/` contains no approved plan for alga-2026-0002563; unrelated plans in main history are not applicable. Read `docs/AI_coding_standards.md`; no repository-level `AGENTS.md` applies.
- Current board check: `alga-dev workflow-list-services --projectId=8d66540d-7753-41f1-85c4-41a8203b39c4 --live=true` returned `{"services":[]}`; `ss -ltnp | rg ':3050\\b'` found no listener; `curl http://127.0.0.1:3050/` failed with connection refused. No server was started, restarted, or replaced.
- Consequently this round could not retest browser sign-in inputs, authenticated navigation, email delivery, staff/client portal downloads, or live `Content-Disposition` on stored/renamed quote files. No current tested browser origin exists. The archived prior run remains at `/tmp/alga-smoke-evidence/alga-2026-0002563-20260926T0128/`: `localhost:3050` returned HTTP 431 with an empty body; `127.0.0.1` and `127.0.0.2` loaded scripts with HTTP 200 but stayed on “Loading translations…” without inputs; repeated HMR WebSocket handshakes reported `ERR_INVALID_HTTP_RESPONSE`. That capture did not retain request headers for the 431 or identify the layer that rejected it. The exact header set and rejection layer remain unknown; clean curl is not proof of browser readiness.
- Source review reconfirmed `packages/core/src/lib/fileNames.ts` sanitizes titles and falls back to `Quote_<number>.pdf` (quote ID only when number is absent); email and staff actions use the shared helper; PDF generation stores the title-based document name; client portal download checks stored `document_name` and regenerates after rename; document downloads use `createDocumentDownloadResponse` with RFC 5987 encoding. These are code-level findings, not live route evidence.
- Offline regression commands and results:
  - `npm run test -w @alga-psa/ui -- --run src/lib/i18n/client.initialization.test.tsx src/lib/i18n/namespaceReadiness.test.tsx` — passed, 4 tests.
  - `npm run test -w @alga-psa/core -- --run src/lib/fileNames.test.ts` — passed, 9 tests.
  - `npm run test -w @alga-psa/billing -- --run tests/quote/quoteFileNames.test.ts tests/quote/quoteActions.test.ts tests/quote/quotePdfGenerationService.test.ts` — passed, 56 tests.
  - `npm run test -w @alga-psa/client-portal -- --run src/actions/client-portal-actions/client-billing.quote.test.ts` — passed, 16 tests.
  - `npm run test -w @alga-psa/documents -- --run tests/quotePdfDownloadResponse.test.ts` — passed, 7 tests. These construct actual `Response` objects and parse response `Content-Disposition` for stored, renamed, punctuation, Unicode, and fallback names; they do not exercise the live route/storage.
  - `npm run build -w @alga-psa/core` — passed.
  - Package typechecks for client-portal, billing, UI, and documents were started; final outcomes are recorded after completion below.
- No evidence-supported browser/transport repair could be selected while the board-managed service was absent. The previously committed shared i18n init/rejection fallback is covered offline but has not established browser recovery; whether the bootstrap issue is independent of or caused by HMR/transport remains unconfirmed.
- Typechecks: `npm run typecheck -w @alga-psa/client-portal` passed in the initial run. `npm run typecheck -w @alga-psa/billing` first exceeded Node's default 4 GB heap and aborted with exit 134 before diagnostics; rerun `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck -w @alga-psa/billing` passed. `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck -w @alga-psa/ui` and the same command for `@alga-psa/documents` passed. No TypeScript diagnostics were reported. The heap-limit abort is an environment/resource limit, not established as pre-existing source failure.
