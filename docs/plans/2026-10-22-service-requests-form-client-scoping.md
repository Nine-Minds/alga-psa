# Service requests: restrict forms to specific clients and client-user groups

Card `1c48ad98-7a36-49bd-b871-37f466cb9740` (PBNJ Consulting, 2026-10-22).
Worktree: `~/alga-copies/feature-service-requests-restrict-forms-to-specific-clie`.

**Revision 2 (2026-10-25).** The first design — two audience link tables
(`service_request_audience_clients`, `service_request_audience_client_groups`)
plus `audience_mode` — is superseded. The audience is now **one stored
predicate** on `@alga-psa/predicates` (shipped by card `9798abc3`, PR #3858),
which lets a form target clients, client tags, client-user groups, contacts and
contact tags without a table per audience kind. The link tables and their
migration are withdrawn before ever reaching main; the migration file is
rewritten in place, not layered over.

## 1. What changes

Today the only built-in visibility provider has no config and always returns
`true`
(`server/src/lib/service-requests/providers/builtins/allAuthenticatedClientUsersVisibilityProvider.ts:3-10`).
The only real filter is EE `advanced-visibility`
(`ee/server/src/lib/service-requests/providers.ts:412-512`, registered `:599`),
configured by hand-written `allowedClientIds` / `allowedRequesterUserIds` JSON in
the editor textarea (`ServiceRequestDefinitionEditorPage.tsx:1843-1878`). CE
ignores that config.

New:
- `server/src/lib/service-requests/definitionAudience.ts` — the audience
  vocabulary, validation, the portal **subject** loader and the single decision
  function (§3).
- `server/src/components/settings/service-requests/ServiceRequestAudienceEditor.tsx`
  (§4).
- `server/migrations/20261022090000_add_service_request_audience_scoping.cjs`
  (rewritten, §2).

Modify: `portalCatalog.ts:101-132` and `portalDetail.ts:91-118` (shared
decision); `definitionEditor.ts:78-79,182-183` (expose `execution.audience`);
`actions.ts:488-505` (`updateServiceRequestAudienceAction`; keep the
visibility-config action for EE); `definitionManagement.ts:324-366` (copy the
audience on duplicate); `definitionValidation.ts:94-102` (reject an invalid or
empty audience at publish); `ServiceRequestDefinitionEditorPage.tsx:689-692,1144-1154,1843-1880`.

Reuse, do not invent:
- `packages/predicates` (`evaluatePredicate`, `predicateGroupSchema`,
  `PREDICATE_OPERATORS`, `SET_OPERATORS`) — the same condition model the ticket
  list and workflow conditions already use. One semantics contract
  (`packages/predicates/spec/SEMANTICS.md`), one conformance suite.
- `packages/ui/src/components/ClientPicker.tsx:34-67` (async `searchClients`,
  backed by `searchClientsForPicker`, `clientPickerActions.ts:47`) and
  `MultiContactPicker.tsx:14-71` for the search-plus-chips pattern.
- The entity-tag picker and tag chip components from `packages/tags` (card
  `9798abc3`) for client-tag and contact-tag selection.
- `visibilityGroupActions.ts:268` (`getClientPortalVisibilityGroups`) to list a
  client's groups.

## 2. Data model

One column, no link tables:

```sql
ALTER TABLE service_request_definitions
  ADD COLUMN audience_filter jsonb NULL;
```

- `NULL` = **everyone** (today's behaviour; the default, so no definition
  changes on deploy).
- A `PredicateGroup` (JSON) = the audience, evaluated against the portal
  viewer (§3). It is `{"join":"or","clauses":[…]}` so each clause is one
  audience *source*; an empty `or` group matches nobody and is rejected at save
  (§4) rather than stored.
- No `audience_mode` column: `NULL` already encodes "everyone", and a stored
  group encodes intent. "Empty rows = everyone" — the failure mode the old
  `audience_mode` column existed to prevent — cannot happen, because the
  audience is a value, not a row set.
- CHECK `audience_filter IS NULL OR jsonb_typeof(audience_filter) = 'object'`;
  shape is enforced in application code by `predicateGroupSchema`.
- No backfill, and no change to `service_request_definition_versions`: audience
  is an access policy, not form content (§3, "Must not change").

The withdrawn tables (`service_request_audience_clients`,
`service_request_audience_client_groups`), their FKs and indices disappear from
the migration. The migration never ran on any shared DB (see the card's
`smokeReport`: `20261022090000` had never been applied and had to be applied by
hand for the smoke), so no down-migration is needed.

Tenancy follows the definition row: the audience filter carries no ids of its
own except the tag/client/group/contact ids inside clauses, all of which are
resolved against the viewer's tenant-scoped subject. A foreign-tenant id in a
clause can only match a foreign-tenant subject, which cannot occur (§3
`loadAudienceSubject` is always `tenantDb`-scoped and reads the current
contact). Save-time validation rejects ids that do not exist in the tenant.

## 3. Where the restriction is enforced

Single authority, `server/src/lib/service-requests/definitionAudience.ts`.

### 3.1 The audience vocabulary

An audience is a predicate over the **viewer**, not over a table, so it gets its
own path vocabulary (not the ticket query schema). Paths, with the operators the
editor may emit:

| Path | Kind | Meaning | Editor operator |
| --- | --- | --- | --- |
| `client.id` | scalar uuid | the viewer's client | `in` |
| `client.tags` | set of tag ids | tags on that client | `in` (any of) |
| `contact.id` | scalar uuid | the viewer's contact | `in` |
| `contact.tags` | set of tag ids | tags on that contact | `in` (any of) |
| `contact.groups` | set of visibility-group ids | the contact's portal visibility group(s) | `in` (any of) |

`contact.groups` is a set even though `contacts.portal_visibility_group_id` is a
single column today: the set form gives "member of any of these groups" for
free and stays correct if a contact ever belongs to more than one group.

`AUDIENCE_PATHS` is the allow-list. `validateAudienceFilter(filter)` walks the
group, rejects an unknown path, rejects an operator not permitted for the path
kind (`SET_OPERATORS` for set paths; `in`/`not_in`/`equals`/`not_equals`/
`is_empty`/`is_not_empty` for scalar paths), and rejects an empty group at the
root. `predicateGroupSchema` is applied first, so a malformed node never reaches
the vocabulary check. This is what makes a stored filter safe to evaluate: the
evaluator is total, but the vocabulary is what stops a caller inventing
`contact.password` and reading it.

### 3.2 The subject

```ts
loadAudienceSubject(db, context): Promise<AudienceSubject>
// { client: { id, tags: string[] }, contact: { id, tags: string[], groups: string[] } }
```

- One query for the contact row (`tenantDb`, by `contact_id` from the session),
  one batched tag read over `tag_mappings` for `(tagged_type, tagged_id)` in
  `('client', clientId)` / `('contact', contactId)`.
- A missing contact (`null`) yields `contact: { id: null, tags: [], groups: [] }`,
  so contact-scoped clauses simply do not match — the same "missing never
  satisfies a comparison" rule the semantics contract already fixes.
- Loaded once per request and passed to the catalog loop; `portalDetail` loads
  it for the single definition.

### 3.3 The decision

```ts
isDefinitionVisibleToRequester({ audienceFilter, subject, providerAllowed }): boolean
// providerAllowed && (audienceFilter === null || evaluatePredicate(audienceFilter, subject))
```

- `evaluatePredicate` from the package root: deterministic, Node-free, already
  conformance-tested for every operator, missing-value rule and set semantics.
  No new SQL compiler surface and no second semantics.
- A stored filter that fails `validateAudienceFilter` (only possible if a row was
  written by something other than this action) **fails closed**: return `false`
  and log once, scoped. Never throw into the portal request path.

### 3.4 Enforcement points

Must change:
- `portalCatalog.ts:101-132` — load the subject once, pass the existing provider
  result through the decision. A restricted form disappears from the list.
- `portalDetail.ts:91-118` — same decision; `null` remains "not visible".

Must **not** change:
- `submissionService.ts:261-278` — it already calls
  `getVisiblePublishedServiceRequestDefinitionDetail` and throws
  `Service request is not visible or not published`. That is the submit gate; a
  second check would duplicate the authority and drift.
- `server/src/app/client-portal/request-services/actions.ts` and
  `[definitionId]/actions.ts` — already pass `clientId` and
  `currentUser.contact_id`; tests only prove propagation.
- `definitionPublishing.ts:113-114` — audience is an access policy on the
  definition, not form content. Publishing must not freeze or resurrect an old
  audience: tightening access takes effect immediately. EE
  `advanced-visibility` stays version-snapshotted and is ANDed with it.

### 3.5 CE vs EE

Enforcement is core (`server/src/lib/service-requests/…`), so client, group,
contact and tag scoping works in CE with **no** license gate. EE
`advanced-visibility` remains what it is — user-id allow-lists and its own
provider config — and the effective answer is
`providerAllowed AND audienceAllowed`, i.e. the intersection. The audience editor
is shown for every provider, because audience is orthogonal to provider choice.
The raw JSON textarea survives only for `advanced-visibility`, under a labelled
advanced section.

## 4. Audience editor

`ServiceRequestAudienceEditor.tsx`, rendered where the visibility JSON block is
today (`ServiceRequestDefinitionEditorPage.tsx:1843-1880`), replacing it for the
built-in provider:

- Segmented **Everyone** (default; stores `null`) / **Selected audience**
  (stores a group).
- "Selected audience" is a list of **sources**, each a row with a picker and a
  removable chip set, all ORed:
  - *Clients* — `ClientPicker` (`searchClients={searchClientsForPicker}`), each
    pick a `ClientAvatar` + name chip → `{path:'client.id', operator:'in', value:[…ids]}`.
  - *Client tags* — tag picker scoped to entity type `client` →
    `{path:'client.tags', operator:'in', value:[…tagIds]}`.
  - *Client-user groups* — pick a client, then its groups from
    `getClientPortalVisibilityGroups`, shown with the owning client's name (a
    group belongs to exactly one client) →
    `{path:'contact.groups', operator:'in', value:[…groupIds]}`.
  - *Contacts* — `MultiContactPicker` →
    `{path:'contact.id', operator:'in', value:[…contactIds]}`.
  - *Contact tags* — tag picker scoped to `contact` →
    `{path:'contact.tags', operator:'in', value:[…tagIds]}`.
