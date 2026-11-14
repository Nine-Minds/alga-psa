# SLA escalation live verification status

Revision inspected: `95c743d54b762a47b4356fdd8f85e59096a6c938` (`95c743d54b`).

## Implementation and checks

The current implementation follows the mitigation in `docs/plans/2026-11-03-sla-escalation-assignee-resource-plan.md`. `escalateTicket` calls `ensureEscalationManagerOnTicket`; the helper uses a savepoint, returns `already_assignee`, `existing_resource`, or `added`, skips an additional resource for the primary assignee, and updates an existing resource's escalation role. Repository search found no other SLA path attaching escalation managers. The integration suite covers the manager-equals-assignee case, persisted escalation/audit/in-app notification state, retry idempotency, existing-resource reuse, distinct-manager insertion, and attachment failure isolation.

Checks run on this revision:

- `npx vitest run src/services/__tests__/escalationService.test.ts` in `packages/sla`: **35 passed**.
- `TEST_DB_NAME=sla_escalation_20261103_95c743d54b npx vitest run src/test/integration/sla/escalationService.integration.test.ts --config vitest.config.ts --coverage.enabled=false` in `server`: **8 passed**.
- `npm run build` in `packages/sla`: **passed**.
- `npm run typecheck` in `packages/sla`: **passed**, no diagnostics.

The integration test mocks email transport and event publishing. Its internal notification database assertion verifies persistence, not delivery through a live email transport or Temporal-triggered application execution.

## Named-origin startup blocker

The required recovery invocation was run without a command:

```text
alga-dev workflow-ensure-service --projectId=ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab --name=dev-server
Error: --command is required to start a new service
```

`workflow-list-services` inventory for this project had four `dev-server` records, all concluded:

| Registration | Saved port | Status | Concluded |
| --- | ---: | --- | --- |
| `card-service:ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab:dev-server:1` | 3854 | concluded | 2026-11-01 23:25:48 UTC |
| `card-service:ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab:dev-server:2` | 3898 | concluded | 2026-11-02 01:08:42 UTC |
| `card-service:ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab:dev-server:3` | 3551 | concluded | 2026-11-02 03:55:10 UTC |
| `card-service:ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab:dev-server:4` | 3122 | concluded | 2026-11-03 18:43:09 UTC |

The service manager reports that a new service requires `--command`. That option was not supplied, and no service was recreated, no standalone application server was started, and the named origin was not bypassed. A direct health probe to the configured named origin `http://feature-sla-escalation-fails-every-time-when-escalation.localhost:3122/api/health` also failed with curl exit 7: `Could not connect to server` (HTTP 000). Therefore the requested live UI flow could not run.

## Temporal readiness observation

The card-isolated endpoint was present as Docker container `card-ddc5d8a2-temporal`, listening at `127.0.0.1:17356` (`docker ps`: `Up 3 hours`, port mapping `127.0.0.1:17356->7233/tcp`). The built worker health endpoint at `http://127.0.0.1:28087/health` returned HTTP 200 with `worker: running` and queues `alga-jobs: RUNNING` and `sla-workflows: RUNNING`. No escalation workflow was started because the application service was unavailable.

## Live evidence status

No current-revision application screenshot or walkthrough video demonstrates escalation, audit/notification persistence through the live app, absence of a prohibited resource row, idempotent re-run, or adjacent resource attachment cases. No direct DB execution was used as a substitute for application proof. Historical TIC001194 was not modified. The earlier unavailable-app screenshots under `/tmp/alga-smoke-evidence/sla-manager-assignee-20261103T1828Z` are not evidence of the requested live acceptance.

Reviewer should first inspect the escalation helper and its integration coverage, then resolve the board-managed service startup restriction and repeat the live walkthrough through the project's named origin.
