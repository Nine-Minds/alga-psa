# Plan — alga-2026-0002578: Entra user sync filter (security group / licensed users / exclusions)

## Implementation addendum — shared mailboxes (captain ruling 2026-09-24)

Supersedes the 2026-09-23 addendum and §4's first bullet. That addendum was right that Graph
`/users` and CIPP `listusers` carry no mailbox type. It missed CIPP's `ListMailboxes` endpoint, which does.

**Signal (CIPP only in this card).** `GET /api/ListMailboxes?tenantFilter=<tenant>&RecipientTypeDetails=SharedMailbox`
(CIPP-API `Invoke-ListMailboxes.ps1`, role `Exchange.Mailbox.Read`) runs Exchange `Get-Mailbox`.
Each row has `recipientTypeDetails` and `ExternalDirectoryObjectId`, and `ExternalDirectoryObjectId`
is the Entra user id we already fetch. Fetch it once per managed tenant per run, the same way the
group sets are resolved. `EntraSyncUser` gains `mailboxKind: 'shared' | null`, where `null` means unknown.
- The detected set covers `SharedMailbox` only. Room and equipment mailboxes are out of scope.
- If CIPP returns 401/403 or the API key lacks `Exchange.Mailbox.Read`, the tenant is not failed.
  Nothing is classified, the tenant keeps today's behaviour, and the preview and diagnostics show a
  warning that shared-mailbox detection is unavailable.
- Direct (Graph) mode: no classification, same warning. A reliable bulk source there needs the
  Exchange admin API and a new `Exchange.Manage` consent, which is a follow-up.
- Name or identity heuristics are never used.

**Contact model.** Add `contacts.contact_kind` (CE migration, text, not null, default `'person'`,
check constraint `IN ('person','shared_mailbox')`). Add it to `IContact` and the contact
interfaces/schema-alignment tests. Show a "Shared mailbox" badge on the contact list and detail pages.
A `shared_mailbox` contact can never be made a client admin or invited to the client portal
(enforced server side and hidden in the UI). Sync sets the kind when it creates or links a shared mailbox.

**Sync behaviour.** New filter config field `importSharedMailboxes: boolean` (default false). It is
a scalar override like the other toggles and gets a toggle on both the tenant-default and the
managed-tenant panel. In the pipeline, a user classified `shared` is evaluated **before**
`account_disabled` and `unlicensed`:
- toggle off → excluded with the new reason `shared_mailbox` (its own label and count, instead of
  "disabled account")
- toggle on → kept even though sign-in is disabled and it has no licence. Group and pattern filters
  still apply. The contact gets `contact_kind='shared_mailbox'`. A disabled sign-in on a detected
  shared mailbox never feeds `disabledIdentities`, so it is never deactivated as `disabled_upstream`.
- `shared_mailbox` is not in the `deactivateExcludedContacts` reason set, so turning the toggle off
  does not deactivate contacts that were already imported.
- Shared mailboxes do not count toward the 100%-excluded safety brake denominator.

Verification: unit tests for the pipeline order, the CIPP ListMailboxes mapping and the 403
fallback; an integration test for the migration and the sync with the toggle on and off; the CIPP
simulator (`tools/smoke-sim/entra-filter-cipp-sim.mjs`) gains `/api/ListMailboxes` and one disabled
shared mailbox for Northwind.

Branch `feature/alga-2026-0002578-entra-user-sync-filter-import`, worktree base `9fd1ddb58b` (v1.6.4).
Author: card officer (design author; no captain design session). The captain should rule on the
decisions marked **DECISION** before implementation starts.

## 1. Problem

Entra sync imports every user in each mapped Microsoft tenant: members, guests (`#EXT#`), and
unlicensed accounts. MSPs want to limit the import for each managed tenant: a security group, licensed
users only (no guests), and exclusions.

What exists today:

