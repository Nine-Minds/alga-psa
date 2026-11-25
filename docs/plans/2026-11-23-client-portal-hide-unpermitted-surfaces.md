# Client portal: hide what the user may not use (PBNJ alga-2026-0003226)

Status: design for review · card `65ae4ce5-1bf5-4d82-8caa-d010403b1afb`
Decided by Robert 2026-11-15 scope discipline applies; the product question below is decided here as a drive
decision under the card's `conn`, and is reversible in one predicate.

## 1. Problem

A portal user with the default `User` role sees a **Client Settings** nav link, always-visible **Account** and
**Client Details** tabs, and billing cards that render *permission error text* ("unauthorized") in place of
content. Phill Hodgkinson (PBNJ) wants clients to see only what they are permitted to use; "why don't I have
access" conversations are the cost.

## 2. Why it happens (verified in the code)

| Symptom | Cause |
|---|---|
| Every default role sees the link | `checkClientPortalPermissions` sets `hasClientSettingsAccess = hasPermission(user,'client','read')` (`clientUserActions.ts:954`), and the catalog grants portal `client:read` to `client:Admin`, `client:Finance` **and** `client:User` |
| Account + Client Details always show | `ClientPortalSettingsPage.tsx:98-109` builds those two tabs unconditionally; only User Management and Visibility Groups are conditional |
| "unauthorized" text under Account | `ClientAccount.tsx:70-73,121-124` renders `getErrorMessage(permissionError)` in a red card — a permission denial is being displayed as a user-facing error |
| Direct URL renders the page for anyone | `server/src/app/client-portal/client-settings/page.tsx` has no permission check at all; it returns `<ClientPortalSettingsPage />` unconditionally |
| Permissions already computed but unused | `hasBillingAccess` is returned by `checkClientPortalPermissions:926-956` and consumed nowhere in the settings surface; `hasAccountAccess` is likewise dead |

Also verified: the URL tab parameter is validated only against `VALID_TAB_SLUGS` (`:19,34-39`), **not** against
permitted tabs — so hiding a tab from the tab list would still leave it addressable as `?tab=account`.

## 3. Decision: one surface map, three consumers

Scattered per-component role checks are what produced this defect: the sidebar, the tab list and the page guard
each know a different partial truth. The fix is a single pure function that turns the already-computed
permission booleans into **which surfaces exist**, and every consumer reads it.

New module — `packages/client-portal/src/lib/clientPortalSettingsSurfaces.ts` (pure, no data access, so both the
server page and the client bundle can import it):

```ts
export type ClientPortalSettingsTab =
  | 'account' | 'client-details' | 'user-management' | 'visibility-groups';

export interface ClientPortalSettingsPermissions {
  hasBillingAccess: boolean;         // billing:read   (already computed)
  hasClientReadAccess: boolean;      // client:read    (= today's hasClientSettingsAccess)
  hasUserManagementAccess: boolean;  // user:read      (already computed)
  hasVisibilityGroupAccess: boolean; // contacts.is_client_admin (already computed)
  isHosted: boolean;                 // already computed
}

export interface ClientPortalSettingsSurfaces {
  tabs: ClientPortalSettingsTab[];   // ordered, canonical
  showPlanCard: boolean;             // account tab body
  showInvoicesCard: boolean;         // account tab body
  canOpenSettings: boolean;          // tabs.length > 0  — the only thing the nav link reads
}

export function resolveClientPortalSettingsSurfaces(
  p: ClientPortalSettingsPermissions,
): ClientPortalSettingsSurfaces;
```

Visibility rules — permission-driven, no role special-cases:

| Tab / card | Visible when | Default `User` | Default `Finance` / `Admin` |
|---|---|---|---|
| Account tab | `billing:read` **and** `isHosted` | hidden | visible |
| ↳ plan card | `billing:read` | — | visible |
| ↳ invoices card | `billing:read` | — | visible |
| Client Details tab | `client:read` | **visible (read-only)** | visible |
| User Management tab | `user:read` | hidden | per role |
| Visibility Groups tab | `is_client_admin` | hidden | as today |
| Nav link | `tabs.length > 0` | **visible** (Client Details is permitted) | visible |
| Server page | `canOpenSettings` | renders | renders |

Consumers:

1. **Sidebar** (`ClientPortalSidebar.tsx:181`): replace `permissions.hasClientSettingsAccess` with
   `surfaces.canOpenSettings`. Delete the `hasClientSettingsAccess` field from the payload once grep confirms it
   has no other consumer (same for the dead `hasAccountAccess`).
