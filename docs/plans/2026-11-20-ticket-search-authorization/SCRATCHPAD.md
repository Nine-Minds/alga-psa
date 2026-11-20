# Implementation handoff

Human review held PR #4133 at `5cdc72b0d4`. Retain the verified Bento repair. Capture performance on this baseline before changing search so the two revisions can be compared using the same fixture.

- Current scan and public pagination live in `packages/search/src/runAppSearch.ts`. Typeahead requests five hits and an exact total in `server/src/lib/actions/searchActions.ts`.
- Ticket and comment source verification lives in `packages/search/src/acl.ts`. The single-record helper creates a context per call in `packages/tickets/src/lib/ticketRecordAuthorization.ts`.
- Start from `applyTicketReadAuthorizationSql` in `packages/tickets/src/actions/optimizedTicketActions.ts`. The list uses the compiler’s supported result for counting and paging and the kernel for unsupported rules. Expose the shared policy at a layer both the list and search can use. Keep policy-resolution errors distinct from unsupported compilation.
- The card previously recorded `skipped-no-spec`. This plan supplies the scope for the return to Draft Implementation. Existing smoke evidence applies to the baseline. The revised build needs its own test and performance evidence.

## Repair round findings

- `ticketRecordAuthorization.ts` now owns the authorization context and shared SQL compiler call used by both optimized ticket lists and search. Search resolves that context once, compiles the ticket and live-comment-parent predicates, and uses the same predicate for exact type counts and cursor pages.
- Supported ticket/comment policies bypass the candidate scan. Other object types continue through their existing verifier and are merged with the direct ticket page. Unsupported ticket rules batch-load source rows and reuse the request context with the record evaluator. Resolution failures deny ticket and comment hits.
- The real PostgreSQL regression uses randomized tables and verifies a restrictive selected-client policy after 19 denied ticket matches, exact counts, unique stable pages, plus unrestricted counts/pages.
- The reproducible baseline/revised benchmark harness uses 1,500 broad ticket matches (150 readable, 1,350 denied), PostgreSQL 15.4, 3 warmups, 20 measured samples and concurrency 1. Its visibility evaluator is intentionally stubbed to isolate candidate-query work; it does not measure the baseline's per-ticket authorization resolver SQL. Report that limitation with the numbers.
- Current verification covers search action/API, ACL, query/ranking, PostgreSQL pagination, all five Bento-read authorization cases and both sibling-read authorization suites. Full T002 coverage for PostgreSQL comment audience/tenant behavior and a benchmark including real resolver SQL remains open.
