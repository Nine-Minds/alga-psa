# Premium ABAC Exhaustive Surface Inventory

- Plan: `2026-04-22-premium-abac-exhaustive-remediation-sweep`
- Last updated: `2026-04-22`
- Scope lineage:
  - `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/`
  - `ee/docs/plans/2026-04-22-premium-abac-remediation/`

## Semantics Legend

- `RBAC ∩ Kernel ∩ Bundle`: action requires RBAC and runtime kernel narrowing with bundle overlays.
- `Structural Inheritance`: child record inherits already-authorized parent resource.
- `Linked Intersection`: linked child payload must satisfy parent auth and child-resource auth.

## Surface Matrix

| Domain | File / Surface | Chosen Semantics | Status | Validation |
| --- | --- | --- | --- | --- |
| Bundle lifecycle | `server/src/lib/authorization/bundles/service.ts` draft creation/publish | RBAC ∩ Kernel ∩ Bundle lifecycle invariants | Fixed | `T001-T006`, `F039` |
| Bundle lifecycle | `ee/server/src/lib/actions/auth/authorizationBundleActions.ts` draft/write/publish/archive | Transactional stale-state safety + assignment governance | Fixed | `T001-T006`, `F039` |
| Bundle lifecycle | lifecycle uniqueness migration preflight | Fail-loud duplicate-row detection + repair guidance | Fixed | `T005`, `F039` |
| Quotes | `packages/billing/src/actions/quoteActions.ts` reads/mutations/items/conversion | RBAC ∩ Kernel ∩ Bundle for quote + item integrity | Fixed | `T007-T010`, `F040` |
| Documents | `packages/documents/src/actions/documentActions.ts` read/mutation/count/folder | RBAC ∩ Kernel ∩ Bundle with authorized count semantics | Fixed | `T011-T014`, `F041` |
| Documents | URL routes: `download/preview/thumbnail/view` | Kernel-authorized document lookup before URL/path response | Fixed | `T011`, `F041` |
| Documents | content/block-content actions | Parent-document authorization required for R/W/D | Fixed | `T013`, `F041` |
| Assets | `packages/assets/src/actions/assetActions.ts` list/read/summary | RBAC ∩ Kernel ∩ Bundle (authorized totals + per-asset checks) | Fixed | `T015-T016`, `F042` |
| Assets | maintenance/history/relationships/entity lists/client summaries | Parent asset authorization on all read surfaces | Fixed | `T016`, `F024` |
| Assets | update/delete/association/relationship/maintenance mutations | Parent asset authorization + integrity checks | Fixed | `T017`, `F025` |
| Assets | `getAssetDetailBundle` linked tickets/documents | Structural Inheritance + Linked Intersection | Fixed | `T018`, `F026` |
| Projects | `packages/projects/src/actions/projectActions.ts` phase/detail/status/tree/count surfaces | Parent project authorization for read/update/delete | Fixed | `T019`, `F027` |
| Project tasks | `packages/projects/src/actions/projectTaskActions.ts` task/checklist/dependency/resource/ticket-link | Reusable parent-project gating via shared helpers | Fixed | `T020`, `F028-F029` |
| Project statuses | `packages/projects/src/actions/projectTaskStatusActions.ts` mappings/phase status flows | Parent project gating + zero-check count closure | Fixed | `T021`, `F030` |
| Project aggregates | `getPhaseTaskCounts`, `getProjectTaskData`, `getStatusMappingTaskCount` | Authorized-project-only cardinalities | Fixed | `T022`, `F031` |
| Cross-project ops | task move/duplicate/link flows | Authorize source + target project contexts | Fixed | `T023`, `F032` |
| Project linked tickets | ticket-link payload returns | Linked Intersection with ticket-resource auth | Fixed | `F033`, project contract test |
| Time/delegation | `packages/scheduling/src/actions/timeEntryDelegationAuth.ts` | `time_entry` kernel checks + not-self-approver mutation guard | Re-audited/fixed | `T024`, scheduling auth tests |
| Time/delegation | `packages/scheduling/src/actions/timeSheetActions.ts` comments/request-changes | Delegation checks required for non-owner approver actions | Re-audited/fixed | `T024`, `timeDelegationSweep.contract.test.ts` |
| Non-API entry points | file/preview/composition routes using hardened actions | Inherit hardened action semantics; no parallel bypass path found in audited set | Re-audited | `F035` rationale + route sampling in scratchpad |
| CE/EE seams | `ee/server/src/lib/authorization/kernel.ts` + bundle actions + shared kernel providers | CE and EE both resolve runtime bundle narrowing via shared kernel contracts | Re-audited | `F036`, kernel seam contract references |

## Re-Audit Notes

### F034 — Time / Delegation

- Confirmed `time_entry` resource key remains canonical in delegation kernel flows.
- Closed delegation gap in `requestChangesForTimeSheet` and non-owner comment path by requiring `assertCanActOnBehalf(...)`.
- Confirmed approval mutation guard (`not self approver`) remains enforced in kernel mutation evaluation.

### F035 — Non-API Entry Points

Audited representative non-API or composition surfaces that fan into hardened actions:

- Document URL routes in `server/src/app/api/documents/...` call hardened document authorization actions.
- Asset summary/maintenance/history/relationship routes under `server/src/app/api/v1/assets/...` call hardened asset actions.
- Project routes under `server/src/app/api/v1/projects/...` call hardened project/task actions.
- Quote routes under `server/src/app/api/v1/quotes/...` call hardened quote actions.

No additional bypass-only path was identified in the audited set.

### F036 — CE/EE Helper Seams

Audited CE/EE runtime seam usage:

- `ee/server/src/lib/authorization/kernel.ts`
- `ee/server/src/lib/actions/auth/authorizationBundleActions.ts`
- Shared kernel provider usage in billing/documents/assets/projects/scheduling actions.

All audited seams continue to converge on shared kernel + bundle-provider runtime semantics; no new divergent shadow model was introduced in this sweep.

## Validation Index

- Lifecycle: `T001-T006`
- Quotes: `T007-T010`
- Documents: `T011-T014`
- Assets: `T015-T018`
- Projects: `T019-T023`
- Time/delegation re-audit: `T024`
- Close-out artifact contract: `T025`
