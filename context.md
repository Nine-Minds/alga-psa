# Code Context: Non-RBAC (ABAC-candidate) Constraints Across Product Areas

## Files Retrieved

1. `server/src/interfaces/authorization.interface.ts` (full) — ABAC scaffold: `IPolicy`, `ICondition` (userAttribute/operator/resourceAttribute) already defined but not wired into enforcement
2. `packages/auth/src/lib/policy/PolicyEngine.ts` (full) — ABAC policy engine: evaluates conditions (==, !=, contains) comparing user attributes vs resource attributes
3. `packages/auth/src/lib/attributes/EntityAttributes.ts` (full) — User attributes (user_id, team_id, roles, isAdmin) and Ticket attributes (creator_id, assignee_id, team_id, status, isOverdue)
4. `packages/auth/src/lib/attributes/AttributeSystem.ts` (full) — Attribute base classes: DBFieldAttribute, ComputedAttribute, StaticAttribute
5. `packages/auth/src/actions/policyActions.ts` (full) — CRUD for policies, getUserAttributes, getTicketAttributes, evaluateAccess — the ABAC wiring surface
6. `packages/auth/src/lib/withAuth.ts` (full) — Session auth wrapper; injects user + tenant context
7. `server/src/lib/auth/rbac.ts` (full) — Core RBAC: `hasPermission()` checks role→permission with msp/client flag gating
8. `server/src/middleware.ts` (full) — Edge middleware: API key gate, user_type routing (internal→/msp, client→/client-portal)
9. `packages/tickets/src/lib/clientPortalVisibility.ts` (full) — **Board-level visibility groups**: `getClientContactVisibilityContext()` + `applyVisibilityBoardFilter()` — a concrete ABAC pattern
10. `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts` (lines 1–220) — **Client→own client_id + visibility group board filter** on ticket queries
11. `packages/client-portal/src/actions/client-portal-actions/visibilityGroupActions.ts` (lines ~130–165) — **is_client_admin** attribute gate for visibility group management
12. `packages/client-portal/src/lib/clientAuth.ts` (full) — `getAuthenticatedClientId()`: user→contact→client_id ownership chain
13. `packages/client-portal/src/actions/client-portal-actions/client-documents.ts` (lines 1–80) — Client document access gated by resolved client_id
14. `server/src/app/api/documents/view/[fileId]/route.ts` (lines 100–400) — **Rich attribute-based document access**: checks user_type, ownership (own avatar, own contact), client association match, project_task→client ownership, contract→client ownership, ticket→contact/client ownership, is_client_visible flag, tenant-logo public access, same-tenant team avatar access
15. `packages/scheduling/src/actions/timeEntryDelegationAuth.ts` (full) — **`assertCanActOnBehalf()`**: self / manager-of-subject (team membership + manager_id) / reports-to-chain (teams-v2 flag) / tenant-wide (read_all) — classic ABAC delegation
16. `packages/scheduling/src/actions/timeSheetActions.ts` (lines 110–200) — **Timesheet approval scoping**: non-read_all users see only team members where they are manager_id; reports-to subordinates via teams-v2 flag
17. `packages/billing/src/actions/quoteActions.ts` (lines 720–850) — **Quote approval workflow**: status gates (draft→pending_approval→approved), separate `requireQuoteApprovePermission()`
18. `packages/billing/src/actions/recurringApprovalBlockers.ts` (lines 1–60) — **Billing blocked by time approval status**: invoice generation checks `time_entries.approval_status` != 'APPROVED'
19. `packages/projects/src/actions/projectTaskCommentActions.ts` (lines 145–175) — **Comment edit: own comment OR internal user** — attribute check on user_id match + user_type
20. `packages/tags/src/lib/permissions.ts` (full) — Duplicated RBAC with msp/client flag — candidate for ABAC consolidation
21. `server/src/lib/extensions/gateway/auth.ts` (full) — Extension proxy resolves user_type + client_id for runner forwarding; `assertAccess()` is a TODO stub
22. `packages/client-portal/src/actions/client-portal-actions/client-billing-metrics.ts` (lines 1–80) — Billing metrics scoped to user's client_id via contact chain
23. `server/src/lib/api/controllers/ApiBaseController.ts` (lines 1–130) — API key auth + `checkPermission()` — pure RBAC, no ABAC
24. `server/src/app/api/v1/tickets/[id]/route.ts` area + `ApiTicketController.ts` (full) — Ticket API: pure RBAC (ticket:read/update/delete), no board/client/visibility filtering in API layer

---

## Key Code

### 1. Existing ABAC Scaffold (unwired)
**`packages/auth/src/lib/policy/PolicyEngine.ts`**
```ts
evaluateAccess(user: IUserWithRoles, resource: any, action: string): boolean {
  for (const policy of this.policies) {
    if (policy.resource === resource.constructor.name && policy.action === action) {
      if (this.evaluateConditions(user, resource, policy.conditions)) return true;
    }
  }
  return false;
}
```
**`packages/auth/src/lib/attributes/EntityAttributes.ts`** — Only User and Ticket entity attributes defined. Missing: Client, Project, Document, Invoice, TimeEntry, Contract, Schedule, Integration entities.

### 2. Client Portal Visibility Groups (ABAC in practice)
**`packages/tickets/src/lib/clientPortalVisibility.ts`**
```ts
export interface ContactVisibilityContext {
  contactId: string;
  clientId: string;
  visibilityGroupId: string | null;
  visibleBoardIds: string[] | null;  // null = unrestricted
}
export function applyVisibilityBoardFilter(query, visibleBoardIds, boardColumn = 't.board_id') {
  if (visibleBoardIds === null) return query; // unrestricted
  if (visibleBoardIds.length === 0) { query.whereRaw('1 = 0'); return query; }
  query.whereIn(boardColumn, visibleBoardIds);
  return query;
}
```