- `ee/server/src/lib/integrations/entra/sync/userFilterPipeline.ts:71` `filterEntraUsers()` is pure.
  It drops disabled accounts, accounts with no email-shaped identity, users matching the hard-coded
  service-account regexes (`:3-11`), and users matching tenant-wide custom regexes.
- `ee/server/src/lib/integrations/entra/settingsService.ts:34-56` reads
  `entra_sync_settings.user_filter_config` (one row per Alga tenant, jsonb, migration
  `ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs:163`). It accepts 4 alias keys
  for the pattern list. **Nothing writes this column**: no action, no route, no UI. Only
  `updateEntraFieldSyncConfig` writes `entra_sync_settings`
  (`packages/integrations/src/actions/integrations/entraActions.ts:501-540`), and only
  `field_sync_config`.
- The filter has four call sites, and every one keys only on the Alga tenant:
  - `ee/temporal-workflows/src/activities/entra-sync-activities.ts:346` (real sync)
  - `ee/server/src/lib/integrations/entra/sync/preflightService.ts:189` (the dry-run preview on the Clients tab)
  - `ee/server/src/lib/integrations/entra/diagnostics/clientDiagnostics.ts:231` (Direct path, paged) and `:777` (CIPP user-yield step)
- Per-managed-tenant group plumbing already exists for the **client portal entitlement**:
  - `entra_client_tenant_mappings.client_portal_entitlement_group_id` (migration `20260509173000`)
  - a group picker in `EntraTenantMappingTable.tsx:571-615`
  - `GET /api/integrations/entra/mappings/groups` (`ee/server/src/app/api/integrations/entra/mappings/groups/route.ts`)
  - adapter `listSecurityGroupsForTenant` / `isUserInSecurityGroup` (`providers/types.ts:27-36`)
  - a per-user `checkMemberGroups` fan-out at concurrency 8 (`entra-sync-activities.ts:347-381`)
- The Graph `/users` `$select` (`directProviderAdapter.ts:459-469`, duplicated at `:512-522` and
  `:697-706`) does not fetch `userType` or `assignedLicenses`. CIPP `listusers` returns Graph beta
  user objects (`cippProviderAdapter.ts:381-386`), stored whole in `user.raw`.
- A user who gets filtered out is simply absent from `users`. Their already-linked contact is left
  alone: only `account_disabled` exclusions feed `disabledIdentities` (`entra-sync-activities.ts:407-415`,
  `syncEngine.ts:292-325`). Nothing reactivates a contact when its user shows up again
  (`contactReconciler.ts` never sets `is_inactive:false` on an existing contact; `:319` is create-only).

## 2. Design

### 2.1 Filter model (typed, versioned)

New module `ee/server/src/lib/integrations/entra/sync/userFilterConfig.ts` holds the single
parser/normalizer and the types. Everything else stops reading the jsonb ad hoc.

```ts
interface EntraUserFilterConfig {
  version: 1;
  memberUsersOnly: boolean;          // drop userType === 'Guest'
  licensedUsersOnly: boolean;        // drop users with assignedLicenses.length === 0
  includeGroupIds: string[];         // if non-empty: keep only transitive members of ANY
  excludeGroupIds: string[];         // drop transitive members of ANY
  exclusionPatterns: string[];       // existing regex list (UPN/email/displayName/local-part)
  deactivateExcludedContacts: boolean; // see 2.5
}
```

- The defaults (all off or empty) reproduce today's behaviour exactly. Existing tenants see no change
  until they opt in.
- The parser still accepts the legacy alias keys (`excludePatterns`, `excludeUpnPatterns`,
  `excludedUpnPatterns`) when reading. It writes only the canonical shape.
- It validates regexes on write. Invalid patterns are rejected with a message. Today
  `compilePatterns` (`userFilterPipeline.ts:44-57`) silently drops them, which is a swallowed error.
- **DECISION D1 (defaults for new setups):** keep the global defaults as above. Have the UI pre-check
  "Members only" and "Licensed only" for managed tenants that have no saved override, without
  persisting anything until the operator saves. Recommended: do not change the defaults for existing
  data.

