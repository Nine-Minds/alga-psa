# Implementation notes

- `packages/co-managed/src/seatRole.ts` currently matches by name and portal flags, then inserts missing grants. Existing extra grants survive admission.
- `packages/co-managed/src/seatInvitation.ts` and `seatRevocation.ts` own the seat membership lifecycle. `seatAuthority.ts` derives record scope from the assignment and arrangement.
- Trace `packages/auth/src/actions/policyActions.ts`, `server/src/lib/api/services/PermissionRoleService.ts`, user role writers, permissions catalog synchronization, and picker data sources before choosing the shared enforcement point.
- `packages/auth/src/lib/permissionCapabilities.ts` already filters role visibility. Check edition behavior and keep feature-specific ownership in the EE boundary with a neutral shared mechanism where needed.

## Implementation notes (draft pass)

- Identity: `roles.managed_by` (text) + partial unique index `(tenant, managed_by)`; the seat role is `managed_by = 'co-managed-seat'`. Migration `server/migrations/20261124100000_protect_co_managed_seat_role.cjs`.
- Guard: `packages/db/src/lib/managedRoleOwnership.ts`, hooked into the `tenantDb` write terminals (`guardWrites`) for `roles`, `role_permissions`, `user_roles`. A write is admitted only inside `runAsRoleOwner(owner, ...)` (`runAsCoManagedSeatLifecycle` in `packages/co-managed/src/seatRole.ts`) and only for roles that owner manages. Identity reserved against registered owner identities and existing managed rows.
- Lifecycle callers: `admitCoManagedSeatRole` (resets grants to the catalog set), invitation acceptance, revocation, conversion.
- Reconciliation: `server/migrations/utils/managedRoleReconciliation.cjs`; ambiguity goes to `managed_role_reconciliation_findings` and the rows concerned are left untouched. Membership is never rewritten (non-seat holders are reported).
- Visibility: `getRoles` / roleActions `getRoles` / pickers omit managed roles; `getInspectableRoles` + the permissions matrix + the user role views show a served tenant's managed role read-only (`ManagedRoleNotice`, locale `msp/settings:managedRole.*`).
- Catalog sync (`syncPermissionCatalog.cjs`) finds capability roles by `owner`, not name, and stays additive.
- Tests: `managedSeatRoleOwnership.db.test.ts` (T001, T002), `managedSeatRoleVisibility.db.test.ts` + `ManagedRoleNotice.test.tsx` (T003), `managedRoleReconciliation.db.test.ts` (T004).