### 3. Time Entry Delegation Auth (manager-chain ABAC)
**`packages/scheduling/src/actions/timeEntryDelegationAuth.ts`**
```ts
export async function assertCanActOnBehalf(actor, tenant, subjectUserId, db): Promise<DelegationScope> {
  if (actor.user_id === subjectUserId) return 'self';
  const canApprove = await hasPermission(actor, 'timesheet', 'approve', db);
  if (!canApprove) throw new Error('Permission denied');
  const canReadAll = await hasPermission(actor, 'timesheet', 'read_all', db);
  if (canReadAll) return 'tenant-wide';
  if (await isManagerOfSubject(db, tenant, actor.user_id, subjectUserId)) return 'manager';
  if (reportsToEnabled && await User.isInReportsToChain(db, actor.user_id, subjectUserId)) return 'manager';
  throw new Error('Permission denied');
}
```

### 4. Document View Access (multi-attribute check)
**`server/src/app/api/documents/view/[fileId]/route.ts`** (lines 120–330)
Checks in order:
- `isTenantLogo` → public
- `user.user_type === 'internal'` → full access
- `associatedUserId === user.user_id` → own avatar
- `associatedContactId === user.contact_id` → own contact avatar
- `userClientId === associatedClientId` + `is_client_visible` → client doc
- `associatedUserId && same tenant` → same-tenant avatar
- team association + same tenant
- `project_task → project.client_id === userClientId` + `is_client_visible`
- `contract → billing_plans.company_id === userClientId` + `is_client_visible`
- `ticket → contact_name_id match OR client_id match` + `is_client_visible`

---

## Architecture

### Current Access Control Layers
1. **Edge Middleware** (`server/src/middleware.ts`): API key presence check, user_type routing (internal vs client)
2. **RBAC** (`packages/auth/src/lib/rbac.ts` + `server/src/lib/auth/rbac.ts`): `hasPermission(user, resource, action)` — role-based with msp/client flag gating
3. **ABAC Scaffold** (`packages/auth/src/lib/policy/PolicyEngine.ts`): PolicyEngine + EntityAttributes exist but `evaluateAccess()` is not called anywhere in production code
4. **Inline Attribute Checks** (scattered): user_type checks, ownership checks, client_id resolution, board visibility filtering, manager-chain checks

### Data Flow
```
Request → Edge Middleware (user_type routing) → Route Handler
  → withAuth() (session → user + tenant context)
  → hasPermission() (RBAC check)
  → Inline attribute checks (non-RBAC constraints)
```

### Key Observation
ABAC constraints are **ad-hoc and scattered** — each product area implements its own attribute resolution and filtering inline rather than going through the PolicyEngine. The PolicyEngine exists but is dormant.

---

## Product Area ABAC Constraint Summary

| Area | Constraint Type | Where | Pattern |
|------|----------------|-------|---------|
| **Tickets** | Board visibility groups | `packages/tickets/src/lib/clientPortalVisibility.ts` | contact→visibility group→board_ids filter |
| **Tickets** | Client ownership | `packages/client-portal/.../client-tickets.ts:resolveVisibleTicket` | client_id match on ticket |
| **Tickets** | API layer: no ABAC | `server/src/lib/api/controllers/ApiTicketController.ts` | Pure RBAC only |
| **Billing/Invoices** | Client scoping | `packages/client-portal/.../client-billing-metrics.ts` | user→contact→client_id filter |
| **Billing/Quotes** | Approval status gate | `packages/billing/src/actions/quoteActions.ts:800` | status must be 'pending_approval' |
| **Billing/Recurring** | Time approval blocker | `packages/billing/src/actions/recurringApprovalBlockers.ts` | approval_status != 'APPROVED' blocks invoicing |
| **Projects/Documents** | Comment ownership | `packages/projects/.../projectTaskCommentActions.ts:152` | own comment OR internal user_type |
| **Documents** | Multi-entity association | `server/src/app/api/documents/view/[fileId]/route.ts` | client/contact/project/contract/ticket ownership chain |
| **Documents** | is_client_visible flag | Same file | Client users need doc.is_client_visible=true |
| **Contacts/Clients** | Client admin gate | `packages/client-portal/.../visibilityGroupActions.ts:140` | is_client_admin attribute check |
| **Scheduling/Time** | Manager chain delegation | `packages/scheduling/.../timeEntryDelegationAuth.ts` | self / manager / reports-to / tenant-wide |
| **Scheduling/Time** | Team manager scope | `packages/scheduling/.../timeSheetActions.ts:163` | team_members + manager_id join |
| **Workflows** | Permission hierarchy | `ee/packages/workflows/.../workflow-schedule-v2-actions.ts:133` | read fallback to view/manage/admin |
| **Integrations** | TODO stub | `server/src/lib/extensions/gateway/auth.ts:assertAccess()` | `// TODO: implement RBAC and per-tenant endpoint checks` |

---

## Start Here

Open **`packages/auth/src/lib/policy/PolicyEngine.ts`** — this is the existing ABAC engine. It has the attribute comparison logic but:
1. It's not called anywhere in production request paths
2. EntityAttributes only cover User and Ticket (need Client, Project, Document, Invoice, TimeEntry, Contract, etc.)
3. The `evaluateAccess()` method matches on `resource.constructor.name` which is fragile

The first task is deciding whether to extend this engine or replace it, then mapping the inline constraints listed above into the chosen ABAC model.
