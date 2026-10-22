# Service requests: restrict forms to specific clients and client-user groups

Card `1c48ad98-7a36-49bd-b871-37f466cb9740` (PBNJ Consulting, 2026-10-22).
Worktree: `~/alga-copies/feature-service-requests-restrict-forms-to-specific-clie`.

## 1. What changes

Today the only built-in visibility provider,
`server/src/lib/service-requests/providers/builtins/allAuthenticatedClientUsersVisibilityProvider.ts:3-10`,
has no config and always returns `true`. The only real filter is EE
`advanced-visibility` (`ee/server/src/lib/service-requests/providers.ts:412-512`,
registered at `:599`), configured by hand-written `allowedClientIds` /
`allowedRequesterUserIds` JSON in the editor textarea. Add first-class
tenant-scoped audience scoping that works in CE and composes with that contract.

New: `server/src/lib/service-requests/definitionAudience.ts` (loaders + the
single predicate, §3), `ServiceRequestAudienceEditor.tsx` (§4), and
`server/migrations/20261022090000_add_service_request_audience_scoping.cjs`.

Modify: `portalCatalog.ts:101-132` and `portalDetail.ts:91-118` (shared
predicate); `definitionEditor.ts:78-79,182-183` (expose `execution.audience`);
`actions.ts:488-505` (add `updateServiceRequestAudienceAction`, keep the
visibility-config action for EE); `definitionManagement.ts:324-366` (copy
audience on duplicate); `definitionValidation.ts:94-102` (reject an empty
`scoped` audience at publish); `ServiceRequestDefinitionEditorPage.tsx:689-692,1144-1154,1843-1880`
(render the editor, include it in "Save all").

Reuse, do not invent:
- `packages/ui/src/components/ClientPicker.tsx:34-67` (async `searchClients`)
  backed by `searchClientsForPicker` (`clientPickerActions.ts:47`), plus
  `MultiContactPicker.tsx:14-71` for the search-plus-chips pattern. No
  multi-client picker exists; add clients one at a time and render chips.
- `visibilityGroupActions.ts:268` (`getClientPortalVisibilityGroups`) for a
  client's groups; MSP users with `contact:update` may already read them.

## 2. Data model

`client_portal_visibility_groups` is per client
(`server/migrations/20260315110000_create_client_portal_visibility_groups.cjs:18-30`,
membership via `contacts.portal_visibility_group_id` at `:80-91`). A "group of
client users" is therefore always a group inside exactly one client.

Migration `server/migrations/20261022090000_add_service_request_audience_scoping.cjs`:

- `service_request_definitions.audience_mode text not null default 'all'`
  with `CHECK (audience_mode IN ('all','scoped'))`.
- `service_request_audience_clients`: `tenant uuid`, `definition_id uuid`,
  `client_id uuid`, `created_at timestamptz default now()`; PK
  `(tenant, definition_id, client_id)`; FKs `(tenant, definition_id)` to
  definitions and `(tenant, client_id)` to clients, both on delete cascade;
  index `(tenant, client_id)`.
- `service_request_audience_client_groups`: `tenant uuid`, `definition_id uuid`,
  `group_id uuid`, `created_at`; PK `(tenant, definition_id, group_id)`; FKs
  `(tenant, definition_id)` to definitions and `(tenant, group_id)` to
  `client_portal_visibility_groups`, both cascade; index `(tenant, group_id)`.

`audience_mode='all'` plus zero rows means Everyone. It is the default and the
migration value, so existing definitions are unchanged. `'scoped'` plus zero
rows means nobody (fail closed). "Empty rows = everyone" would silently publish
a form to everyone when the last client is removed; the mode column makes intent
explicit. No backfill and no change to `service_request_definition_versions`.

Tenancy: every row carries `tenant`, both FKs use the composite tenant key, and
all reads use `tenantDb(knex, tenant)`. A cross-tenant group id cannot match a
tenant-qualified join.

## 3. Where the restriction is enforced

Single authority in `definitionAudience.ts`:

```
loadDefinitionAudience(db, definitionId)             // one form
loadDefinitionAudiences(db, definitionIds[])         // catalog batch
isDefinitionVisibleToRequester({ audience, contactGroupId, context }, providerAllowed)
```

It returns `providerAllowed && audienceAllowed`, where `audienceAllowed` is:
- `all` → true;
- `scoped` and `context.clientId` is in `audience.clientIds` → true;
- `scoped` and `context.contactId`'s `portal_visibility_group_id` is in
  `audience.groupIds` → true;
- otherwise false.

`contactGroupId` is loaded once per request from `contacts` (`null` contactId
never matches a group). The predicate is pure and unit-testable; only the
loaders run SQL.

Must change:
- `portalCatalog.ts:101-132` — batch-load audiences before the loop and pass the
  existing provider result through the predicate. A restricted form disappears
  from the list.
- `portalDetail.ts:91-118` — load one audience and use the same predicate;
  `null` remains the "not visible" result.

Must **not** change:
- `submissionService.ts:261-278` — it already calls
  `getVisiblePublishedServiceRequestDefinitionDetail` and throws
  `Service request is not visible or not published`. That is the submit gate; a
  second check would duplicate the authority and risk drift.
- `server/src/app/client-portal/request-services/actions.ts` and
  `[definitionId]/actions.ts` — they already pass `clientId` and
  `currentUser.contact_id`; only tests need to prove propagation.
