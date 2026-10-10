# Duplicate ticket — implementation plan

Driver: PSA ticket alga-2026-0002502 (Joymode Business Solutions). A technician writes one ticket properly, then needs the same ticket for several people, devices or locations. They should be able to start a new ticket from an existing one, change only what differs (title, contact), and save.

## Outcome

A **Duplicate** action on the ticket detail header and on each row of the ticket list. It opens the normal create-ticket modal (`QuickAddTicket` through the `/msp/create-ticket` route) prefilled from the source ticket. The technician edits and presses Create. Saving goes through `addTicket`, so the same `ticket:create` permission, validation, numbering, SLA start, events and checklist auto-apply all run. The new ticket records which ticket it came from and shows "Duplicated from #N" in its header. The source gets a matching activity entry.

The four-employee case: open the source → Duplicate → change "John Smith" in the title (and the contact, if it differs) → Create. The intercepted modal closes with `router.back()`, which returns to the source ticket, so the next Duplicate is one click away. That is four short loops with no rebuilding.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | **One copy per action.** No batch "N copies" in v1. | The existing modal already supports a fast loop because it returns to the source after Create. A batch flow needs a per-row editor for the person-specific fields, which is a new form, not the standard one. That is a follow-up (see Not doing). |
| D2 | **Prefill the existing form. Do not create the copy server-side and then let the user edit it.** | It meets the "same form, same validation" requirement. Cancelling leaves nothing behind. Nothing is created until the technician has changed the person-specific fields. |
| D3 | **The URL carries only `duplicateFrom=<ticketId>`. The form loads the source through a new server action.** | Description, checklist, tags and custom fields do not fit in a URL. The existing prefill params are for short scalars. |
| D4 | **The server copies the hidden carry-over (checklist and custom fields) from the source inside `addTicket`'s transaction. The client does not round-trip it.** | The copy set is defined in one place on the server and can be unit-tested. It is atomic with the create, so there is never a ticket without its checklist or provenance. It also avoids letting `addTicket` accept arbitrary client-supplied `attributes` JSON. The client sends only `duplicate_of_ticket_id` and `duplicate_copy_checklist`. |
| D5 | **Fields the technician can see and edit (client, contact, location, board, category, priority/ITIL, assignee, team, additional agents, description, tags, title) are prefilled in the form and submitted the normal way.** | They are editable, so they belong to the form's state. Team, additional agents and tags keep using the form's existing post-create calls (`assignTeamToTicket`, `addTicketResource`, `createTagsForEntity`). |
| D6 | **Provenance is a new nullable column, `tickets.duplicated_from_ticket_id uuid`, with no FK. It is create-only and not in `ticketUpdateSchema`.** Activity entries are also written on both tickets. | A real column lets the header link render from the ticket row and allows a future "show copies" query. There is no FK because deleting the source must not be blocked or cascade, and a composite `(tenant, ticket_id)` `ON DELETE SET NULL` would null `tenant` on Citus/PG < 15. If the source is later deleted, the left join returns null and the link is hidden. Activity details store the source number as the audit trail. |
| D7 | **Custom fields are an allowlist: copy only `attributes.custom_fields`.** | Ticket custom fields live in `tickets.attributes.custom_fields` (written by workflow actions, `shared/workflow/runtime/actions/businessOperations/tickets.ts:581,893`). Every other `attributes` key is system-owned and must not carry over: `description` (sent by the form), `watch_list` (email watchers), `sla_last_*_threshold_notified` (SLA timers), `source_reference` (RMM/Huntress), `teams_guest_intake`, legacy `tags`, `due_date`. A denylist would leak any system key added later. |
| D8 | **Checklist: copy every source item unchecked, keeping `item_name`, `description`, `is_required`, `assigned_to`, `order_number`, `source` and `template_id`.** Template items replace the auto-applied copy of the same template. | `TicketModel.createTicket` auto-applies matching templates (`shared/models/ticketModel.ts:974-986`) before the copy runs. If the source already carries template X, copying its items on top would duplicate X. The technician may have edited X's items on the source, so the source's version wins: delete the new ticket's rows for each `template_id` present on the source (rows inserted moments earlier in the same transaction, never completed), then insert the source items. Templates that newly match and are not on the source stay as auto-applied. Keeping `template_id` preserves the idempotency key, so a later board or category change does not re-apply X. |
| D9 | **Status is never copied.** The form's effect picks the board default (`getDefaultStatus`, `QuickAddTicket.tsx:114-125, 520-534`). | Required by the brief, and it is the form's existing behaviour once `statusId` is empty. |
| D10 | **Title is copied verbatim, with no "(Copy)" suffix.** | The technician edits the person's name in place, and a suffix would be one more thing to delete on every copy. The modal title ("Duplicate ticket #N") and the provenance pill make it clear this is a copy. |
| D11 | **Attachments and documents are not copied.** No opt-in in v1. | Attachments are usually ticket-specific evidence. Copying file-backed documents means new storage objects and new associations, and sharing associations is unsafe because deleting a document from one ticket can delete it for both. Inline description images still render for internal users (see Risks R2). |
| D12 | **Due date is not copied.** | It is not in the copy set, and a due date belongs to one piece of work. |
| D13 | **Additional agents are re-added with role `support`, as the form already does.** | Uses the existing form path. Source roles are almost always `support`. |
| D14 | **The UI does not hide the action by permission.** It is gated server-side like Delete. | No client-side permission hook exists in the tickets package, and the Delete button shows unconditionally. `addTicket` (`ticket:create`) and the source loader (`ticket:read` plus row-level authorization) enforce access, and the form shows their errors. |

