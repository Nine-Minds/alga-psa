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

These tests exercise controller responses, projection behavior, and pagination with controlled authorization decisions.

## Live verification record — 2026-11-04

Application revision `efc631371a53375d7f52281ca3a80b0a69ddebf0` was exercised against the already-running worktree server on port 3322. The server process was PID 1457976 before and after the replay; it was not started or restarted. A temporary internal user, role, API keys, five published API-key-targeted bundles, and one project-ticket link were created in the connected test tenant. Nineteen live assertions passed across project get/list/search/JSON and CSV export/statistics, ticket get/list/search/statistics/project links, quote conversion preview, asset detail, hidden project identifier suppression, real app sign-in, and authenticated app links. Project links omitted project, phase, and task names; quote previews suppressed line items and derived totals; nested asset relationships and warranty fields were omitted.

Authenticated browser routes reached `/msp/projects`, the project and ticket detail routes, the quote tab, and the asset detail route without redirecting to sign-in. The captain-reachable review guide at `http://100.109.101.64:43972/index.html` returned HTTP 200; all 128 same-host guide assets and links checked returned HTTP 200. Cleanup removed the temporary user, API keys, bundles, role, session, user preferences, and test link. The pre/post snapshot of existing authorization rules matched. Current run output is retained at `/tmp/authz-live-replay-20261104/replay-results.json`, `authenticated-links.json`, `cleanup.json`, and `guide-link-check.json`.

The workflow command still needs external host activation. Before publication, `alga-dev workflow-open-review --lightweight=true --activate=false --projectId=24e3f7a9-3a3e-5a07-b612-835a7894c319` returned `Unknown workflow command: workflow-open-review`. The supported platform command `npm run deploy:publish` was run from an isolated checkout pinned to `Nine-Minds/alga-dev` revision `120bdcad6ad9a1cbf830ec39189f532bb67f4999`; its test `vitest run tests/workflow/open-review-cli.test.ts` passed (4 tests). It published bundle `202611040814-g120bdca` (SHA-256 `fb764b7094bd169c74f0c38a2bee25cf2d613528cf8d0f6dd498e8fc9b4106d0`) as `deploy/desired-version` revision 32583. The active host release marker and agent process still reported `202611040722-g518a7e9` after publication. Host-status revision 32586 at `2026-11-04T08:17:16.624Z` still reported `running=desired=202611040722-g518a7e9`, `state=up-to-date`, while desired-version revision 32583 named `202611040814-g120bdca`. A fresh `workflow-open-review` call still returned `Unknown workflow command: workflow-open-review`. The Alga Dev host owner must investigate why the supervised agent is not converging on the published desired version (including its NATS watch and supervisor logs), then use the supported host promotion path and rerun the workflow command to confirm its `guideUrl` and `readinessUrl`. No application server restart is part of that handoff.

The focused application suite (42 tests) and server typecheck passed on this application revision before this live-only follow-up; no application source changed during the follow-up. The plan's live-smoke requirement is now verified. The workflow dispatcher activation remains pending as described above.


## Task-name preservation and dispatcher activation — 2026-11-04 20:18 UTC

PSA commit `f6260cde0251fe4bc78a2d764af9ab0309e2c63f` separates task-name field dependencies from whole-task resource aliases. Projector and controller response regressions preserve `task_name` under isolated `project_tasks.estimated_hours` and `project_tasks.project_name` restrictions while omitting the restricted field. Identifier and whole-resource suppression remain covered. The five focused suites passed independently (33 tests). Server typecheck and production build passed in the builder run at this commit with a 12 GB heap. The app server was not started or restarted; port 3322 refused connections during takeover, so published-policy HTTP replay of this repair remains unverified.

The dispatcher activation gap recorded above is resolved. The Mac publisher's source was recovered through its registered Alga Dev agent at `100.70.145.1:47800`, using the protocol identify handshake and the exec/file-transfer channels. SSH was unavailable. The isolated repair checkout descends from active release source `4039ef59b4683c0e463451380ac2659121775425` through Mac source commit `65542cc2c4`. It retains the seven required capabilities, including stack migration, execution safeguards, and service registration.

Platform commits `79bf25d` and `ec142e4f4b29d620058f8968ef79062ee04f484c` are published on [Alga Dev's fix/authz-review-readiness branch](https://github.com/Nine-Minds/alga-dev/tree/fix/authz-review-readiness). The repair routes lightweight, non-activating review requests through the headless agent and returns readiness only after the guide's HTTP probe succeeds. Routing accepts both boolean arguments and the string arguments emitted by the installed CLI. Eight tests passed across engine routing, successful and failed guide readiness, compatible release promotion, and the real CLI reply deadline. Platform typecheck and agent/runner builds passed.

The supported publisher promoted `deploy/compatible-release.v1` revision 32924 to `20261104201747-gec142e4`, SHA-256 `d0045cfdde22dd0d1ee05cb81f4a2ce32290313a4d2f99c4400d2c5b74a97dc8`. Linux host-status revision 32932 and Mac host-status revision 32937 reported this version as both running and desired, with state `up-to-date`.

The exact command succeeded after activation:

```sh
alga-dev workflow-open-review --lightweight=true --activate=false --projectId=24e3f7a9-3a3e-5a07-b612-835a7894c319
```

```json
{"lightweight":true,"guideUrl":"http://100.109.101.64:43972/index.html","readinessUrl":"http://100.109.101.64:43972/index.html","activated":false}
```

A separate curl executed on the captain host `100.82.172.57` through its registered agent returned HTTP 200 for the returned `readinessUrl`. Evidence is retained under `/tmp/authz-takeover/`: `platform-tests.log`, `platform-typecheck.log`, `platform-build.log`, `contract.log`, `publish.log`, `active-release.json`, `linux-activation.json`, `mac-activation.json`, `open-review.json`, and `captain-http.log`. Workflow facts record the recovered source path and verified activation.
