# Scratchpad — Co-managed IT: seat and workspace shapes

Rolling notes. Append as cards learn things. Revise an entry when a decision changes.

## History

- **Revision 1 (2026-11-10):** seat technician as a client-side portal user with a separate technician workspace, 115 features, graduation included.
- **Revision 2 (2026-11-10):** seat technician as an internal user restricted by the authorization kernel. Graduation removed to a later plan. Depends on the authorization completion plan.

How the decision moved, so nobody re-walks it:

1. First idea: restrict an internal user with authorization bundles. Rejected on evidence: bundles only narrow, default to unrestricted, and cover a minority of read paths.
2. Revision 1: put the technician on the client side of the internal/client line, the one boundary enforced everywhere.
3. Investigated enforcing a per-user client scope in the tenant query facade. Rejected: about 170 files bypass the facade, about 330 database-touching server functions and all background work have no user context, follow-up work after a commit would inherit a restricted user, and a silent row filter corrupts derived writes.
4. Revision 2: the bundle gaps are defects in a shipped Pro feature and must be fixed anyway. With them fixed, an internal-side technician costs less in total than a parallel technician surface, and it is what MSPs asked for.

## Decisions

- Two shapes, one pool, one price. Seat and workspace are allocation kinds.
- Seat technician: `user_type = 'internal'` with a live seat assignment for one client.
- Restriction: a built-in kernel resolver with a closed baseline, a seat role, and the operational surface per principal.
- Seat technicians are excluded from the MSP's licensed count and admitted against the allocation.
- Revoking a seat deactivates the user.
- Second capability `co-managed-seat` on `release-v2-0-feature`.
- Audience by organization. `organization_private` is MSP-only.
- Responsibility is explicit state with receipts.
- No capability admission until the authorization plan's acceptance passes and segment C has had an independent security review.
- **Watchers (2026-11-13, captain, S33 review):** the watcher list is the MSP's case-by-case choice of who follows a ticket. A seat technician is never refused as a watcher, on any ticket. Outside their scope they are read as an external party (requester audience, client rendering, replies stored as requester); inside it, as their audience. The boundary guards automatic over-delivery (MSP rendering, internal and private notes), not the MSP's explicit choice of address. Supersedes the earlier "cannot watch an out-of-scope ticket" rule.

## Discoveries about existing code

### Pool and licensing

- `co_managed_allocations`: `tenant` is the sponsor; `customer_tenant` and `relationship_id` are NOT NULL; anonymous `CHECK (tenant <> customer_tenant)`; `seats >= 1`; unique live index on `(tenant, customer_tenant)`.
- Allocated seats are summed in three places in `packages/licensing/src/lib`: `co-managed-entitlements.ts`, `co-managed-purchases.ts`, `co-managed-reservation.ts`.
- `assertCoManagedSeatAdmission` returns `managed: false` for any tenant whose product is not `co_managed`. Seat admission needs its own entry.
- `lockCoManagedSeatScope` refuses admission during grace.
- MSP seat counting: `countActiveInternalUsers` in `packages/users/src/lib/internalUserLicenseGuard.ts` is `user_type = 'internal' AND is_inactive = false`. The same count is repeated in three `getLicenseUsage` copies, two `getActiveUserCount` copies, onboarding, and the EE appliance seat guard.
- Callers of the internal seat check: `addUser`, `updateUser` reactivation, `UserService.create` and `update`, bulk deactivate and create, invitation send and accept, SCIM reactivation. SCIM calls the raw check rather than `admitInternalUserSeat`.
- Internal emails are unique platform-wide (`findInternalEmailClaim` in `packages/db/src/models/user.ts`).
- Price: `STRIPE_CO_MANAGED_USER_PRICE_ID`. Amount and currency come from the Stripe price object.
- No production writer for `self_host` or `admin_grant` entitlement rows was found. Confirm before relying on self-hosted admission.

### Authorization and surface

- Built-in rules resolve per subject in `packages/authorization/src/kernel/providers/builtinProvider.ts`. The resolver registry and closed baseline come from the authorization plan.
- `server/src/lib/productSurfaceRegistry.ts`: `MSP_ROUTE_RULES`, `API_RULES`, `resolveProductRouteBehavior(productCode, pathname)`. Unmatched routes are allowed only for `psa`. Resolution is per tenant today; `productAccess.ts` has no user parameter.
- About 21 server-action files call a product guard (`assertPsaOnlyTenantAccess`, `assertTenantProductAccess`). The rest rely on permissions.
- The sidebar filter chain is edition, tier, permission, product (`SidebarWithFeatureFlags.tsx`). Only five menu items declare a required permission.
- `getServices` has no permission check and returns rates. `getEligibleContractLinesForUI` checks only sign-in.
- `getTicketFormOptions`, `getAllUsers` and `getAllUsersBasic` return every user of the tenant.
- Client reads select `c.*`, which includes billing columns.

### Tickets, comments, time

- `shared/lib/commentAudience.ts`: `isCommentAudienceVisible(audience, ownerTenant, actorTenant, requester)`. `NativeCommentAudience` excludes `shared_it`.
- `shared/lib/humanWork/assertHumanWorkAssignee.ts` takes `(trx, tenant, userIds)` with no work-item context.
- Ticket data source capabilities: `packages/tickets/src/lib/ticketDataSource.ts`. The page preloads the consolidated ticket load, billing rollup, materials, time entries, survey and timeline with no capability check (`server/src/app/msp/tickets/[id]/page.tsx`).
- The billing profile picker has no capability gate (`TicketDetails.tsx`, `TicketProperties.tsx`).
- Time-entry dialog: `TimeEntryProvider.tsx` loads services and tax regions in one `Promise.all` and throws. Save: `timeEntryWriteCore.ts` reconciles billing allocations and rethrows.
- Timesheet reads select from `service_catalog` including the default rate.
- Operational field set: `packages/co-managed/src/timeEntryBillingMode.ts`.
- Asset detail joins `client_billing_profiles` and includes purchase cost.
- The task form loads services inside one try; a failure stops the checklist and resources loading.
- Knowledge base articles have an audience of internal, client or public and no client column.

## Leverage notes

Hypotheses only.

- `pattern allocated-seats-sum`: three copies of the allocated-seat query. Segment A collapses them.
- `pattern licensed-user-count`: about seven copies of the licensed internal user count. Segment B collapses them, because excluding seat technicians in seven places would be the eighth copy of the rule.
- `friction audience-tenant-key`: the audience predicate assumes organization equals tenant.
- `friction product-surface-per-tenant`: the surface registry cannot answer for a principal.
- `friction capability-not-server-gated`: capability flags hide sections but the server still preloads their data.

## Gotchas

- zsh expands `$VAR:path` modifiers. Quote git object paths.
- Citus: unique indexes include `tenant`; no triggers; no volatile function in an `UPDATE` on a distributed table.
- The pool-wide lapse puts every allocation into grace together.
- A legacy internal note has `collaboration_audience IS NULL`. It must resolve private for a seat technician even though they are an internal user of the same tenant.
- An internal user can normally be put on teams and schedules. A seat technician must not be.

## Commands

```bash
alga-dev plan brief --projectId=<card>
alga-dev plan status --projectId=<plan card>
FORCE_CAPABILITIES=co-managed-seat:on    # self-host, dev, CI
FORCE_CAPABILITIES=co-managed-seat:off   # kill switch
```
