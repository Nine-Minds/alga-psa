# SLA escalation mitigation recheck — 2026-11-04

## Revision and implementation

The exact application revision checked is `95c743d54b762a47b4356fdd8f85e59096a6c938` (`95c743d54b`). No application code changed during this recheck. The branch's only plan document is `docs/plans/2026-11-03-sla-escalation-assignee-resource-plan.md`; it explicitly says no approved Design Session plan was available, so it remains a requirements document rather than an approved design.

Inspection of `packages/sla/src/services/escalationService.ts` confirms that the manager-equals-assignee path returns `already_assignee` without inserting a resource, an existing manager resource returns `existing_resource` without inserting a duplicate, and the attachment operation is isolated in `withSavepoint`. Attachment failure is caught outside the savepoint so escalation/audit/notification processing can continue. The existing DB integration coverage exercises these cases, an ordinary distinct-manager insertion, attachment failure isolation, and re-run idempotency.

## Checks on this revision

- `packages/sla`: `npx vitest run src/services/__tests__/escalationService.test.ts` — 35 passed.
- `server`: `TEST_DB_NAME=sla_escalation_20261104_95c743d54b npx vitest run src/test/integration/sla/escalationService.integration.test.ts --config vitest.config.ts --coverage.enabled=false` — 8 passed.
- `packages/sla`: `npm run build` — passed.
- `packages/sla`: `npm run typecheck` — passed.

These are automated checks. They do not establish a live application or Temporal escalation.

## Board service recovery investigation (corrected project ID)

The prior `bfa780437e` report queried the mistyped UUID `ddc5d8a2-7d5b-43fc-bbfc-72c31ab17fab`. That UUID is not this card. The correct project is `ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab`; it exists, is on Draft Implementation, and its board registry lists live `temporal-server` and `temporal-worker` services. The prior missing-project conclusions and failed fact-write conclusion are retracted.

The correct project's service inventory contains four historical concluded `dev-server` registrations. Registration :4 is the required worktree/server command `PORT=3122 npm run dev`, cwd `/home/robert/alga-copies/feature-sla-escalation-fails-every-time-when-escalation/server`, concluded at `2026-11-03T18:43:09.436Z`. It is not live. The current `temporal-server` and `temporal-worker` registrations are live, with the worker configured for `TEMPORAL_ADDRESS=127.0.0.1:17356`, queues `alga-jobs,sla-workflows`, and health port 28087.

Recovery attempts against the correct project:

- `alga-dev workflow-ensure-service --projectId=ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab --name=dev-server` returned `Error: --command is required to start a new service`.
- `alga-dev workflow-restart-service --projectId=ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab --name=dev-server` returned `Error: No live service "dev-server" for project`.
- `alga-dev workflow-heal-service --projectId=ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab --name=dev-server` returned the same no-live-service error.

Inspection of `/home/robert/alga-dev/ghostty-pane-ide/src/main/workflow/WorkflowCardServiceService.ts` and its CLI dispatch confirms `ensureService` only respawns an existing live registration; with no live registration it requires a command to create one. Restart and heal operate only on live registrations. There is no separate saved-definition restore/register operation in this CLI version. The exact missing supported operation is one that can revive or recreate a concluded card-service registration from its saved command/cwd without passing `--command` to service creation. No lifecycle records were falsified and no unmanaged app process was launched.

The named origin `http://feature-sla-escalation-fails-every-time-when-escalation.localhost:3122/api/health` still refused the connection (curl exit 7, HTTP 000). At `2026-11-04T03:58:25Z`, `http://127.0.0.1:28087/health` returned healthy, with both `alga-jobs` and `sla-workflows` `RUNNING`; Docker showed `card-ddc5d8a2-temporal` up with `127.0.0.1:17356->7233/tcp`.

## Live proof and durable facts

No current-revision live ticket, Temporal workflow run, delivery evidence, feature screenshot, or walkthrough video was produced because the named origin could not be recovered under the stated constraints. Historical TIC001194 was left untouched. Existing historical evidence in `evidence/review/r07-temporal-summary-TIC001194.txt` predates this application revision and is not presented as proof of the mitigation.

The corrected discovery was recorded successfully as board fact `2592e8ba-06cb-4ffa-a7f0-4b323861b2f9` on the correct project, step `Draft Implementation`, actor `agent:Draft Implementation`.

## First reviewer actions

Expose a supported saved-service registration recovery path for the existing concluded :4 record, then use command-free `workflow-ensure-service` and repeat the live scenario through the named origin. The card/project record exists; only the dev-server registration is concluded. Existing plan and automated checks remain the implementation baseline; do not treat them as live application proof.