- Row group `join: 'or'`. Inside one row, multiple selections are one `in`
  clause (any of). The semantics read exactly like the intent: "visible to
  Client X **or** clients tagged VIP **or** members of group G **or** contact C".
- Editor data is the parsed filter plus picker display data, so the saved filter
  is the single source of truth. Parsing is total: a clause the editor cannot
  represent (hand-written JSON, a future path) is shown in a read-only JSON
  fallback with a warning; saving that definition keeps the filter unchanged
  unless the admin edits a row, so nothing is silently dropped.
- Save calls `updateServiceRequestAudienceAction(definitionId, filter)`, which:
  requires `service-request:update`; runs `validateAudienceFilter`; verifies
  every id inside clauses exists in the tenant (clients, groups, contacts, tags,
  each with its tenant key); rejects an empty group with "add at least one
  audience"; rejects a scalar path given a list; writes the column in one
  statement and revalidates `/client-portal/request-services`.
- "Save all" (`:1144-1154`) includes the audience state alongside execution
  content; the definition editor's `execution.audience` read
  (`definitionEditor.ts:78-79`) supplies it.
- Duplicate copies `audience_filter` verbatim (`definitionManagement.ts:324-366`).
- Publish (`definitionValidation.ts:94-102`) refuses an invalid or empty
  audience; a valid non-empty audience is required to be non-empty by
  construction.
