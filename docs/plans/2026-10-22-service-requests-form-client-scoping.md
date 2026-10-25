# Service requests: restrict forms to specific clients and client users

Card `1c48ad98-7a36-49bd-b871-37f466cb9740` (PBNJ Consulting feedback). PSA ticket `alga-2026-0002816`.
Worktree: `~/alga-copies/feature-service-requests-restrict-forms-to-specific-clie`.

Revision 2 (2026-10-25). Revision 1 stored the audience in two link tables (`service_request_audience_clients`,
`service_request_audience_client_groups`) and shipped as draft PR #3854. That design is replaced: the audience is
a predicate on the shared model from `@alga-psa/predicates` (card `9798abc3`, PR #3858). This card is stacked on
`9798abc3` and starts implementation from `main` after #3858 merges. Decisions D1–D9 were approved by the captain
on 2026-10-25.

## 1. Outcome

An admin can make a service-request form visible to everyone, or to any combination of:

- specific clients (all their portal users),
- specific clients, limited to some of their client portal visibility groups,
- specific contacts,
- contacts with a given tag,
- clients with a given tag,

each optionally narrowed to "only contacts tagged …". The admin picks entities with pickers, never types ids, and
sees how many contacts the audience currently reaches. The client portal catalog, the form detail page and
submission all respect it. It works the same in CE and EE.

## 2. The audience is a predicate over the requester

### 2.1 Requester record and paths

A requester is described by one record. These paths are the audience vocabulary. They are persisted inside stored
audiences from the first save, so they are contracts: a rename needs a migration that rewrites stored audiences,
and a path is never reused with a different meaning.

| Path | Kind | Source |
| --- | --- | --- |
| `client.id` | scalar uuid | `clients.client_id` of the requester's client |
| `client.tags` | set of tag definition ids | `tag_mappings` with `tagged_type = 'client'` |
| `contact.id` | scalar uuid | `contacts.contact_name_id` |
| `contact.tags` | set of tag definition ids | `tag_mappings` with `tagged_type = 'contact'` |
| `contact.group.id` | scalar uuid | `contacts.portal_visibility_group_id` |
| `user.id` | scalar uuid | the client-portal user (`users.user_id`) |

Tag values are tag definition ids (`tag_mappings.tag_id`), the same identity #3858 uses for ticket filters.

### 2.2 Storage

`service_request_definitions.audience jsonb NOT NULL DEFAULT '{"join":"and","clauses":[]}'`.

- The value is a `PredicateGroup`, validated with `predicateGroupSchema` from `@alga-psa/predicates` plus the
  audience query schema (§2.4), so unknown paths and operators are rejected on write.
- **Everyone** is the empty `and` group, which the predicate semantics define as true. It is the default and the
  value every existing definition gets.
- **Selected** is an `or` group of entries. An empty `or` group is false, so a scoped form with no entries is
  visible to nobody (fails closed) without a separate mode column.
- Revision 1's migration `server/migrations/20261022090000_add_service_request_audience_scoping.cjs` never
  shipped. Replace it in place with a migration that adds `audience`. Dev databases that ran revision 1 must
  drop `service_request_audience_clients`, `service_request_audience_client_groups` and
  `service_request_definitions.audience_mode` by hand (record this as a card fact). Remove the revision 1 entries
  from `packages/db/src/lib/tenantTableMetadata.ts`, `server/migrations/utils/tenantDb.cjs` and
  `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts`.

The audience is a live access policy on the definition. It is not copied into
`service_request_definition_versions` by `definitionPublishing.ts`; tightening it takes effect immediately.

### 2.3 Shape the editor writes

The model allows arbitrary nesting. The editor writes exactly one shape, and the save action rejects anything
else with a clear error:

```
Everyone:  { join: 'and', clauses: [] }
Selected:  { join: 'or', clauses: [ <entry>, ... ] }
<entry>:   <base clause>
         | { join: 'and', clauses: [ <base clause>, { path: 'contact.tags', operator: 'in', value: [<tag ids>] } ] }
<base clause>:
           { path: 'client.id',        operator: 'in', value: [<client id>] }
         | { path: 'contact.group.id', operator: 'in', value: [<group ids of one client>] }
         | { path: 'contact.id',       operator: 'in', value: [<contact ids>] }
         | { path: 'contact.tags',     operator: 'in', value: [<tag ids>] }
         | { path: 'client.tags',      operator: 'in', value: [<tag ids>] }
         | { path: 'user.id',          operator: 'in', value: [<user ids>] }   (written only by the §5 migration)
```

`client.id` entries hold one client each, so the editor can render one row per client. A client limited to groups
is stored as a `contact.group.id` entry only, with no `client.id` entry (groups are owned by exactly one client,
so this cannot admit another client's users). The editor rebuilds the per-client row from the groups' owning
client. The save action rejects a client selected together with one of its own groups ("choose either all users
or specific groups"). A client plus another client's group is allowed.

### 2.4 Audience query schema

`server/src/lib/service-requests/audienceSchema.ts` declares one `QuerySchema` for the paths in §2.1. It is used
for validation (`validatePredicate`) and for the reach count (§4.3). Root table `contacts`:

- relation `contact` (one, `contacts`, `contact_name_id` → `contact_name_id`): attributes `id`
  (column `contact_name_id`, uuid, operators `in`/`not_in`), `tags` (`tagSet({ taggedType: 'contact', local:
  'contact_name_id' })`); relation `group` (one, `client_portal_visibility_groups`, `portal_visibility_group_id`
  → `group_id`) with attribute `id`.
- relation `client` (one, `clients`, `client_id` → `client_id`): attributes `id`, `tags`
  (`tagSet({ taggedType: 'client', local: 'client_id' })`).
- relation `user` (many, `users`, `contact_name_id` → `contact_id`, where `user_type = 'client'`): attribute `id`.

The compiler correlates every hop on `tenant`. No computed attributes; this schema has no raw SQL.

## 3. Enforcement

Single authority in `server/src/lib/service-requests/definitionAudience.ts`:

```
loadRequesterRecord(db, tenant, { requesterUserId, clientId, contactId })  // once per request
isAudienceSatisfied(audience: PredicateGroup, requester: RequesterRecord): boolean  // evaluatePredicate
```

- `loadRequesterRecord` returns `{ client: { id, tags }, contact: { id, tags, group: { id } }, user: { id } }`.
  Tags are read straight from `tag_mappings` with `tenantDb`. They are **all** of the entity's tags, not the
  display-rule-filtered set: display rules decide what a badge shows, never who can see a form. Do not call
  `findTagsByEntityIds` (it requires `tag:read`, which client users do not hold). A requester with no contact gets
  `contact: null`, so contact paths are missing and never match.
- `isAudienceSatisfied` calls `evaluatePredicate` from `@alga-psa/predicates`. A stored value that fails
  `predicateGroupSchema` is treated as false (fail closed) and logged.
- `portalCatalog.ts`: select `audience` with the definition rows, load the requester record once before the loop,
  and keep a definition only if the visibility provider allows it **and** the audience is satisfied.
- `portalDetail.ts`: same check for one definition; `null` stays the "not visible" result.
- `submissionService.ts` does not change. It already goes through
  `getVisiblePublishedServiceRequestDefinitionDetail` and throws `Service request is not visible or not
  published`; a second check would duplicate the authority.
- The client-portal actions already pass `clientId` and `contact_id`; only tests prove propagation.

## 4. Editor

### 4.1 Audience editor

`server/src/app/msp/service-requests/ServiceRequestAudienceEditor.tsx` (rework of revision 1), rendered in the
execution card of `ServiceRequestDefinitionEditorPage.tsx` for every definition:

- **Everyone** (default) or **Selected clients and client users**.
- Selected: a list of entries, each added with the matching picker:
  - client: `ClientPicker` with `searchClientsForPicker`; each client row offers "All users of {client}" or
    "Only members of selected groups" (groups from `getClientPortalVisibilityGroups`, shown with the client name);
  - contact: `ContactPicker`;
  - contact tag / client tag: the existing tag selector (`TagFilter` from `@alga-psa/ui/components/tags`, the one
    #3858's `WhereTagFilter` uses) over contact-type / client-type tag definitions.
- Any entry can add "only contacts tagged …" (the `and` form in §2.3).
- Clients and contacts render with `EntityChip` (#3858), including their displayed tags. Tags render with their
  tag colors. No raw ids anywhere.
- Saving with Selected and no entries is allowed but shows a warning that nobody will see the form.
- Strings under `editor.execution.visibility.audience.*` in every locale file
  (`server/public/locales/{en,de,es,fr,it,nl,pl,pt,sv,xx,yy}/msp/service-requests.json`).

### 4.2 Save

`updateServiceRequestAudienceAction(definitionId, audience)` in `server/src/app/msp/service-requests/actions.ts`,
backed by `saveServiceRequestDefinitionAudience` in `definitionManagement.ts`:

- requires `service-request:update`;
- validates the group with `predicateGroupSchema`, `validatePredicate(audienceSchema, …)` and the §2.3 shape;
- checks every referenced client, contact, group, tag definition (of the right `tagged_type`) and user exists in
  the tenant; foreign-tenant or missing ids are rejected;
- rejects a client selected together with one of its own groups;
- writes `audience` and calls `revalidatePath('/client-portal/request-services')`.

"Save all" on the editor page includes the audience. `definitionManagement.ts` copies `audience` when a definition
is duplicated.

### 4.3 Reach count

The editor shows "Visible to N contacts at M clients" for the current (unsaved) audience, refreshed on change.
`getServiceRequestAudienceReachAction(audience)` compiles the audience with `compilePredicate(knex,
audienceSchema, audience, { rootAlias: 'c' })` over `contacts c` in the tenant, restricted to contacts that have
an active client-portal user, and returns `count(*)` and `count(distinct client_id)`. Everyone shows "All client
portal users". Requires `service-request:read`. The count reflects the current data; it is not a guarantee about
contacts added later.

### 4.4 Deleted references

An id that no longer exists matches nobody, so a stale audience fails closed. Publish validation
(`definitionValidation.ts`) rejects an audience that references missing clients, contacts, groups, tags or users.
When the editor loads an audience with missing references it drops them from the working copy and lists what it
dropped; saving persists the cleaned audience.

### 4.5 Tags referenced by audiences must not be cleaned up

#3858's orphan cleanup (`TagDefinition.deleteOrphaned` in `packages/tags/src/models/tagDefinition.ts`,
`packages/tags/src/lib/tagCleanup.ts`, `server/src/lib/utils/tagCleanup.ts`, the `deleteTag` orphan branch) deletes
tag definitions with no mappings, sparing only those a display rule references. A tag used by an audience but not
yet applied to anyone would be deleted, silently emptying that entry.

The fix is a general tag-reference mechanism, built in #3858 by captain's order (note `e4e9dde5` on card
`9798abc3`, 2026-10-25): a `tag_references (tenant, tag_id, referrer_type, referrer_id)` table in `packages/tags`,
co-located with `tag_definitions`, maintained by referrers through `replaceTagReferences` /
`deleteTagReferences` in the same transaction as their own write. Orphan cleanup and the tag option loaders check
only that table; display rules are its first referrer.

This card is its second referrer:

- `saveServiceRequestDefinitionAudience` calls `replaceTagReferences(trx, tenant, 'service_request_audience',
  definitionId, <every tag id in contact.tags / client.tags clauses>)` in the save transaction.
- The §5 advanced-visibility migration writes no tag references (those configs hold no tags).
- Deleting a definition calls `deleteTagReferences(trx, tenant, 'service_request_audience', definitionId)`;
  duplicating one writes references for the copy.
- An integration test proves an audience-only tag survives every cleanup path, and that saving an audience
  without the tag drops its reference.

If #3858 merges without the mechanism, stop and raise it with the captain rather than building a local workaround.

Deleting a tag explicitly is still allowed. The audience entry then holds a missing id, handled by §4.4.

## 5. Retire the EE `advanced-visibility` provider

Captain decision (D6): one visibility authority.

- A migration converts every definition whose `visibility_provider = 'advanced-visibility'`. It reads the config
  the portal enforces today, from the latest **published** version (the draft's config if nothing is published),
  and ANDs it into the definition's `audience`:
  - `allowAll: false` → `{ join: 'or', clauses: [] }` (nobody);
  - `allowedClientIds` (non-empty) → `{ path: 'client.id', operator: 'in', value: [...] }`;
  - `allowedRequesterUserIds` (non-empty) → `{ path: 'user.id', operator: 'in', value: [...] }`;
  - both lists → `{ join: 'and', clauses: [<client clause>, <user clause>] }` (the provider required both).
  Then it sets `visibility_provider = 'all-authenticated-client-users'` and `visibility_config = {}` on the
  definition and every version.
- If the converted audience is not in the §2.3 shape the editor writes, the editor shows it read-only with a
  "Replace with a new audience" action rather than mis-rendering it. The save action accepts the converted shape
  on unchanged round-trip.
- Remove `advancedVisibilityProvider` from `ee/server/src/lib/service-requests/providers.ts` (`:412-480`, and its
  registration at `:599`), the JSON textarea and its "Save all" parse in `ServiceRequestDefinitionEditorPage.tsx`
  (`:1170`, `:1881`), and the provider option from the selector. The visibility provider registry stays; it now
  has the built-in provider only.
- Behavior change for release notes: the provider's config was copied into each published version; the audience
  is live. A draft whose advanced-visibility config differed from its published version follows the published
  config after migration.

## 6. CE and EE

Audience scoping is core in CE and EE. No license gate.

## 7. Visibility groups

Groups are a requester attribute (`contact.group.id`), not a list of forms on the group. Adding service-request
definitions to what a group scopes would put form access in two places that can disagree. No change to
`client_portal_visibility_groups` or `visibilityGroupActions`.

## 8. Order of work

1. Start from `main` after #3858 merges. Keep revision 1's editor, call sites and tests as the starting point.
2. Migration (§2.2), `audienceSchema.ts`, revision 1 metadata cleanup.
3. `definitionAudience.ts` (§3) with unit tests; wire catalog and detail.
4. Save action, validation, duplicate copy, reach count action (§4.2–4.4).
5. Audience tag references through #3858's `tag_references` API (§4.5).
6. Advanced-visibility migration and removal (§5).
7. Audience editor and page wiring; locale keys.
8. Typecheck, service-request suites, predicates suites, i18n validation, browser pass.

## 9. Tests

- **Conformance.** Requester paths add no new path kind (scalar uuid, set of uuids, relation hop). If anything
  needs a kind the table lacks, add rows to `packages/predicates/spec/conformance.json` first.
- **Unit** (`definitionAudience.unit.test.ts`): every §2.3 entry kind, the `and` narrowing, empty `and` = everyone,
  empty `or` = nobody, missing contact, invalid stored value fails closed.
- **Integration** (`serviceRequestAudienceScoping.integration.test.ts`, rewritten): for each entry kind, the admitted
  requester sees the form in the catalog, opens detail and submits; a non-admitted requester gets none of the
  three and no submission row. Also: group-only entry with no client entry; client plus another client's group;
  client with its own group rejected; foreign-tenant ids rejected for every kind; missing references rejected at
  publish; display rules do not affect access (tag with no display rule still admits); audience not snapshotted
  by publish; duplicate copies the audience; reach count matches the admitted set.
- **Tag references:** an audience-only tag survives every cleanup path; explicit delete still works and leaves the
  form failing closed.
- **Advanced-visibility migration:** each config shape converts to the specified audience and the same requesters
  see the form before and after; published-vs-draft divergence follows published.
- **Existing suites:** `serviceRequestPortalCatalog`, `serviceRequestPortalDetail`, `serviceRequestDefinitionEditor`
  integration tests; `ServiceRequestAudienceEditor.test.tsx` rewritten for the new editor; `editor.i18n.test.tsx`
  and `npm run validate-translations`. `serviceRequestAdvancedVisibility.integration.test.ts` becomes the
  migration test.

## 10. Risks

- **Persisted vocabulary.** The §2.1 paths and the §2.3 shape outlive this code. Changes go through a migration.
- **Tenant leakage.** Every loader uses `tenantDb`; the compiler correlates every hop on `tenant`; the save
  action rejects foreign-tenant ids. Cross-tenant tests are required for every entry kind.
- **Tag cleanup** (§4.5) is the one way an audience can change without an admin editing it; the reference
  mechanism and its test close it.
- **Group or client deletion** leaves a missing id, so the form fails closed rather than opening up. The editor
  warns on load.
- **On-behalf creation.** No MSP path creates a request for a client today. Any future one must build the target
  requester's record or fail closed.
