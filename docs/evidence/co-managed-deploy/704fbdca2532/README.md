# Co-Managed deploy mitigation evidence

## Runtime and diagnosis

The runtime observed for product checks is source `704fbdca25327d9bfc1b53d37771e05a4de3ca08`, build `build-1792910542349`, on port 23377 (`server/.next-review-smoke-704f`). The service wrapper ran from the card's `server` working directory; Next process PID 479053. The canonical 23374 service remains on source `cd28aa9531f7bd465711f90b92bf8592185d9c77`, build `build-1792904848073`. It was not replaced.

Auth diagnosis and cookie timeline are in `session-diagnosis.json`. The server cookie helper now delegates both cookie name and configuration to `@alga-psa/auth/session`, aligning Express, Edge, portal-token issuers and NextAuth readers on the same name and JWT salt. Production cookie suffix selection uses a nondefault port from the public URL only; the internal `PORT=3000` does not override `https://example.com`. No source repair has been built into an application runtime.

## Recordings and walkthrough coverage

The packet has 14 distinct current-704f WebM, timed VTT and JSON artifacts. Media playback and chapter seeking are verified. All 14 corresponding guide walkthrough scenarios are explicitly **incomplete**: those clips only show route entry and initial page state. They are retained as media artifacts, not accepted guide walkthroughs. See `video-coverage.json`, `playback-verification.json`, and `media-inventory.json`.

Two separate bounded product checks in `supplemental/` record QA's native-ticket search/clear/reload and the Customer Tickets oversight-queue selection/reload. Both isolated sessions were signed out. It is not a customer test or complete ticket acceptance. Search returned three related rows for `TIC001022`; exact-ticket-only behavior was not asserted.

## Promotion and remaining acceptance

`promotion-preparation.md` contains the documented conclude/ensure lifecycle with the service wrapper. It was not run because ensure starts an application process, prohibited by this step. The old target remains running. `workflow-open-review` returned `Browser backend disposed`; direct QA entry on the promoted candidate is unconfirmed.

The latest PLAN checks added here cover native ticket search and the Customer Tickets queue selector. Prior bounded October 25 product results remain in `docs/evidence/co-managed-deploy/cd28aa9531f7/runtime-acceptance.json`; they remain tied to cd28 and are not relabeled as 704f. Available supported checks should continue with isolated actors. Real Microsoft authority, customer-owned provider and inbound-mail integrations, full paid recovery, and other unavailable external dependencies remain unverified; other supported flows also remain unverified until recorded. The completion census keeps readiness false.