### 2.2 Storage: tenant default + per-managed-tenant override

- **Tenant default** stays in `entra_sync_settings.user_filter_config`, which finally gets a writer.
- **Per managed tenant**: new table `entra_managed_tenant_user_filters`:
  - columns `(tenant uuid, managed_tenant_id uuid, filter_config jsonb not null default '{}', updated_by uuid null, created_at, updated_at)`
  - PK `(tenant, managed_tenant_id)`
  - FK `(tenant, managed_tenant_id) → entra_managed_tenants ON DELETE CASCADE`
  - Citus: distribute on `tenant`, colocated with `entra_managed_tenants`, following the phase-1
    migration's pattern and `docs/AI_coding_standards.md` §CitusDB.
  - New migration: `ee/server/migrations/2026092xxxxxxx_entra_managed_tenant_user_filters.cjs`.
- Why a table and not a column on `entra_client_tenant_mappings`: the filter describes the *Microsoft
  directory*, not the client link. Mapping rows are replaced on confirm/remap/unmap, and
  `confirmMappingsService.ts:110-160` already has to hand-carry every portal field forward. A column
  there would need the same carry-forward and would be lost on unmap/remap. It also doesn't belong on
  `entra_managed_tenants`, which discovery upserts.
  `// LEVERAGE: friction mapping-carry-forward`: consider this marker at confirmMappingsService for
  the existing portal fields. Do not fix it in this card.
- **Merge rule** (effective = default ⊕ override): each scalar field in the override replaces the
  default when present. `exclusionPatterns` and `excludeGroupIds` are **unioned**, because exclusions
  only accumulate. `includeGroupIds` in an override **replaces**, because group IDs are specific to
  one Microsoft tenant, so a tenant-default include group makes no sense. The tenant-level UI
  therefore does not offer include/exclude groups at all; only the per-managed-tenant UI does.

### 2.3 Provider data

- **Direct** (`directProviderAdapter.ts`):
  - Hoist the three duplicated `select` arrays (`:459`, `:512`, `:697`) into one module const
    `GRAPH_USER_SELECT` and add `userType,assignedLicenses`. Both are readable under the existing
    `Directory.Read.All` (`auth/directScopes.ts:9-14`), so **no new consent is needed**.
  - New adapter method `listSecurityGroupMemberIds({ tenant, managedTenantId, groupId, membershipMode:'transitive' }): Promise<Set<string>>`.
    It pages `GET /groups/{id}/transitiveMembers/microsoft.graph.user?$select=id&$top=999`. That is
    one paged call per group instead of one call per user.
- **CIPP** (`cippProviderAdapter.ts`):
  - `userType` and `assignedLicenses` come from `raw` when present.
  - `listSecurityGroupMemberIds` has no CIPP bulk transitive-members endpoint verified against
    CIPP-API source. The implementation falls back to the existing per-user `isUserInSecurityGroup`
    over the user list, which the caller supplies. Note that CIPP `listusergroups` is `memberOf`
    (direct membership), so "transitive" is already not honoured for CIPP today. Document this in the
    UI hint; do not fix it here.
- `EntraSyncUser` (`sync/types.ts:1-19`) gains `userType: 'Member' | 'Guest' | null` and
  `assignedLicenseCount: number | null`. `null` means the provider didn't say. Both adapters populate
  them in `normalizeEntraSyncUser`.

### 2.4 Pipeline

- `filterEntraUsers(users, policy)` stays **pure and synchronous**. `policy` is a resolved
  `EntraUserFilterPolicy`: the effective config plus `includeMemberIds?: Set<string>` and
  `excludeMemberIds?: Set<string>`, already resolved.
- Rule order is cheapest and most-certain first, so the recorded reason is stable:
  `account_disabled` → `missing_identity` → `guest_user` → `unlicensed` → `service_account` →
  `tenant_custom_pattern` → `excluded_group` → `not_in_included_group`.