### Copy set (authoritative)

| Field | Copied? | How |
|-------|---------|-----|
| title | yes (verbatim) | form state |
| client, contact, location | yes | form state. The client is **not** locked: the duplicate path does not use `prefilledClient`/`isPrefilledClient` |
| board | yes | form state |
| category / subcategory | yes | `selectedCategories = [subcategory_id ?? category_id]` |
| priority / ITIL impact & urgency | yes | `priorityId`, `itilImpact`, `itilUrgency` |
| assigned agent, assigned team | yes | `assignedTo`, `assignedTeamId` |
| additional agents | yes | `tempAdditionalAgents` from `ticket_resources` |
| description | yes (editable) | `descriptionContent` |
| tags | yes (editable) | `pendingTags` (`isNew: false`, `tag_id`, colours) |
| checklist items | yes, unchecked (opt-out checkbox) | server, inside `addTicket` |
| custom fields (`attributes.custom_fields`) | yes | server, inside `addTicket` |
| status | **no**: board default | form effect |
| ticket number, entered_at/by | **no**: new | model |
| comments, time entries, documents/attachments, asset associations, schedule entries | **no** | not touched |
| SLA state (`sla_*` columns and attributes), response_state | **no**: fresh | normal create path starts SLA |
| bundle membership (`master_ticket_id`) | **no** | not set by `addTicket` |
| email threading (`email_metadata`, `watch_list`), `source`, `ticket_origin` | **no** | `addTicket` sets `source: 'web_app'`, origin `INTERNAL` |
| due date, closed fields, billing profile | **no** | billing profile resolves to the client default as in any create |

## Changes, in order

### 1. Schema: provenance column

- New migration `server/migrations/<ts>_add_duplicated_from_ticket_id_to_tickets.cjs`. Create it with `cd server && npx knex migrate:make add_duplicated_from_ticket_id_to_tickets --knexfile knexfile.cjs --env migration`. Up: `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS duplicated_from_ticket_id uuid NULL` (guarded with `hasColumn`). Down: drop the column. No FK and no index (D6). Plain `knex.schema`/`knex.raw` only, so the `tenantDb.cjs` shim is not needed.
- `shared/models/ticketModel.ts`
  - `ticketSchema` (`:60-99`): add `duplicated_from_ticket_id: z.string().uuid().nullable().optional()`.
  - `ticketUpdateSchema` (`:104-113`): add `duplicated_from_ticket_id: true` to `.omit` so the field stays create-only.
  - `CreateTicketInput` (`:133-170`): add `duplicated_from_ticket_id?: string`.
  - `INPUT_DRIVEN_TICKET_COLUMNS` (`:403-427`): add `'duplicated_from_ticket_id'`.
  - `CREATE_TICKET_FIELD_HANDLING` (`:472-516`): `duplicated_from_ticket_id: { kind: 'column', column: 'duplicated_from_ticket_id', nullish: true }`. The mapped type turns a missing entry into a compile error.
