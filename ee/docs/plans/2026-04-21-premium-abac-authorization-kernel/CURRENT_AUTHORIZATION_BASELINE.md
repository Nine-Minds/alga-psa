# Current Authorization Behavior Baseline

- Plan slug: `premium-abac-authorization-kernel`
- Date captured: `2026-04-21`
- Purpose: document current authorization behavior before the authorization-kernel / premium-ABAC overhaul so implementation can validate behavior parity at the end.

## Current System Summary

Today the codebase uses:

1. **Authentication + tenant context**
   - `packages/auth/src/lib/getSession.ts`
   - `packages/auth/src/lib/getCurrentUser.ts`
   - `packages/auth/src/lib/withAuth.ts`
2. **Core RBAC**
   - `server/src/lib/auth/rbac.ts`
   - `packages/auth/src/lib/rbac.ts`
   - `packages/tags/src/lib/permissions.ts` (duplicate)
3. **Scattered inline ABAC-like rules**
   - client-portal board scoping
   - manager/delegation rules
   - document ownership/client visibility rules
   - client-admin relationship checks
   - assorted own/assigned/manage checks in feature code
4. **Dormant policy/DSL scaffolding not used as the primary runtime path**
   - `packages/auth/src/lib/policy/PolicyEngine.ts`
   - `packages/auth/src/actions/policyActions.ts`
   - `server/src/lib/policy/PolicyEngine.ts`
   - `ee/server/src/lib/auth/policyEngine.ts`
   - `ee/server/src/lib/auth/policyParser.ts`

## Known Global Invariants

- RBAC is evaluated as `resource + action` against tenant-scoped role/permission data.
- `user_type` gates portal behavior (`internal` vs `client`) and MSP/client permission flags.
- `withAuth()` authenticates and injects tenant context, but does **not** automatically enforce a permission.
- API key flows usually authenticate as a user+tenant pair, but many API controller paths remain **RBAC-only** and do not consistently inherit inline ABAC-like checks from server-action/UI paths.
- Existing `policies`/DSL scaffolding is not the authoritative runtime path and should not be treated as current production behavior.

## Current Behavior by Resource Family

### Tickets

