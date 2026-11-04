# REST project read redaction design

## Problem
`authorizeApiResourceRead` currently discards authorization `redactedFields`, so REST project reads can expose fields that policy allows the caller to know about only in redacted form. Derived statistics and exports can also reveal values sourced from hidden fields.

## Design
- Return the kernel decision as `{ allowed, redactedFields }` from the shared API authorization helper.
- Use one `projectRecord(record, redactedFields)` projector for REST project get, list, search, export, and statistics inputs.
- Match both canonical field aliases and source dependencies for derived fields such as client and status names.
- Use the co-managed relation-aware field and whole-resource hiding primitives. Omit a project when the resource or its identifier is hidden.
- Keep list pagination authorization-aware and project the allowed row before serialization. Export JSON/CSV and statistics consume projected rows only; omit aggregate outputs whose source fields are hidden.
- Preserve unrestricted behavior and denied-read behavior.

## Verification
Behavioral tests cover field and relation redactions, aliases, derived dependencies, row suppression, REST serialization paths, unrestricted reads, and denied reads. Run focused unit tests and the server typecheck without starting the app server.

## Shared reader coverage
The authorization helper is shared by project, ticket, quote, and asset readers. All callers must consume the decision object. `server/src/lib/api/controllers/apiRecordProjection.ts` provides the common projection mechanism; `projectRecord.ts` supplies the project wrapper.

| Consumer | Projection requirement |
| --- | --- |
| Project get, list, search, JSON/CSV export, statistics | Serialize projected rows; omit aggregates when their source fields are hidden. |
| Ticket reads and statistics | Project records and derived names before serialization or aggregation. Disable SQL authorization narrowing when field policies require kernel decisions. |
| Ticket project links | Project each link with its project's decision, including project, phase, and task name aliases. An allowed-ID set alone loses field restrictions. |
| Quote reads and conversion preview | Project quote records; omit preview collections and totals when contributing item fields are hidden. |
| Asset, inventory, and document asset guards | Carry projected asset records through the read boundary, including nested client, vendor, contact, and warranty dependencies. |
| Authorization-aware pagination | Require a projector for decisions containing field policies. Count only allowed, non-null projections and return those projections. |

Projection recursively handles plain objects and arrays while preserving scalar objects such as `Date`. Source records must remain unchanged. A hidden resource or identifier produces a null projection; list paths omit it and detail paths treat it as unavailable.

Run the focused response and projection regressions from `server/`:

```sh
../node_modules/.bin/vitest run \
  src/test/unit/api/apiProjectRedactionResponses.test.ts \
  src/test/unit/api/apiQuoteRedactionResponses.test.ts \
  src/test/unit/api/apiAssetReadProjection.test.ts \
  src/test/unit/api/projectRecord.test.ts \
  src/test/unit/api/ticketStatsAuthorizationResponse.test.ts \
  src/test/unit/api/ticketProjectLinksController.test.ts \
  src/test/unit/api/authorizationAwarePagination.test.ts \
  --maxWorkers=1 --coverage.enabled=false
```

These tests exercise controller responses, projection behavior, and pagination with controlled authorization decisions. Published-policy consumption through the real application requires a separate live smoke test. Review-guide availability, fixture replay, and application HTTP readiness require a running application environment; the draft step's instruction to keep the app stopped cannot establish those conditions.
