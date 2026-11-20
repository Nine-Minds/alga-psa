# Ticket search authorization benchmark

Governing specification: [PRD](../PRD.md). This is a reproducible PostgreSQL comparison for the ticket query path, with a stated scope limitation below.

## Revisions and fixture

- Baseline: `5cdc72b0d450943c6b92b0f7fb856920f89e44e7`.
- Revised implementation: `1850eefecb` (implementation commit; benchmark harness included in this revision).
- PostgreSQL: 15.4.
- Isolated databases: `pr4133_bench_base` and `pr4133_bench_revised`; each run creates randomized temporary fixture tables and drops them afterward. No application server was started.
- Fixture: 1,500 matching ticket search rows; 150 readable and 1,350 denied under the restrictive selected-client policy. The unrestricted policy admits all 1,500. Requests use `needle`, page size five, fixed ranking timestamp, and a stable cursor positioned before the later page.
- Procedure: same benchmark test source, fixture generation, request inputs, access assignments, instrumentation, and assertion procedure on both revisions; 3 warm-up requests and 20 measured requests per scenario, concurrency 1. p95 uses nearest-rank sample 19 of 20. Query count is the median number of calls to `knex.raw` for search SQL in each request; fixture creation and other setup queries are outside measurement.
- Correctness assertions check exact first-page/later-page identities, authorized total and ticket group count on every measured request.

## Raw measurements

| Request | Authorization | Baseline p95 (ms) | Baseline search SQL calls/request | Revised p95 (ms) | Revised search SQL calls/request | Revised evaluator rows/request |
|---|---|---:|---:|---:|---:|---:|
| Broad five-hit typeahead | Unrestricted | 377.67 | 16 | 10.59 | 2 | 0 |
| Broad five-hit typeahead | Restrictive | 357.57 | 16 | 11.46 | 2 | 0 |
| Later search page | Unrestricted | 245.46 | 16 | 14.09 | 2 | 0 |
| Later search page | Restrictive | 253.63 | 16 | 17.25 | 2 | 0 |

The revised SQL path used two search statements per request (authorized type count and page). Relative to this harness's baseline, the measured p95 was lower by 96.9%, 96.8%, 94.3% and 93.2% respectively. Both baseline and revised outputs matched the fixture's expected identities and totals.

## Measurement limitation

The harness stubs `verifyResultVisibility` on both revisions. This makes query counts and latency comparable for the candidate-scan/search-query portion, and the revised path confirms that supported ticket queries avoid candidate transfer/evaluator work. It does not measure real per-ticket policy reconstruction and authorization SQL on the baseline, nor real policy resolution overhead on the revised path. Thus the performance figures are not a complete end-to-end authorization benchmark and do not close PRD checklist T004. T002 also remains open for real PostgreSQL comment audience/tenant, mixed-type, unsupported-rule and resolver-failure coverage. See [verification results](verification.md) and the [plan checklist](../tests.json).