- **Fail-safe on unknown data:** when `memberUsersOnly`/`licensedUsersOnly` is on and the user's
  field is `null`, keep the user and count them in `policy.unknownFieldCounts`. Diagnostics and the
  preview surface that count as a warning ("license data unavailable from CIPP for N users"). Never
  exclude on missing data.
- A new async resolver in `settingsService.ts` replaces `filterEntraUsersForTenant`:
  `resolveEntraUserFilterPolicy({ tenant, managedTenantId /*local PK*/, entraTenantId, adapter, users? })`.
  It loads default + override, merges them, and resolves group member sets through the adapter.
  **Any group resolution error throws**, which fails that managed tenant's sync. It must never
  degrade to "exclude everyone" or "include everyone".
  - Also export the convenience wrapper
    `filterEntraUsersForManagedTenant(ctx, users) = filterEntraUsers(users, await resolve…)`.
- Call-site changes:
  1. `entra-sync-activities.ts:346`: use the managed-tenant wrapper, which has the mapping's
     `managedTenantId` and `entraTenantId`.
  2. `preflightService.ts:189`: the same. The mapping is already loaded at `:170`.
  3. `clientDiagnostics.ts:231`: resolve the policy **once** before the page loop (group sets are
     tenant-wide) and pass it into `filterEntraUsers` per page. Don't re-resolve per page.
  4. `clientDiagnostics.ts:777`: use the managed-tenant wrapper.
  - Delete `filterEntraUsersForTenant` and update the mocks in `entraPreflightService.test.ts:8,25`
    and `entraClientDiagnostics.test.ts:111`.
- Portal entitlement reuse: `entra-sync-activities.ts:347-381` does N `checkMemberGroups` calls.
  Switch it to the same `listSecurityGroupMemberIds` set, cached per run in a small
  `GroupMembershipResolver` that both the filter and the entitlement use, so one group fetched twice
  costs one call. The `isMember` semantics stay identical (true/false; `null` when there is no group).
  This is the layering fix. Keep `isUserInSecurityGroup` on the interface for the CIPP fallback.

### 2.5 Contacts that fall out of scope (the part that actually cleans up the customer's data)

- Today an excluded user's existing contact is untouched forever. Customers who already imported
  guests and unlicensed accounts keep that clutter even after they configure a filter.
- Add the opt-in `deactivateExcludedContacts` (default **false**). When it is on, filter exclusions
  with reasons in {guest_user, unlicensed, tenant_custom_pattern, excluded_group,
  not_in_included_group} (not `service_account` or `missing_identity`, which are heuristics) feed
  `executeEntraSync` as a new `excludedIdentities` input. They are marked inactive with reason
  `excluded_by_filter` by a new `markExcludedEntraUsersInactive` in `disableHandler.ts` (beside
  `:119-139`). They pass through the same dry-run guard as `disabledIdentities`
  (`syncEngine.ts:292-325`), so the preflight counts them and never writes.
- **Safety brake:** if the policy excludes 100% of the enabled users in a tenant that has any
  linked contacts, skip the deactivation, record a run warning, and still sync nothing. This protects
  against a mis-picked group wiping a client's contacts.
- **Reactivation:** when a user who was excluded before is included again, reactivate the contact
  **only if** `entra_sync_status_reason = 'excluded_by_filter'`. Contacts that are
  `disabled_upstream`, `deleted_upstream`, or that an operator deactivated by hand stay inactive.
  This goes in `contactReconciler.ts` on the linked/updated path, dry-run guarded.
- **DECISION D2:** ship 2.5 in this card (recommended; without it the feature only stops *new*
  clutter), or split it to a follow-up card.

### 2.6 API / actions