- `packages/tickets/src/schemas/ticket.schema.ts` (`:32-80`): add the field to `ticketSchema` and omit it in `ticketUpdateSchema`, mirroring shared.
- `packages/types/src/interfaces/ticket.interfaces.ts` (`ITicket`, near `:64-75`): `duplicated_from_ticket_id?: string | null;` and the display-only `duplicated_from_ticket_number?: string | null;`.
- Activity events (`shared/lib/ticketActivity/types.ts:20-51`): add `DUPLICATED_FROM: 'TICKET_DUPLICATED_FROM'` (written on the copy) and `DUPLICATED_TO: 'TICKET_DUPLICATED_TO'` (written on the source). Event types are free-form strings, so no DB constraint applies.

### 2. Server: copy-set module (pure and DB helpers)

New file `packages/tickets/src/lib/ticketDuplicate.ts`. It is not `'use server'`, so nothing here becomes a client-callable action.

- `pickDuplicableAttributes(attributes: unknown): Record<string, unknown>` returns `{ custom_fields }` when the source has a non-empty `custom_fields` object, otherwise `{}`. Parse string JSON the same way the rest of the code handles `attributes`. This is the D7 allowlist in one place.
- `copyChecklistFromSource(trx, tenant, { sourceTicketId, targetTicketId, userId })` implements D8:
  1. Read source items ordered by `order_number`.
  2. Collect the distinct non-null `template_id`s, then delete target rows `where ticket_id = target and template_id in (...)`.
  3. Insert the source items with `completed: false`, `completed_by: null`, `completed_at: null`, `created_by: userId`. Keep `source`/`template_id`. `order_number` = the source order offset after any remaining target rows (newly matched templates first, then the source's checklist in its own order). Use the column set from `ticketChecklistActions.ts:108-121`.
  4. Return the number of items copied.

  Use `tenantDb(trx, tenant).table(...)`, the same pattern as `applyTemplates.ts`.
- `DUPLICATE_COPY_SET` / types: export `TicketDuplicateSource`, the shape returned to the form (step 3).

`// LEVERAGE:` note for the implementer: `tenantScopedTable` is redefined in nearly every tickets module (`ticketActions.ts:163`, `applyTemplates.ts:58`, `ticketChecklistActions.ts:50`, `applyChecklistTemplate.ts:16`). Do not add another copy here: use `tenantDb(trx, tenant).table(...)` directly, and leave a `pattern tenant-scoped-table-helper` marker at this new site.

### 3. Server: source loader for the form

In `packages/tickets/src/actions/ticketActions.ts`:

- **Extract a private `authorizeTicketRead(trx, tenant, user, ticketRow): Promise<boolean>`** from the inline kernel block in `getTicketById` (`:2322-2408`): subject, client visibility, kernel, `authorizeResource`, plus the client-user `client_id` check at `:2386-2390`. Switch `getTicketById` to it with identical behaviour. It reuses the file's existing private `resolveAuthorizationSubjectForUser` (`:195`), `resolveClientVisibility` (`:260`) and `toTicketAuthorizationRecord` (`:241`). Leave the marker `// LEVERAGE: pattern ticket-read-authorization — kernel construction duplicated with optimizedTicketActions.ts createTicketAuthorizationContext; extraction blocked by source-text contract tests pinning helpers in optimizedTicketActions.ts`. Cross-file extraction is out of scope (see Not doing).
- **New `export const getTicketDuplicateSource = withAuth(async (user, { tenant }, ticketId: string): Promise<TicketDuplicateSource | TicketActionError>)`**:
  - Reject non-internal users (`user.user_type !== 'internal'` → `permissionError`, the same guard as `updateTicket` at `:702`).
  - Require both `hasPermission(user, 'ticket', 'read')` and `hasPermission(user, 'ticket', 'create')`, so the modal fails fast instead of after the technician fills it in.
  - Load the ticket row joined to `clients` (`client_name`, `client_type`), `contacts` (`full_name`) and `boards` (`board_name`). Run `authorizeTicketRead`; deny with the same message as `getTicketById`.
  - Load `ticket_resources` (additional agents) joined to `users` for first and last names; tags via `TagMapping.getByEntity` (`packages/tags/src/models/tagMapping.ts:42`), which tickets already depends on; and checklist items (names, `is_required`, `order_number`) via the same select as `getTicketChecklistItems`.
  - Return `{ ticket_id, ticket_number, title, description (attributes.description string), client {id,name,type}, contact {id,name}|null, location_id, board_id, category_id, subcategory_id, priority_id, itil_impact, itil_urgency, assigned_to, assigned_team_id, additional_agents [{user_id, first_name, last_name}], tags [{tag_id, tag_text, background_color, text_color}], checklist [{item_name, is_required}], custom_field_count }`. Use `ticketActionErrorFrom` error handling like the neighbouring actions.

### 4. Server: `addTicket` duplicate path

`addTicket` (`ticketActions.ts:431-626`), inside the existing transaction:

- Read `duplicate_of_ticket_id` and `duplicate_copy_checklist` (`'false'` disables; default on) from the FormData.
- If a source id is present, do this **before** `createTicketWithRetry`:
  - Load the source row (tenant-scoped). If it is missing, throw `'Source ticket not found'` and map it through `ticketActionErrorFrom`.
  - Check `authorizeTicketRead`. If denied, throw `'Permission denied: Cannot view ticket'`. A user who cannot read a ticket cannot clone it.
  - Set `createTicketInput.duplicated_from_ticket_id = source.ticket_id` and `createTicketInput.attributes = pickDuplicableAttributes(source.attributes)`. `description` still merges into `attributes.description` in the model (`ticketModel.ts:928-932`).
- After the ticket is inserted, and after the creation activity at `:546-569`:
  - If checklist copying is on, run `copyChecklistFromSource(...)`.
  - Write `TICKET_DUPLICATED_FROM` on the new ticket: entity TICKET, actor USER, source UI, details `{ source_ticket_id, source_ticket_number, checklist_items_copied, custom_fields_copied }`.
  - Write `TICKET_DUPLICATED_TO` on the source: details `{ duplicate_ticket_id, duplicate_ticket_number }`.
  - Use the `TICKET_ACTIVITY_EVENT.*` constants, **not** string literals. `ticketActions.suppressionMirror.contract.test.ts` slices the file on `eventType: 'TICKET_`, and a new literal would cut its payload blocks short.
- Leave `ticket_origin: TICKET_ORIGINS.INTERNAL` exactly as written (`ticketOriginCreatePath.test.ts:38` pins that text).

### 5. Detail query: provenance number for the header

`getConsolidatedTicketData` (`optimizedTicketActions.ts:447-500`), which feeds the detail page: add a tenant left join `tickets as src` on `t.duplicated_from_ticket_id = src.ticket_id` and select `src.ticket_number as duplicated_from_ticket_number`. Add the same join and select to `getTicketById` (`ticketActions.ts:2350-2380`) so the drawer path matches. Use `tenantLeftJoin`/`tenantJoin` as the surrounding code does.

### 6. Route contract: `duplicateFrom`

- `packages/tickets/src/lib/createTicketRoute.ts`: add `duplicateFromTicketId?: string` to `CreateTicketPrefill`; `buildCreateTicketHref` sets `duplicateFrom`; `parseCreateTicketPrefill` reads it.
- `server/src/app/msp/_components/CreateTicketRouteClient.tsx` (`:69-90`): pass `duplicateFromTicketId={prefill.duplicateFromTicketId}` to `QuickAddTicket`. No other change is needed: `closeMode 'back'` already returns to the source after Create, and that return is the repeat loop.

### 7. Form: `QuickAddTicket` duplicate mode

`packages/tickets/src/components/QuickAddTicket.tsx`:

- Props (`:157-191`): add `duplicateFromTicketId?: string`.
- State: `duplicateSource: TicketDuplicateSource | null` and `copyChecklist: boolean` (default `true`).
- Open effect (`:341-400`): add `duplicateFromTicketId` to the deps. When it is set:
  1. Call `getTicketDuplicateSource(id)` alongside `getTicketFormData()` (no client argument, so the client stays editable).
  2. On an action error, keep it in its own `duplicateLoadError` state and render it in a destructive `Alert` above the form. The existing Alert only shows after a submit attempt (`:1131`), and this error has to be visible as soon as the modal opens.
  3. Otherwise apply the draft with a single `applyDuplicateSource(src)` helper: `setTitle`, `setDescriptionContent(parseTicketRichTextContent(src.description))` plus a bump of `descriptionEditorInstanceKey`, `setClientId`, `setSelectedClientType(src.client.type)`, `setContactId`, `setLocationId`, `setBoardId`, `setPriorityId`, `setItilImpact`/`setItilUrgency`, `setSelectedCategories([src.subcategory_id ?? src.category_id].filter(Boolean))`, `setAssignedTo`, `setAssignedTeamId`, `setTempAdditionalAgents(...)`, `setPendingTags(src.tags.map(t => ({ tag_id, tag_text, background_color, text_color, isNew: false })))`.

  Leave `isPrefilledClient` false so the `clientId` effect (`:434-477`) loads contacts and locations. Do **not** call `handleBoardChange`: it resets priority and category and applies board-default assignees (`:624-667`). Setting `boardId` directly lets the status effect (`:479-534`) pick the board default status and the categories effect (`:536-585`) load the picker without clearing the selection.
- `resetForm` (`:689-741`): leave it as is. Re-opening re-runs the effect, which re-applies the draft.
- `handleCreateTicket` (`:833-1009`): when `duplicateSource` is set, append `duplicate_of_ticket_id` and `duplicate_copy_checklist` (`String(copyChecklist)`) to the FormData. Nothing else changes: team, additional agents and tags already flow through the existing post-create calls.
- UI, using standard components only:
  - Dialog `title` (`:1121`): `duplicateSource ? t('quickAdd.duplicateDialogTitle', { defaultValue: 'Duplicate ticket #{{number}}', number }) : t('quickAdd.dialogTitle', 'Quick Add Ticket')`. Keep the existing `t('quickAdd.dialogTitle', 'Quick Add Ticket')` literal unchanged, because `QuickAddTicket.i18n.test.ts` pins it.
  - A provenance pill next to the asset pill (`:1144-1162`), same `Badge` pattern with the lucide `Copy` icon: "Duplicating #{{number}}", `data-testid="quick-add-ticket-duplicate-pill"`.
  - A checklist block before the tag picker (`:1589`), rendered only when `duplicateSource.checklist.length > 0`:
    - A label "Checklist from #{{number}}" with a compact read-only list of item names (required items marked).
    - A `Checkbox` (`@alga-psa/ui/components/Checkbox`), `id={`${id}-copy-checklist`}`, label "Copy checklist items (unchecked)", bound to `copyChecklist`.
    - When `custom_field_count > 0`, a muted line: "Custom field values are copied from #{{number}}."
- i18n: add the new `quickAdd.*` keys to `server/public/locales/en/features/tickets.json` (`"quickAdd"` at `:772`) and to the other locales per the repo convention. Then run `node scripts/validate-translations.cjs`.

### 8. Entry point: ticket detail header

`packages/tickets/src/components/ticket/TicketDetails.tsx`:

- Add `isAlgaDeskMode?: boolean` to `TicketDetailsProps` (`:164`) if it is not already reachable, and thread it from `MspTicketDetailsContainerClient` (`packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx`, which already receives it from `server/src/app/msp/tickets/[id]/page.tsx:240`) through `TicketDetailsContainer`.
- Header actions (`:3693-3729`): add an outline `Button` before Delete with `id={`${id}-duplicate-ticket-button`}`, `variant="outline"`, `size="sm"`, the `Copy` icon and `t('actions.duplicate', { defaultValue: 'Duplicate' })`. On click: `router.push(buildCreateTicketHref({ duplicateFromTicketId: ticket.ticket_id, isAlgaDeskMode }))`. From the drawer the same push works, because the create route intercepts over the list.
- Provenance link: next to `TicketOriginBadge` (`:3683-3689`), when `ticket.duplicated_from_ticket_id && ticket.duplicated_from_ticket_number`, render a small `Link` to `/msp/tickets/<id>` reading `t('details.duplicatedFrom', { defaultValue: 'Duplicated from #{{number}}', number })`.

### 9. Entry point: ticket list row menu

`packages/tickets/src/components/TicketingDashboard.tsx`: the list has no row menu today. Add a trailing actions column in the same `useMemo` (`return [selectionColumn, ...baseColumns, actionsColumn]` at `:1593`), following the DataTable action-menu standard (`docs/AI_coding_standards.md` "DataTable Action Menus"):

- `dataIndex: 'actions'`, `sortable: false`, a narrow width, and an empty `title` with an sr-only label.
- A `DropdownMenu` with a ghost `Button` trigger, `id={`ticket-actions-menu-${ticketId}`}`, `MoreVertical`, and `onClick={e => e.stopPropagation()}`. Also stop `onMouseDown` the way the selection column does, so the row click does not open the ticket.
- One item: `DropdownMenuItem id="duplicate-ticket-menu-item"` → `navigateAwayTo(buildCreateTicketHref({ duplicateFromTicketId: ticketId, isAlgaDeskMode: useAlgaDeskQuickAddForm }))`. Use `navigateAwayTo` (`:500`), not `router.push`, so the URL filter-sync race described there does not return.
- Add `navigateAwayTo` and `useAlgaDeskQuickAddForm` to the memo deps.

The column is added in the dashboard, not in `createTicketColumns`: that builder is shared with the column catalog and export ordering, and the selection column already sets the precedent.

### 10. Activity timeline rendering

`packages/tickets/src/components/ticket/TicketActivityTimeline.tsx`:

- `eventIcon` (`:122-162`): `TICKET_DUPLICATED_FROM` and `TICKET_DUPLICATED_TO` → `Copy`.
- `describeActivity` (`:190-245`):
  - `DUPLICATED_FROM` → "`{actor}` created this ticket as a duplicate of #N"
  - `DUPLICATED_TO` → "`{actor}` duplicated this ticket as #N"

  Follow the file's existing pattern: it builds English strings here, and other events in this function are not yet translated.

## Tests

Place new tests next to the existing ones of each kind.

**Unit (vitest, `packages/tickets`)**

1. `src/lib/ticketDuplicate.test.ts`, `pickDuplicableAttributes`:
   - copies `custom_fields`;
   - drops `description`, `watch_list`, `sla_last_response_threshold_notified`, `sla_last_resolution_threshold_notified`, `source_reference`, `teams_guest_intake`, `tags`, `due_date`;
   - handles a JSON string, null and an empty object.
2. `src/lib/createTicketRoute.test.ts` (new or extended): `duplicateFrom` round-trips through build and parse, and is absent when not set.
3. `src/components/__tests__/QuickAddTicket.duplicate.test.tsx`, using the mock harness from `ticket-inline-add-prefill.test.tsx`:
   - with `duplicateFromTicketId`, the form shows the source title, description, client (not locked; the picker stays enabled), contact, location, board, category, priority, assignee, additional agents and tags;
   - the status is the board's default, not the source status;
   - the due date is empty;
   - the dialog title and pill show #N;
   - the checklist block lists the items, and unchecking it sends `duplicate_copy_checklist=false`;
   - submit sends `duplicate_of_ticket_id`, and never sends `status_id` from the source;
   - a loader permission error is shown in the Alert and Create still validates normally.
4. Keep `QuickAddTicket.i18n.test.ts`, `ticketActions.suppressionMirror.contract.test.ts` and `ticketOriginCreatePath.test.ts` green, since all three read source text.

**Integration (real DB; `server/src/test/integration/ticketDuplicate.integration.test.ts`, built like `ticketActivityLog.integration.test.ts` and `server/src/test/infrastructure/tickets/ticketPermissions.test.ts` with `createAuthModuleMock`)**

5. Copy set: seed a source with category and subcategory, an ITIL or custom priority, an assignee and team, two additional agents, two tags, three checklist items (one completed, by user X), `attributes = { description, custom_fields: {...}, watch_list: [...], sla_last_response_threshold_notified: ..., source_reference: ... }`, `email_metadata`, a comment, a time entry, an attached document and a `master_ticket_id`. Call `addTicket` with the form's FormData plus `duplicate_of_ticket_id`. Assert:
   - the new ticket has a new number;
   - `duplicated_from_ticket_id` points to the source;
   - `attributes` has `custom_fields` and the new description, and **no** `watch_list`, `sla_*` or `source_reference`;
   - `email_metadata` is null and `master_ticket_id` is null;
   - `ticket_origin` is internal;
   - the three checklist items are copied with `completed = false`, null `completed_by`/`completed_at`, and the same order;
   - there are no comments, time entries or document associations on the copy;
   - `TICKET_DUPLICATED_FROM` exists on the copy and `TICKET_DUPLICATED_TO` exists on the source.
6. `duplicate_copy_checklist=false` copies no source items (auto-applied templates still apply).
7. Template interplay: an auto-apply rule matches the board and the source carries that template's items with one item renamed. The copy has exactly one set of that template's items, the source's version, with `template_id` kept. A second, newly matching template is still auto-applied.
8. Permissions:
   - a user without `ticket:create` is refused by `addTicket` and `getTicketDuplicateSource`;
   - a user with create but no row-level read on the source (board, client or bundle narrowing) is refused by both, with the "Cannot view ticket" message, and no ticket is created (transaction rolled back);
   - a client-portal user is refused by `getTicketDuplicateSource`;
   - a missing or other-tenant source id returns "Source ticket not found".
9. `updateTicket` cannot change `duplicated_from_ticket_id` (the schema omits it).
10. Migration: the column exists and is nullable; down removes it.

**Manual smoke (dev server on 3800)**: the four-employee loop from the detail page; Duplicate from the list row menu without opening the ticket; the "Duplicated from #N" link navigates; Cancel creates nothing; AlgaDesk product mode opens the AlgaDesk form variant.

## Not doing (follow-ups)

- **Batch duplicate ("one per selected contact" or "N copies")**: a multi-select of contacts plus a title token (for example `{{contact}}`) that creates N tickets in one action. This needs a per-copy review surface and partial-failure reporting, and it is the natural next step for the 10–20 user case.
- **Copying attachments and documents, or re-homing inline description images** (D11, R2).
- **"Duplicate again" button in the modal**, or keeping the modal open with the same draft after Create. Not needed because the modal returns to the source.
- **Row menus on the client and contact ticket tabs** (`MspClientTickets`, `MspContactTickets`). They use their own tables; add the same item there once the list version has shipped.
- **Reverse lookup ("copies of this ticket" panel)** and an index on `duplicated_from_ticket_id`.
- **Bulk-bar "Duplicate"** for selected tickets.
- **Copying due date, asset associations, billing profile overrides, watch list**: excluded on purpose.
- **Extracting ticket read authorization into one shared module.** Left as a LEVERAGE marker because the source-text contract tests in `optimizedTicketActions.tenantScopedAuth.contract.test.ts` pin the helpers in place.
- **Client portal or API duplicate endpoint.** MSP UI only.

## Risks

- **R1: state cascade in `QuickAddTicket`.** The form's effects reset or derive state when board, client or category change. Setting all state directly (never through `handleBoardChange`/`handleClientChange`) is what keeps the copied priority, category and assignee. The duplicate test (#3) must assert each of them *after* the board's status, category and client contact/location fetches resolve.
- **R2: inline description images.** The copied description still points at the source ticket's documents. Internal users who can read the source see them. A client-portal contact on the copy who cannot see the source may get broken images (the view route authorizes by document association). Accepted for v1 and listed as a follow-up.
- **R3: checklist and template replacement** runs in the same transaction as the auto-apply, so there is no window in which a completed item could be deleted. Test #7 locks this behaviour in. The auto-apply still writes a `CHECKLIST_TEMPLATE_APPLIED` activity row for a template whose items were then replaced by the source's. That row is accurate (the template matched) and harmless.
- **R4: partial post-create failures.** Team, additional agents and tags remain non-atomic client follow-ups, the same as any quick-add today; failures are already toasted. Checklist, custom fields and provenance are atomic with the create.
- **R5: source deleted between opening and saving.** `addTicket` returns "Source ticket not found" and the technician can retry. This is an acceptable edge case.
- **R6: source-text contract tests** (`QuickAddTicket.i18n.test.ts`, `ticketActions.suppressionMirror.contract.test.ts`, `ticketOriginCreatePath.test.ts`, `optimizedTicketActions.tenantScopedAuth.contract.test.ts`) will fail on careless edits. Keep their pinned strings verbatim and use event constants rather than literals.
- **R7: Citus.** `ADD COLUMN` on the distributed `tickets` table propagates. There is no FK and the join is tenant-scoped, so there is no colocation concern.