- `definitionPublishing.ts:113-114` — audience is an access policy on the
  definition, not form content. Publishing must not freeze or resurrect an old
  audience; tightening access takes effect immediately. EE
  `advanced-visibility` stays version-snapshotted and is ANDed with it.

## 4. Builder UI

Current settings live in `ServiceRequestDefinitionEditorPage.tsx`'s execution
`Card`: state at `:689-692`, textarea/save at `:1843-1880`, "Save all" parse at
`:1144-1154`, provider selector at `:1525`.

`ServiceRequestAudienceEditor.tsx`, rendered where the JSON block is today when
the provider is `all-authenticated-client-users`:
- Radio/segmented **Everyone** (default) or **Selected clients and client-user
  groups**.
- Scoped mode: `ClientPicker` with `searchClients={searchClientsForPicker}`,
  each pick rendered as a removable chip (`ClientAvatar` + name).
- Under each selected client, a checkbox/chip list of that client's visibility
  groups from `getClientPortalVisibilityGroups`, labelled with the client name.
  No group picker exists; this is the minimum honest UI.
- Save calls `updateServiceRequestAudienceAction(definitionId, { mode, clientIds, groupIds })`.
  It requires `service-request:update`, verifies clients and groups belong to
  the tenant (and each group to a selected client), replaces rows in one
  transaction, and writes `audience_mode`.
- Keep the raw JSON textarea only for `advanced-visibility` under a labelled
  advanced section; server-side both restrictions apply.
- Add keys under `editor.execution.visibility.audience.*` in
  `server/public/locales/{en,de,es,fr,it,nl,pl,pt,sv,xx,yy}/msp/service-requests.json`.

## 5. Order of work

1. Migration + types; run `serviceRequestDomainTables`.
2. `definitionAudience.ts` + pure-predicate unit tests.
3. Wire catalog (batch) and detail; integration tests for list/detail/submit.
4. Editor data, save action, publish validation, duplicate-copy.
5. Audience editor + page wiring + "Save all"; locale keys.
6. Typecheck, service-request suites, i18n validation, browser pass.

## 6. Explicit non-goals

- No change to `client_portal_visibility_groups` or `visibilityGroupActions`.
- No contact-level allow-list (card mentions it; client + group is this scope).
- No new picker and no multi-select rewrite of `ClientPicker`.
- No per-version audience snapshots and no audience copy in publishing.
- No MSP-side restriction; staff still see and manage every form.
- No new EE license gate; scoping is core.

## 7. Risks

- **Groups are client-owned.** A group from client A never grants a client B
  user; show the client name next to every group. **Group deletion** cascades
  scope rows away, so deleting the last group of a `scoped` form means nobody
  (fail closed). Warn in the UI; do not auto-flip to `all`.
- **Contacts without a group** match client scopes only. Reassigning a contact
  changes access immediately (intended): call
  `revalidatePath('/client-portal/request-services')` from the save action and
  verify caching.
- **Tenant leakage.** A loader missing `tenant` over-grants; composite FKs,
  `tenantDb`, and a cross-tenant test are required.
- **Two models.** EE `advanced-visibility` remains and effective access is the
  intersection. **On-behalf creation:** no MSP path exists today; any future one
  must pass the target client's contact/group or fail closed. **Draft vs
  published:** a draft scoped form stays invisible, and publishing must not
  copy audience rows into versions.

## 8. Test plan

Extend `serviceRequestPortalCatalog.integration.test.ts` (~`:234`),
`serviceRequestPortalDetail.integration.test.ts` (~`:86`, `:171`),
`serviceRequestDefinitionEditor.integration.test.ts`,
`serviceRequestAdvancedVisibility.integration.test.ts` (advanced + audience =
AND), and `editor.i18n.test.tsx` / `npm run validate-translations`.

New `serviceRequestAudienceScoping.integration.test.ts`: `all` visible to
everyone (regression); client scope visible/detail/submit for A but not B (no
submission row for B); group scope allows the assigned contact, not a contact
with no group or another group; a group from another client cannot grant
access; `scoped` with zero rows is invisible; duplicate copies mode + rows;
tenant isolation. New `definitionAudience.unit.test.ts` for the pure predicate
(all, scoped, group, null contact), and `ServiceRequestAudienceEditor.test.tsx`
under `server/src/test/unit/app/msp/service-requests/` for the Everyone default,
add/remove client, per-client group toggles, and the `mode: 'scoped'` payload.

Verify with `npx tsc --noEmit` in `server`, the integration files above against
the test DB, then a browser pass as an MSP admin and as a client user in the
restricted and unrestricted clients.

## 9. Corrections to the card

1. CE does not "ignore config"; `all-authenticated-client-users` accepts any config and returns `true`.
2. `client_portal_visibility_groups` are per-client groups of contacts, not tenant-wide client-user groups; a group selection implies its client.
3. "Add service-request definitions to what visibility groups can scope" is the reverse relation and would change the group tables. The form referencing groups is smaller and correct.
4. Submit does not enforce visibility itself: `submissionService.ts:261` calls the detail function. Only catalog and detail need wiring.
5. `allowedRequesterUserIds` is a per-user id allow-list, not group membership; it stays with the EE provider.
6. No on-behalf MSP submission path exists today, so that risk is future-only.