- Server actions in `packages/integrations/src/actions/integrations/entraActions.ts`, modelled on
  `updateEntraFieldSyncConfig` (`:501`): EE-gated, `system_settings:update` for writes and
  `system_settings:read` for reads, no client-portal users.
  - `getEntraUserFilterDefaults()` / `updateEntraUserFilterDefaults(input)`
  - `getEntraManagedTenantUserFilter({ managedTenantId })` returns `{ override, effective }`
  - `updateEntraManagedTenantUserFilter({ managedTenantId, override | null })`. `null` clears the
    row, which means inherit.
- The writes go through EE route handlers under `ee/server/src/app/api/integrations/entra/filters/`
  (`route.ts` for defaults, `[managedTenantId]/route.ts` for overrides) using `requireEntraAccess`.
  This keeps the existing `callEeRoute` pattern the other Entra actions use.
- Validation lives in `userFilterConfig.ts` and is shared by the route and the parser.
- Group pickers reuse `listEntraMappingGroups` (`entraActions.ts:978`), so no new group endpoint.

### 2.7 UI

- **Field rules tab** (`EntraConsole.tsx:97`, `FieldSyncRules.tsx`): add an "Who gets imported"
  `EntraSection` for tenant defaults: Members only, Licensed only, exclusion patterns (a chip/list
  editor with inline regex validation and a live "matches" test box), and Deactivate excluded
  contacts. It saves through `updateEntraUserFilterDefaults`.
- **Clients tab** (`EntraClientsTab.tsx`), in the expanded row: add an "Import filter" panel that
  shows the effective settings with "inherited"/"overridden" markers. It has overrides for the
  toggles, the include/exclude group pickers (reusing the lazy group load pattern from
  `EntraTenantMappingTable.tsx:381-404`, including its broad-group warning heuristic `:70`), and extra
  exclusion patterns. There is a "Preview" button that runs the existing `runEntraPreflight`, so the
  operator sees the effect before saving: Save + Preview.
- `ContactPreflightReport.tsx` and `EntraDiagnosticsDialog.tsx`:
  - render the new exclusion reasons as counts with labels
  - add a "Linked contacts now out of scope: N (will be / would be deactivated)" bucket
  - show the unknown-field warning
- i18n: add keys to `server/public/locales/en/msp/integrations.json`, then the other locales
  (`de es fr it nl pl pt`), with the pseudo-locales `xx`/`yy` generated per the i18n standard.
  Component IDs follow the UI reflection guidelines.

## 3. Order of work

1. `userFilterConfig.ts`: types, parser (legacy aliases), validator, merge. Unit tests.
2. `EntraSyncUser` gains `userType` / `assignedLicenseCount`. Direct `GRAPH_USER_SELECT` hoist and
   mapping, CIPP mapping. Adapter unit tests.
3. Adapter `listSecurityGroupMemberIds` (Direct bulk, CIPP fallback) and `GroupMembershipResolver`.
4. Pure pipeline: new reasons, order, unknown-data fail-safe. Extend `entraUserFilterPipeline.test.ts`.
5. Migration for `entra_managed_tenant_user_filters`, interface row type in `entra.interfaces.ts`,
   and the schema-alignment test (`server/src/test/unit/integrations/entraInterfacesSchemaAlignment.test.ts`).
6. `resolveEntraUserFilterPolicy` plus the four call sites. Delete `filterEntraUsersForTenant` and fix
   the mocks.
7. Portal entitlement switched to the shared resolver (behaviour-identical; existing entitlement
   tests must pass unchanged).
8. Excluded-contact deactivation, safety brake, and scoped reactivation (if D2 = in).
9. EE routes, then server actions.
10. UI: Field rules section, Clients-tab panel, report/diagnostics reasons, i18n.
11. Verification pass (section 6), manual smoke, and a docs note in the Entra integration docs.

## 4. Out of scope

