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

## Lead takeover verification

At `2026-11-04T03:59:47Z`, command-free ensure against the correct project again returned `--command is required to start a new service`. The named port-3122 health request failed with curl exit 7 and HTTP 000. The worker's `/ready` endpoint returned `ready`, with `alga-jobs` and `sla-workflows` both `RUNNING`.

Source inspection independently confirmed the recovery limitation: `WorkflowCardServiceService.ensureService` reads only a live registration before requiring a new command; `restartService` likewise rejects a concluded registration. Registration :4 retains the required saved command and cwd, but these operations cannot reuse it. Restoring a concluded service from that saved definition requires a supported board recovery operation, or an explicit exception allowing board-managed creation with the saved command. Neither is available under the current command-free constraint. Changing raw lifecycle records or launching an unmanaged process would bypass that constraint.

The project-ID correction is committed in `1cc5e8cb8a6c56344ecb74f811657c9de45c8ac7`. No application changes were made during takeover. The prior automated results remain historical evidence at application revision `95c743d54b762a47b4356fdd8f85e59096a6c938`; they were not rerun for this documentation-only update. Live escalation, retry/idempotency, distinct/existing-resource regression, feature screenshots, and walkthrough video remain incomplete. Service recovery is the prerequisite; Temporal readiness alone does not satisfy them.

## Mitigation round recheck at `33f1945af8e72f7c4367e06aaca0d67442930c0b`

This recheck was performed on 2026-11-04 at the exact working-tree HEAD above. The card is `ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab`, hosted on `ts:robert-X670E-Pro-RS` (`robert-X670E-Pro-RS`), with worktree `/home/robert/alga-copies/feature-sla-escalation-fails-every-time-when-escalation`, server cwd `/home/robert/alga-copies/feature-sla-escalation-fails-every-time-when-escalation/server`, port 3122, and named origin `http://feature-sla-escalation-fails-every-time-when-escalation.localhost:3122`.

The current service inventory still has four concluded `dev-server` records. The latest matching record, `card-service:ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab:dev-server:4`, retains host `ts:robert-X670E-Pro-RS`, the server cwd above, and command `PORT=3122 npm run dev`; it was concluded by `human` at `2026-11-03T18:43:09.436Z` with reason `Live smoke handoff: existing PORT=3122 launch remained blocked by host memory admission; cancel pending launch so this one-shot does not leave queued work`.

Current recovery capability was checked in `/home/robert/alga-dev/ghostty-pane-ide/src/main/workflow/WorkflowCardServiceService.ts` and `/home/robert/alga-dev/ghostty-pane-ide/scripts/cli.mjs`. `ensureService` selects only the latest `live` record, then respawns it; with no live record it returns `--command is required to start a new service`. `restartService` returns `No live service` when there is no live record. CLI help exposes list, ensure, restart, and conclude; source/dispatch exposes no restore, register-from-saved-definition, or service reconcile command. Search found no separate step/service-use restore mechanism. No board persistence was edited, no lifecycle state was falsified, and no unmanaged server was launched. A fresh command-free `workflow-ensure-service --projectId=ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab --name=dev-server` returned `Error: --command is required to start a new service`; `curl http://feature-sla-escalation-fails-every-time-when-escalation.localhost:3122/api/health` failed to connect (curl exit 7). This is the exact unsupported boundary under the no-`--command` constraint.

The card-owned Temporal server remains available at `127.0.0.1:17356`; worker health at `http://127.0.0.1:28087/ready` returned `ready` and queues `alga-jobs` and `sla-workflows` both `RUNNING`. The worker registration uses the same worktree's `server/.env.local`, `TEMPORAL_ADDRESS=127.0.0.1:17356`, namespace `default`, and task queues `alga-jobs,sla-workflows`. That environment file configures the app for DB host `127.0.0.1`, port `6472`, database `server`, and the named origin as `NEXTAUTH_URL`; because the worker sources the same file, the configured DB target aligns. Runtime app connectivity and Temporal-driven ticket execution could not be verified while the app is unavailable.

Checks rerun at the working-tree HEAD above:

- `packages/sla`: `npx vitest run src/services/__tests__/escalationService.test.ts` — 35 passed.
- `server`: `TEST_DB_NAME=sla_assignee_verify_20261104_0409 npx vitest run src/test/integration/sla/escalationService.integration.test.ts --config vitest.config.ts --coverage.enabled=false` — 8 passed.
- `packages/sla`: `npm run typecheck` — passed.
- `packages/sla`: `npm run build` — passed.

