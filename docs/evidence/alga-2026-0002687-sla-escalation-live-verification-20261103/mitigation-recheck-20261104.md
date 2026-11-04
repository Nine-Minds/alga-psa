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

## Board service recovery investigation

The app registration required by the assignment was the `dev-server` on port 3122, with saved launch command `PORT=3122 npm run dev` and this worktree's `server` directory as cwd. The board service CLI implementation in `/home/robert/alga-dev/ghostty-pane-ide/src/main/workflow/WorkflowCardServiceService.ts` supports `workflow-ensure-service`, `workflow-restart-service`, `workflow-conclude-service`, and listing. `ensureService` revives a matching **live** record command-free. When no live record exists, it requires a command to create a record. The CLI has no independent register/restore operation for a concluded or absent record.

Current observations:

- `alga-dev workflow-list-services --projectId=ddc5d8a2-7d5b-43fc-bbfc-72c31ab17fab --live=true` returned `{"services":[]}`.
- `alga-dev workflow-list-projects --brief=true` did not include that project ID; `workflow-get-project`, `workflow-list-facts`, and the prescribed `workflow-add-fact` each returned `Error: Project not found`.
- Command-free `alga-dev workflow-ensure-service --projectId=ddc5d8a2-7d5b-43fc-bbfc-72c31ab17fab --name=dev-server` returned `Error: Project not found` in this board context. No service was created and no lifecycle record was modified.
- Named origin `http://feature-sla-escalation-fails-every-time-when-escalation.localhost:3122/api/health` refused the connection (curl exit 7, HTTP 000).
- Card Temporal container `card-ddc5d8a2-temporal` was running at `127.0.0.1:17356`; `http://127.0.0.1:28087/health` returned healthy with `alga-jobs` and `sla-workflows` in `RUNNING` state.

The exact missing board operation is a supported way to restore/register the card's saved service definition without starting it through an inline `--command` argument, or to restore the missing project/service registry records. Neither operation exists in the inspected `alga-dev` CLI. No alternate app launch, direct service invocation, or lifecycle record fabrication was used.

## Live proof and durable facts

No current-revision live ticket, Temporal workflow run, delivery evidence, feature screenshot, or walkthrough video was produced because the named origin could not be recovered under the stated constraints. Historical TIC001194 was left untouched. Existing historical evidence in `evidence/review/r07-temporal-summary-TIC001194.txt` predates this application revision and is not presented as proof of the mitigation.

The required `workflow-add-fact` was attempted with the specified project ID, step, actor, and finding; it failed with `Project not found`. This durable discovery could not be written because the board has no matching project record.

## First reviewer actions

Restore the card/project record and expose a supported saved-service registration recovery path, then use command-free `workflow-ensure-service` for `dev-server` and repeat the live scenario through the named origin. Existing plan and automated checks remain the implementation baseline; do not treat them as live application proof.
