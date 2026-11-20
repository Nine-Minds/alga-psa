# Ticket read authorization in summaries and search

Tracking ticket `alga-2026-0003054`. [PR #4133](https://github.com/Nine-Minds/alga-psa/pull/4133)

## Why this change is needed

A technician with ticket read permission can still be restricted to particular clients or boards. Opening a ticket, reading its summary, and searching for its title or comments must respect the same record policy. Search totals can also disclose a restricted record.

At the reviewed revision `5cdc72b0d4`, the protected reads and search concealment have behavioral evidence. Search achieves exact counts by fetching every matching candidate in batches of 100 and verifying rows serially. Even a five-suggestion typeahead rebuilds ticket authorization context per ticket hit. A subsequent page starts the scan again. The 102-candidate PostgreSQL case verifies correctness. Interactive performance at larger match counts remains open.

## Required behavior

- Preserve the five Bento reads and both sibling reads. Authorize before reading protected data. An excluded ticket and a missing ticket produce the same public denial. Use the authorized ticket for dependent lookups.
- For sidebar typeahead, full search and the shared search API, resolve ticket read policy once per request. Reuse the ticket list’s tenant-scoped SQL authorization compiler for supported rules. Use the resulting set of readable ticket IDs for both ticket hits and the live parent of each comment. Check comment publication, deletion, internal visibility and audience against the source records.
- Apply visibility before computing result slots, exact totals, per-type counts and cursor boundaries. For supported ticket policies, PostgreSQL should count and page the readable matches directly. A five-hit typeahead or later page must avoid transferring and authorizing every matching ticket in the application.
- If the compiler reports an unsupported rule, batch-load the relevant records and use the shared record evaluator with a request-scoped context. A resolver failure must deny affected records. Maintain existing search-index access restrictions and verification for other result types, including mixed searches.
- Preserve the existing UI and API shapes, ranking timestamp, stable ordering, and public pagination behavior. The work concerns read queries and requires no change to stored customer data.

## Acceptance evidence

1. Exercise included, excluded and absent tickets, portal comment visibility, tenant isolation, and policy failure. Compare SQL decisions to the record evaluator for representative policies. Verify that unauthorized tickets and comments never affect results or counts, including in mixed-type searches.
2. Run the seven protected-read regressions and the real PostgreSQL delayed-pagination regression on the revised head. Show later readable hits after a long denied prefix, exact totals and per-type counts, unique pages and a terminating cursor.
3. Compare the reviewed baseline and revised head on the same PostgreSQL fixture sized to represent a large tenant, with broad matches well beyond 102. Exercise five-result typeahead and a later full-search page under unrestricted and restrictive policies. Record fixture and match counts, result equivalence, run count, concurrency, p95 latency and SQL statement count per request. Show that increasing ticket matches does not add a database round trip per ticket on the compiled path. State the measured improvement and any remaining cost from other object types. No numeric latency budget was supplied.
4. Link this PRD, the passing PostgreSQL result, and the before/after measurements from the review guide for the revised commit. Explain how the change addresses the performance hold.