Compared with `95c743d54b`, the SLA service implementation and DB integration test have no changes; the unit test mock refinements are part of this working-tree revision and were included in the 35-test rerun. No SLA application changes were made. Database/integration tests prove service behavior only and do not replace live application/Temporal processing.

No successful feature screenshot or ticket walkthrough video could be captured because the named origin is unreachable. Existing blocker-only artifacts from the preceding smoke attempt are `/tmp/alga-smoke-evidence/sla-manager-assignee-20261104T0310Z/01-named-origin-unavailable.png` and `/tmp/alga-smoke-evidence/sla-manager-assignee-20261104T0310Z/smoke-walkthrough.webm` (with `.vtt` and `.json` companions); these show the connection failure, not SLA feature behavior. No current-revision live ticket or workflow execution exists. Historical `TIC001194` remains untouched. Board fact `10a6e83f-0afa-4e67-ba3f-6edd7bedc44e` records this latest capability/state check; no facts were retired because there was no recovery to invalidate prior history.

The `package-lock.json` modification present at task start was preserved and is not part of this evidence change. The exact current head verified before this evidence append was `33f1945af8e72f7c4367e06aaca0d67442930c0b`.

## Final mitigation pass — 2026-11-04

The SLA implementation was reviewed at application revision `0d4881c36ddcdd167955503184a861468c9de93e` and required no code changes. `ensureEscalationManagerOnTicket` reads the current assignee inside `withSavepoint`, returns `already_assignee`, `existing_resource`, or `added`, and the caller reports `resourceAdded` only for `added`. Its catch runs outside the savepoint, so a rejected resource insert rolls back that savepoint while leaving the parent transaction available for escalation, audit, and notification writes. The Temporal SLA activity uses this service path; no other escalation-manager resource attachment path was found.

At that revision, `npx vitest run src/services/__tests__/escalationService.test.ts` passed (35 tests), the PostgreSQL integration command with unique `TEST_DB_NAME=sla_escalation_mitigation_20261104_$(date +%H%M%S)` passed (8 tests), `npm run typecheck` passed, and `npm run build` passed in `packages/sla`. Integration coverage includes assignee-equals-manager L1 state/audit/notification/no-resource assertions and same-level retry idempotency; distinct manager insertion, existing resource reuse, and PostgreSQL insert rejection are also exercised. Notification delivery in this integration test uses a mocked email transport and real in-app notification persistence.

One command-free `workflow-ensure-service --projectId=ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab --name=dev-server` attempt again returned `Error: --command is required to start a new service`. The board inventory shows saved registration `card-service:ddc5d8a2-5d7b-43fc-bbfc-72c31ab17fab:dev-server:4` is concluded, and the available board lifecycle commands cannot restore a concluded registration from its saved command/cwd. No board storage was edited and no unmanaged app server was started. This is the single outstanding recovery limitation for this pass.

The board-owned Temporal worker readiness endpoint returned `ready` at `2026-11-04T06:00:02Z`, with `alga-jobs` and `sla-workflows` running. The named app origin on port 3122 refused the connection (curl exit 7, HTTP 000), so live UI/Temporal ticket processing, fresh ticket/workflow evidence, feature screenshots, and a walkthrough remain incomplete. No new workflow was triggered; historical `TIC001194` remains untouched. Board fact `91b1006b-a197-4f98-918d-ff1d5f4ca85f` records the current implementation and recovery boundary. The pre-existing `package-lock.json` change was left untouched.

## Independent lead takeover at `30747530f6d913aebbe9f7debc79be53d54ad5bb`

At 2026-11-04 06:01–06:02 UTC, independent checks passed: 35 SLA unit tests, 8 PostgreSQL integration tests using `TEST_DB_NAME=sla_takeover_final_20261104_307475`, `packages/sla` typecheck, and package build. Review of the service, savepoint implementation, Temporal activity, and repository-wide attachment references found no additional application repair needed.

The installed board service implementation still selects only live registrations for ensure/restart and has no saved-registration restore operation. Command-free ensure returned `--command is required to start a new service`; registration :4 remains concluded. The named origin refused connection. Worker readiness at `2026-11-04T06:01:43.529Z` reported both queues running, which does not establish ticket processing. Board fact `b46d9fe4-caa8-4082-b6fd-6023d6ecb61c` records these checks.

A one-time exception for board-managed recreation with the saved command was requested because the task explicitly prohibits `--command`. No exception had been received when these results were recorded. No app server was started, lifecycle storage was not changed, and no live fixture, feature screenshot, or walkthrough was produced. The implementation is verified by automated checks; the requested recovery and live acceptance remain unmet.