2. **Settings page** (`ClientPortalSettingsPage.tsx:98-126`): build the tab array from `surfaces.tabs` and gate
   each card body from `surfaces.showPlanCard` / `showInvoicesCard`. `DEFAULT_TAB` becomes the first entry of
   `surfaces.tabs`; the `?tab=` parameter is accepted **only if it is in `surfaces.tabs`**, otherwise coerce to
   the first permitted tab (this closes the `?tab=account` leak).
3. **Server page** (`server/src/app/client-portal/client-settings/page.tsx`): compute the same surfaces from
   the session; `notFound()` when `!canOpenSettings`. A direct URL for a user with no permitted tab must not
   render the page. Reuse the same helper — the page calls `checkClientPortalPermissions()` (a server action)
   and passes its booleans to the pure resolver; no duplicated rule.

## 4. Permission errors must never be rendered

`ClientAccount.tsx` conflates two different failures. Split them:

- `isActionPermissionError(x)` → the user lacks access: hide the card, log at debug, render **nothing**. This is
  the defect; a denial is not a message to the end user.
- `isActionMessageError(x)` → an operational failure (outage, bad data): keep today's visible error, but only
  for a card the user is otherwise permitted to see.
- If every card is hidden, render nothing under the Account tab (the tab itself will not exist for that user).

## 5. Product question — decided

**Question (card):** should ordinary client users see Client Settings at all, or keep read-only Client Details
and only hide the billing cards?

**Decision:** permission-driven; ordinary users keep **Client Details** (`client:read`, which they already have)
and lose **Account**/billing. Rationale:

- The customer's complaint is unauthorised *content* and permission *errors*, not the existence of read-only
  company details. Removing a permitted view is a larger behavioural change than was reported and is not
  reversible for tenants who rely on it.
- It keeps RBAC as the single control: a tenant that wants ordinary users to have nothing simply revokes
  `client:read`, and the link disappears on its own. No second, parallel "role" rule to explain.
- If Robert wants Client Settings to be admin-only after all, it is a one-line change in the resolver
  (`'client-details'` requires `is_client_admin` instead of `client:read`) with no other code moving. Recorded
  as a card fact so the choice is explicit and cheap to flip.

## 6. Scope boundaries

- Consumer/end-user side of the portal only. Server-side enforcement of billing/invoice/visibility actions is
  the separate Security card; this design **does not** weaken it — the page guard adds defence in depth, it does
  not replace action-level authorization.
- Phill's "reports" and "everywhere" (role and screens not identified) are out of scope until he names them. The
  surface-map shape is the adoption path for those screens when he does.
- Conversations 876 (CTTC) and 116 (RightPath) may be asking for the same thing; unconfirmed, out of scope.

## 7. Acceptance criteria (mapped)

1. Default `User` role: no "unauthorized"/permission-error text anywhere under Client Settings → §4 (permission
   errors render nothing) + §3 (Account tab absent).
2. Tabs and cards without permission are not rendered → §3 resolver + card gates.
3. Client Settings link hidden when the user has no permitted tab → `canOpenSettings`.
4. Direct URL without permission does not render the page → server `notFound()` + URL tab coercion.
5. Client Admin keeps today's access → resolver rows for `Admin` (billing + client + user + visibility as
   currently granted).

## 8. Tests

Unit — `clientPortalSettingsSurfaces.test.ts`: the role matrix in §3 (User / Finance / Admin / client-admin
contact / hosted vs non-hosted), plus "no permissions → no tabs, `canOpenSettings=false`".

Unit — settings page: tab list matches resolver output; `?tab=account` for a User coerces to `client-details`;
`?tab=user-management` for a non-admin is ignored.

Unit — `ClientAccount`: a `permissionError` from `getClientContractLine`/`getClientInvoices` renders no text;
an `actionError` still renders.

Unit — sidebar: link absent when `canOpenSettings=false`.

Server — the page route returns `notFound()` when no tab is permitted, and renders for a permitted user.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Hidden-by-UI but reachable by URL | server guard + URL coercion (§3) |
| Silently removing a view a tenant uses | Client Details retained for `client:read`; decision recorded and one-line reversible |
| Two implementations drifting again (the original defect) | one pure resolver; sidebar, tabs and server all call it; a test asserts the three agree |
| Card-level data still fetched for hidden cards | cards are not mounted when not permitted, so the actions are not called |

## 10. Follow-up

Report back on ticket alga-2026-0003226 (PBNJ, Phill Hodgkinson) when live; ask him to name the report screens
and role behind "reports and everywhere" so a follow-up card can adopt the same resolver.