**Primary files**
- `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
- `packages/tickets/src/lib/clientPortalVisibility.ts`
- `packages/tickets/src/actions/ticketActions.ts`
- `server/src/lib/api/controllers/ApiTicketController.ts`

**Current behavior**
- Client portal ticket access is narrowed by the signed-in user's `contact_id -> client_id` relationship.
- Client portal board visibility can be narrowed further through contact-level visibility groups and `applyVisibilityBoardFilter()`.
- Hidden-board direct access is guarded in client portal flows.
- Internal UI/server-action flows usually rely on RBAC plus feature-owned checks.
- API ticket controllers are largely RBAC-only today and are a likely parity gap.

**Important parity risks to preserve/fix**
- client-portal board filtering must remain fail-closed.
- direct ticket access, adjacent loaders, and create flows must stay aligned with list filtering.
- API/UI parity likely needs improvement during migration.

### Documents

**Primary files**
- `server/src/app/api/documents/view/[fileId]/route.ts`
- `packages/documents/src/lib/documentPermissionUtils.ts`
- `packages/documents/src/actions/documentActions.ts`

**Current behavior**
- Internal users often receive broad access once baseline RBAC passes.
- Client-user document access is heavily relationship-driven:
  - own avatar / own linked contact
  - same client association
  - project-task ownership chain
  - contract/client chain
  - ticket/contact/client chain
  - `is_client_visible` requirement for client users in many paths
- Some utility code reasons only about entity-type permissions and may be coarser than route-level checks.

**Important parity risks to preserve/fix**
- same-tenant avatar/team-avatar behavior must remain intentional.
- `is_client_visible` semantics must remain fail-closed for client users.
- route-level richness and helper-level coarseness should be normalized.

### Time / Timesheets

**Primary files**
- `packages/scheduling/src/actions/timeEntryDelegationAuth.ts`
- `packages/scheduling/src/actions/timeSheetActions.ts`
- `packages/scheduling/src/actions/timeEntryCrudActions.ts`
- `server/src/lib/api/services/TimeEntryService.ts`
- `server/src/lib/api/services/TimeSheetService.ts`

**Current behavior**
- Strong existing relationship model:
  - self
  - manager of subject
  - reports-to chain when enabled
  - tenant-wide via `timesheet:read_all`
- Approval and reversal flows are gated separately from simple read/write.
- Resource state matters (`approval_status`, invoiced/approved restrictions in related domains).
- API services have their own behavior and need parity review against server actions.

**Important parity risks to preserve/fix**
- manager/delegation semantics are a canonical built-in relationship rule and must survive migration unchanged unless explicitly changed.
- self-approval / state-transition guards must remain strict.

### Projects

**Primary files**
- `packages/projects/src/actions/projectActions.ts`
- `packages/projects/src/actions/projectTaskActions.ts`
- `packages/projects/src/actions/projectTaskCommentActions.ts`

**Current behavior**
- Many flows are RBAC-first (`project:read`, `project:update`).
- Some project/task/comment paths already use ownership-like checks such as own-comment-or-internal-user rules.
- Project and project-task records often imply client scope, team scope, and assignment scope, but those checks are not yet normalized under one common runtime.

**Important parity risks to preserve/fix**
- preserve existing own-comment semantics.
- map project/client/team/assignment relationships into a shared model without broadening access.

### Assets

**Primary files**
- `packages/assets/src/actions/assetActions.ts`
- `packages/assets/src/actions/assetDocumentActions.ts`

**Current behavior**
- Mostly RBAC-first today.
- Assets intersect with tickets and documents and are likely to need client/team segmentation once remote-support / remote-control style actions are considered.
- Existing actions do not yet appear to use a unified portfolio/assignment narrowing model.

**Important parity risks to preserve/fix**
- avoid inventing broader asset visibility during migration.
- establish explicit client/team/assignment semantics before layering premium restrictions.

### Billing / Quotes / Invoices

**Primary files**
- `packages/billing/src/actions/quoteActions.ts`
- `packages/billing/src/actions/recurringApprovalBlockers.ts`
- billing-related API routes and exports under `server/src/app/api/v1/...`

**Current behavior**
- RBAC controls baseline access.
- Important state/relationship guards exist around approval workflows and invoice blockers.
- Quote approval semantics already imply separation-of-duties style requirements.
- Billing data is a likely candidate for future field-level redaction.

**Important parity risks to preserve/fix**
- preserve approval-state gates and existing blockers.
- do not broaden billing visibility while centralizing behavior.

### Client Portal Administration / Client Relationships

**Primary files**
- `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts`
- `packages/client-portal/src/lib/clientAuth.ts`
- `packages/clients/src/components/contacts/ContactPortalTab.tsx`

**Current behavior**
- Client portal admin privileges are relationship-driven through contact linkage and `is_client_admin`.
- Same-client enforcement is essential for both read and mutation flows.
- This is a canonical example of built-in relationship logic that must exist in CE+EE, not only in configurable premium overlays.

### API Keys / Programmatic Access

**Primary files**
- `server/src/lib/api/controllers/ApiBaseController.ts`
- `server/src/lib/auth/apiAuth.ts`
- `packages/auth/src/lib/apiAuth.ts`
- `server/src/middleware/express/authMiddleware.ts`

**Current behavior**
- API keys usually authenticate to a user+tenant identity.
- Permission checks are generally RBAC-only.
- Programmatic paths may not consistently inherit the inline ABAC-like restrictions present in server-action/UI flows.

**Important parity risks to preserve/fix**
- API/UI drift is one of the main reasons to build the kernel.
- future API-key narrowing must be an intersection with user access, never a widening.

## Current Dormant / Legacy Policy Scaffolding

**Primary files**
- `packages/auth/src/lib/policy/PolicyEngine.ts`
- `packages/auth/src/actions/policyActions.ts`
- `server/src/lib/policy/PolicyEngine.ts`
- `ee/server/src/lib/auth/policyEngine.ts`
- `ee/server/src/lib/auth/policyParser.ts`
- `server/src/components/settings/security/SecuritySettingsPage.tsx`
- `packages/product-auth-ee/oss/entry.tsx`
- `packages/product-auth-ee/ee/entry.ts`

**Current behavior**
- There is a `policies` table and EE policy-management UI scaffolding.
- The parser/DSL is not the authoritative runtime authorization path.
- CE/server/EE implementations have drifted and should be treated as legacy scaffolding for replacement, not extension.

## Baseline Validation Focus Areas

The migration should explicitly validate:

1. Ticket list/detail/create parity under client/board narrowing.
2. Document route/helper parity for ownership/client-visible behavior.
3. Time self/manager/read-all semantics.
4. Project ownership/assignment/comment semantics.
5. Asset segmentation behavior remains no broader than before.
6. Billing approval/blocker semantics remain intact.
7. API key paths converge toward the same effective narrowing as UI/server-action paths for migrated resources.
8. CE keeps built-in behavior through the shared kernel even without configurable bundle management.
9. EE configurable overlays only narrow access; they never widen baseline behavior.

## Salient Reference Files

- `packages/auth/src/lib/getSession.ts`
- `packages/auth/src/lib/getCurrentUser.ts`
- `packages/auth/src/lib/withAuth.ts`
- `server/src/lib/auth/rbac.ts`
- `packages/db/src/models/user.ts`
- `packages/tickets/src/lib/clientPortalVisibility.ts`
- `packages/scheduling/src/actions/timeEntryDelegationAuth.ts`
- `server/src/app/api/documents/view/[fileId]/route.ts`
- `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts`
- `server/src/lib/api/controllers/ApiBaseController.ts`
- `server/src/lib/api/controllers/ApiTicketController.ts`
- `packages/auth/src/actions/policyActions.ts`
- `ee/server/src/lib/auth/policyEngine.ts`
- `ee/server/src/lib/auth/policyParser.ts`