- **Shared mailboxes as "service users".** Graph v1.0 `/users` cannot identify a shared mailbox
  (`recipientTypeDetails` is Exchange-only). Shared mailboxes normally have `accountEnabled=false`,
  so they are *already* dropped today as `account_disabled`. A side effect is that a linked
  shared-mailbox contact gets deactivated as "disabled upstream". Importing them as a separate kind
  needs Exchange Online access (a new consent) and a contact/user type decision. That should be a
  follow-up card.
- Filtering by a specific license SKU (e.g. "only E3"). That needs `Organization.Read.All` /
  `subscribedSkus` for SKU names. The v1 filter is "has any license". The config is versioned so a
  `requiredSkuIds` field can be added later.
- Fixing CIPP's direct-only group membership (`memberOf`) to be transitive.
- Changing the hard-coded service-account heuristics, and hardening the mapping carry-forward
  (marker only).
- CE: the Entra integration is EE-only; the actions return `eeUnavailableResult` as today.

## 5. Risks

- **R1 Mass deactivation** from a wrong group or a Graph hiccup. Mitigations:
  - deactivation is opt-in
  - group resolution errors fail the tenant run instead of degrading
  - the 100%-excluded safety brake
  - Preview before save
  - reactivation scoped to `excluded_by_filter`
- **R2 CIPP field availability.** `userType`/`assignedLicenses` may be missing from CIPP `listusers`
  depending on CIPP version. The fail-safe keeps those users and warns. Verify against a live CIPP
  instance, or at minimum CIPP-API `Invoke-ListUsers.ps1` source.
- **R3 Graph throttling.** `transitiveMembers` for large groups is paged at 999. This is cheaper than
  today's per-user `checkMemberGroups`. Pre-resolving the policy once per diagnostics request removes
  per-page repeats.
- **R4 Citus.** The new table must be distributed and colocated. Every query goes through `tenantDb`
  with `tenant` in the predicate. The FK must include `tenant`.
- **R5 Behavioural drift.** Defaults are all off, and the pipeline unit tests pin today's outputs for
  an empty config. The entitlement refactor must not change `isMember` results.
- **R6 The Temporal worker ships separately.** The activity and the server both import
  `settingsService`. Deploy both images together; the migration must run before the worker picks up
  the new code (the table-missing case is handled by treating it as no override).

## 6. Verification

- **Unit (vitest, `ee/server/src/__tests__/unit/`):**
  - config parser/merge/validation, including legacy keys, the union-vs-replace rules, and invalid
    regex rejection
  - pipeline: each new reason, the rule order, the unknown-field fail-safe, and an empty config
    matching the current snapshot
  - Direct adapter: `$select` contains the new fields; `transitiveMembers` paging
  - CIPP adapter: field mapping and the fallback
  - syncEngine: `excludedIdentities` is dry-run guarded; safety brake
  - preflight/diagnostics: the updated mocks and the new reason counts
- **Integration (`ee/server/src/__tests__/integration/`, per the integration-testing skill):**
  - migration up/down
  - override CRUD through the routes, with tenant isolation
  - end-to-end `syncTenantUsersActivity` with a mocked adapter: include group plus licensed-only
    yields the expected contacts
  - deactivate-excluded then re-include reactivates only `excluded_by_filter` contacts
  - `entraDiagnostics.integration.test.ts:321` updated for the canonical config shape
- **Contract:** schema-alignment test for the new row type; route contract tests beside
  `entraMappingsConfirmRoute.contract.test.ts`.
- **Manual smoke** on the dev server (port 3129, stack `alga-psa-local-test`), with Direct
  self-tenant smoke mode (`ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE`, plus the synthetic tenants and extra
  users env hooks in `directProviderAdapter.ts:44-120` to inject a guest and an unlicensed user):
  1. set tenant defaults
  2. override a managed tenant with a group
  3. Preview shows the expected reasons and counts
  4. run the sync
  5. confirm the contacts
  6. turn on deactivate-excluded and re-run
  7. loosen the filter and confirm reactivation
- **Build:** `npm run build` (EE) and the temporal-workflows typecheck, because the activity imports
  change.
