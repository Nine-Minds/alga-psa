# Scratchpad — Timesheet Self-Approval Defaults

## 2026-05-21
- User confirmed desired default: any user with `timesheet:approve` may approve their own time.
- Investigation found unconditional denial in `packages/scheduling/src/actions/timeEntryDelegationAuth.ts` and `shared/workflow/runtime/actions/businessOperations/timeDomain.ts`.
- Decision: default RBAC permits self-approval; premium ABAC `not_self_approver` remains tenant-configured opt-in separation of duties.
- Constraint: workflow shared code should not depend on the full authorization kernel, so it needs a direct DB check for active assigned bundle rules.
- Existing user changes before implementation: `.env.localtest`, `package-lock.json`; do not touch.

## Implementation notes
- Removed the built-in mutation guard from `assertCanApproveSubject`; bundle narrowing/mutation evaluation remains responsible for `not_self_approver`.
- Added `hasAssignedNotSelfApproverBundleRuleForWorkflowTime` in `timeDomain.ts` to query active assigned bundles directly for workflow approval self-checks.
- Updated the EE bundle simulator so its built-in self-approval guard remains billing-only; time approval simulation now relies on configured bundle rules.
- Updated static/contract tests for server approval wiring, workflow ABAC self-approval behavior, and simulator guard scope.

## Validation
- PASS: `npx tsc --noEmit -p shared/tsconfig.json --pretty false`
- PASS: `npm run typecheck --workspace packages/scheduling -- --pretty false`
- PASS: `npm test --workspace server -- --run src/test/unit/scheduling/workflowTimeSelfApproval.contract.test.ts src/test/unit/scheduling/approvalBehavior.test.ts src/test/unit/authorization/bundleSimulatorSelfApproval.contract.test.ts`
- PARTIAL: `npm test --workspace packages/scheduling -- timeEntryDelegationAuth.authorization.test.ts timeDelegationSweep.contract.test.ts` runs `timeDelegationSweep` successfully but `timeEntryDelegationAuth.authorization.test.ts` fails before executing tests because Vitest cannot resolve `@alga-psa/authorization/kernel` from the package test harness.
- PRE-EXISTING HARNESS FAILURE OBSERVED: `npm test --workspace server -- --run src/test/unit/authorization/bundleSimulatorAction.test.ts` fails in existing tests with `knex(...).leftJoin is not a function` before simulator assertions run.
- LIMITATION: `npm run typecheck --workspace server -- --pretty false` OOMs near the Node heap limit after ~8 GB; narrower shared/scheduling typechecks passed.
