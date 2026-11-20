# Search authorization repair verification

Tested implementation revision: `1850eefecb` (`1850eefecb` is the exact committed tree tested below). Governing specification: [PRD](../PRD.md).

## Completed checks

- Workspace package typechecks: `npx tsc --noEmit -p packages/tickets/tsconfig.json` and `npx tsc --noEmit -p packages/search/tsconfig.json` — passed at `1850eefecb`.
- Package build targets: `npx nx run search:build` and `npx nx run tickets:build` — passed at `1850eefecb`. The supported tickets target is Nx; the direct workspace build script is not used.
- Affected Vitest suites: search authorization regression, search actions, API search controller, ACL, query, app search, PostgreSQL ranking cursor, five Bento-read authz tests, two sibling-record authz tests, and ticket record authorization — 10 files, 98 tests passed at `1850eefecb`.
- PostgreSQL ranking cursor suite: 2 tests passed at `1850eefecb`. Its isolated randomized fixture verifies 24 indexed tickets under unrestricted policy, and 5 of 24 under a restrictive selected-client policy. A 19-ticket denied prefix precedes readable tickets; exact totals and unique stable pages are asserted until the cursor terminates.
- Seven-read regression coverage: five Bento protected reads plus both sibling reads passed in the affected suites at `1850eefecb`.

The application server was not started. No application server build service was requested.

## Scope still open

The plan checklist deliberately leaves T002 and T004 false. The current PostgreSQL search regression covers ticket SQL policy pagination, but does not yet compare production compiled and record decisions for comment audience/tenant cases, mixed types, unsupported policies and resolver failure in one real PostgreSQL fixture. The benchmark below uses the same visibility-evaluator stub on both revisions to isolate candidate scan/query work; it does not include the baseline's per-record authorization resolver SQL or prove end-to-end equivalence of all comment policies. No fresh browser walkthrough or production handoff was performed.
