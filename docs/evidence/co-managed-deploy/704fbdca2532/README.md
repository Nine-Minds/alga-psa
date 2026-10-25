# Co-Managed deploy mitigation evidence

## Runtime and diagnosis

The serving candidate tested for this packet is source `704fbdca25327d9bfc1b53d37771e05a4de3ca08`, build `build-1792910542349`, on port 23377 (`server/.next-review-smoke-704f`). The canonical 23374 registration still serves the older `cd28aa9531f7bd465711f90b92bf8592185d9c77` / `build-1792904848073` runtime. Health and process details are in `runtime-acceptance.json`.

The session diagnosis and counterfactual are in `session-diagnosis.json`. The source repair moves explicit port scoping before the Auth.js cookie prefix; focused tests show the pre-fix cookie is deleted as a token chunk and the repaired name is not consumed. The repair is source-only and has not been built/deployed. Existing revocation and identity mismatch checks remain fail-closed; `nextAuthOptions.sessionExpiry.test.ts` and `getSession.test.ts` passed.

## Current-build guide recordings

The packet contains 14 unique WebM files, 14 timed chapter VTTs and 14 recording JSON files. They were recorded from isolated Chromium QA navigation on the 704f runtime. Every packet page was browser-checked for one player, playback and chapter seek; all WebM endpoints returned HTTP 206 for byte ranges. See `video-coverage.json`, `playback-verification.json`, and `media-inventory.json`.

All walkthrough scenarios are **partial**. QA is the only actor; no customer identity, durable mutation, workflow acceptance, or per-route post-reload result is claimed. A successful HTTP route or playable clip is not scenario acceptance. The separate historical cd28 recordings remain unchanged.

## Promotion and remaining acceptance

`promotion-preparation.md` contains the exact documented conclude/ensure lifecycle. It was not run because ensure starts an application process, prohibited by this step. The old target remains alive. `workflow-open-review` returned `Browser backend disposed`; direct QA Open Review on 704f was not verified.

The broader acceptance matrix remains incomplete. Existing settled evidence in the plan and prior completion packet is retained; this packet adds no new acceptance for multipart/PSA/SSR, real Microsoft credentials and negative cases, real customer-owned provider/email cases, exports/restores, external paid entitlements, complete financial ownership, or departure/upgrade on separate disposable relationships. Simulator evidence remains simulator evidence. The generated completion census keeps all unsupported requirements unverified or externally blocked and all readiness gates false.