- Locale keys under `editor.execution.visibility.audience.*` in
  `server/public/locales/*/msp/service-requests.json` (all existing locales;
  `npm run validate-translations` is part of the gate).

## 5. Dependency: the predicates package must exist

`@alga-psa/predicates` reaches `main` with card `9798abc3` (PR #3858), which is
not merged yet. This card therefore **stacks on `9798abc3`** (`stackMode=after`),
and its implementation steps stay held until that parent merges and the branch
is carried onto main. The design is written against the package's v1 API
(`types.ts`, `schema.ts`, `evaluate.ts`) and needs no change when it lands; if the
API shifts in review, the adapter in §3.3 is the only place to touch.

## 6. Order of work

1. Migration (rewritten) + generated types; run `serviceRequestDomainTables`.
2. `definitionAudience.ts`: vocabulary, `validateAudienceFilter`,
   `loadAudienceSubject`, `isDefinitionVisibleToRequester` + unit tests.
3. Wire catalog (one subject per request) and detail; integration tests for
   list/detail/submit across every audience kind.
4. Editor data, save action, publish validation, duplicate-copy.
5. `ServiceRequestAudienceEditor` + page wiring + "Save all"; locale keys.
6. Typecheck, service-request suites, i18n validation, browser pass.

## 7. Explicit non-goals

- No link tables, no `audience_mode`, no per-audience-kind schema.
- No exclusions in v1 (`not_in` rows): audience is a union of admits. The
  vocabulary permits `not_in`, but the editor will not emit it until someone
  asks for "everyone except".
- No new general predicate builder UI. The editor is a fixed, labelled list of
  audience sources; admins do not author arbitrary expressions.
- No change to `client_portal_visibility_groups` or `visibilityGroupActions`.
- No MSP-side restriction; staff still see and manage every form.
- No new EE license gate; scoping is core.
- No audience snapshots in `service_request_definition_versions`.

## 8. Risks

- **Tag ids are tenant-scoped.** A tag deleted while in an audience leaves a
  clause that matches nobody for that source; the form stays visible to the
  other sources. UI warns when a referenced tag no longer exists.
- **Groups are client-owned.** A group from client A only ever admits client A's
  members, so it cannot grant a client B user; show the owning client next to
  every group. Deleting the group leaves a clause matching nobody.
- **Contacts without a group** match client, client-tag and contact scopes only.
  Reassigning a contact changes access immediately (intended).
- **Two models.** EE `advanced-visibility` remains; effective access is the
  intersection. On-behalf creation does not exist today; any future path must
  pass the target contact's subject or fail closed.
- **Draft vs published:** a draft scoped form stays invisible, and publishing
  must not copy the audience into versions.
- **Predicate drift:** the vocabulary allow-list, not the evaluator, is the
  security boundary. A path added to `AUDIENCE_PATHS` must come with a subject
  field and a test.

## 9. Test plan

Unit (`definitionAudience.unit.test.ts`): `validateAudienceFilter` accepts every
editor-emitted clause and rejects unknown paths, list-on-scalar, single-on-set,
empty root group; the decision returns true for `null`, false for an empty
subject with a client clause, true for a tag match on client and contact, true
for a group match, false for a missing contact, false (fail closed) for an
unparseable filter.

Integration (`serviceRequestAudienceScoping.integration.test.ts`, replacing the
withdrawn table-based file): everyone (regression); client audience
visible/detail/submit for A and invisible for B (no submission row for B);
client-tag audience admits a tagged client's contact and not another;
contact audience admits exactly that contact; contact-tag audience; group-only
audience admits a contact whose `portal_visibility_group_id` matches while a
contact with no group or a different group is refused; union of sources admits
both populations; foreign-tenant client/group/contact/tag ids rejected on save;
`advanced-visibility` + audience = AND; duplicate copies the filter; tenant
isolation. Extend `serviceRequestPortalCatalog.integration.test.ts:234`,
`serviceRequestPortalDetail.integration.test.ts:86,171`,
`serviceRequestDefinitionEditor.integration.test.ts`,
`serviceRequestAdvancedVisibility.integration.test.ts`.

Browser: as an MSP admin, build an audience from a client picker, from a client
tag, and from a group; then as a client user in and out of the audience confirm
catalog, detail and submit.

Verify with `npx tsc --noEmit` in `server`, the integration files above against
the test DB, `editor.i18n.test.tsx` / `npm run validate-translations`, then the
browser pass.

## 10. Corrections to the card

1. CE does not "ignore config"; `all-authenticated-client-users` accepts any
   config and returns `true`.
2. `client_portal_visibility_groups` are per-client groups of contacts, not
   tenant-wide client-user groups; a group belongs to exactly one client, but
   selecting a group does not select its client.
3. "Add service-request definitions to what visibility groups can scope" is the
   reverse relation and would change the group tables. The form referencing
   groups (now as a `contact.groups` clause) is smaller and correct.
4. Submit does not enforce visibility itself: `submissionService.ts:261` calls
   the detail function. Only catalog and detail need wiring.
5. `allowedRequesterUserIds` is a per-user id allow-list, not group membership;
   it stays with the EE provider.
6. No on-behalf MSP submission path exists today, so that risk is future-only.
