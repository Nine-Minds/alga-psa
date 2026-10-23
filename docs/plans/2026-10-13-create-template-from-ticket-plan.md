# Create template from ticket — implementation plan

Driver: PSA ticket alga-2026-0002502 (Joymode Business Solutions), phase 2. Phase 1 (Duplicate ticket, PR #3608, `docs/plans/2026-10-02-duplicate-ticket-plan.md`) shipped. Sometimes a technician finishes a ticket and realises the work will come up again. Today they leave the ticket, open template admin and type in what the ticket already holds. After this change, an admin opens **More → Create template from ticket**. The template editor opens prefilled from the ticket. The admin removes anything specific to that one ticket, names the template (for example "Microsoft 365 Employee Department Change") and saves it. Anyone who can create tickets can then start a new ticket from that template.

## The design question: what is a template?

| Option | Verdict |
|--------|---------|
| (a) Checklist template prefilled from the ticket's checklist | **Rejected.** A checklist template holds checklist items and board/category match rules. It has nowhere to keep a subject, description, priority, tags or custom fields, which make up most of what he asked for. Its auto-apply behaviour (`TicketModel.createTicket` applies every matching template) is also the wrong model: he wants to *choose* "Department Change", not have it attached to every ticket on that board and category. |
| (c) Recurring ticket definition | **Rejected.** A definition is a template plus a schedule plus a list of target clients (`recurring_ticket_definitions` requires `recurrence`/`start_date`, and generation runs per `recurring_ticket_definition_clients`). Repeatable on demand is not the same as recurring on a schedule. Storing his template as a definition with no clients and a dummy schedule would bend the request to fit an existing table. |
| (b) **New first-class `ticket_templates` entity**: fields + description + checklist + tags + custom fields. Quick Add can start from one. | **Chosen.** It is the layer he describes, and it also gives technicians "New ticket from template", the last step in his unique → duplicated → repeatable → template progression. It reuses the Duplicate machinery already in place: the source loader, server-side copy of the hidden carry-over inside `addTicket`, the checklist template-replacement rule and the provenance column. Recurring definitions can later point at a ticket template instead of carrying their own copy of the fields (see Not doing). |

## Outcome

1. **Ticket templates admin**: a new nav item, Tickets → Ticket Templates (`/msp/tickets/templates`), that mirrors Recurring Tickets. It has a list page and an editor page (`/msp/tickets/templates/new`, `/msp/tickets/templates/<id>`).
2. **Create template from ticket**: a **More** (`⋯`) dropdown in the ticket detail header holds "Create template from ticket", and the ticket-list row menu gets the same item. Both go to `/msp/tickets/templates/new?fromTicket=<ticketId>`. The editor loads the ticket and prefills name (= ticket title), title, description, board, category/subcategory, priority (ITIL impact/urgency), tags, checklist items (as a definition, with no completion state) and custom field values. Nothing is saved until the admin presses Save.
3. **New ticket from template**: Quick Add gets a "Template" picker at the top of the form. Choosing a template applies its fields to the draft. The templates list also has a "New ticket" row action that opens `/msp/create-ticket?template=<id>`. On Create, the server copies the template's checklist (unchecked) and custom fields inside `addTicket`'s transaction, the same way Duplicate does. The ticket records `created_from_template_id`, and its header shows "From template: <name>".
4. **Permissions**: a new `ticket_template` resource (read/create/update/delete). Managing templates, including Create template from ticket, is **Admin-only by default**. Using templates (read) is granted to every MSP role that can create tickets. Duplicate is unchanged and stays on `ticket:create`.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | **Template content = name, optional description-of-template (internal note), title, description, board, category, subcategory, priority, ITIL impact/urgency, tags, checklist items, custom fields.** Status, client, contact, location, assignee, team, additional agents, due date and attachments are **not** part of a template. | That is his list, plus ITIL impact/urgency, which an ITIL board needs to resolve a priority. Client, contact and location are always specific to one ticket. Assignment is a per-job choice, and board default assignment already applies on create. Status always starts at the board default (same as Duplicate D9). Attachments: same reasoning as Duplicate D11. |
| D2 | **The template owns its checklist items** (`ticket_template_checklist_items`). It does not reference a `checklist_templates` row. | The source ticket's checklist is usually hand-edited, and that edited version is what he wants to keep. Referencing a checklist template would mean creating a hidden checklist template per ticket template, and that template would then show up in the checklist-template admin and could auto-apply. Each item keeps an optional `checklist_template_id` (taken from the ticket item's `template_id`) so the Duplicate D8 replacement rule still works: when a ticket is created from the template, the template's version of checklist template X replaces the auto-applied copy of X instead of doubling it. |
| D3 | **Same create path as Duplicate:** the client sends only `ticket_template_id` + `template_copy_checklist`, and the server copies the checklist and custom fields inside `addTicket`'s transaction. | The copy set is defined once on the server, it is atomic with the create, and `addTicket` still never accepts client-supplied `attributes` JSON (Duplicate D4). The visible fields (title, description, board, category, priority, tags) are prefilled into the form and submitted the normal way, so the technician can edit them. |
| D4 | **Generalise the checklist copier instead of writing a second one.** `copyChecklistFromSource` (`packages/tickets/src/lib/ticketDuplicate.ts:96-178`) becomes `insertChecklistItemsReplacingTemplates(trx, tenant, { targetTicketId, items, userId })`, with two loaders: source-ticket items and ticket-template items. | There are now two callers of the same "delete auto-applied rows for templates the source carries, then append items unchecked" rule. One implementation keeps the D8 behaviour identical for both. |
| D5 | **Provenance: a new nullable `tickets.created_from_template_id uuid` with no FK, create-only.** Activity event `TICKET_CREATED_FROM_TEMPLATE` (details: template id + name snapshot + counts). | Same reasoning as Duplicate D6 (`duplicated_from_ticket_id`): no FK so that deleting a template does not block or cascade. The column also gives a future "tickets using this template" count. The name snapshot in the activity row survives template deletion. `ticket_checklist_items.source` keeps its existing values (`manual`/`template`): items carrying a `checklist_template_id` stay `template`, the rest are `manual`. The ticket-level column records where they came from, so the `ticket_checklist_items_source_check` constraint on the distributed table does not need to change. |
| D6 | **Templates are not client-specific in v1.** All templates are tenant-wide. | He did not ask for client-scoped templates, and his example ("Microsoft 365 Employee Department Change") is a cross-client process. Client scoping is a follow-up. |
| D7 | **Custom fields: copy `attributes.custom_fields` with the existing allowlist (`pickDuplicableAttributes`).** The editor lists each key/value and allows removing a key and editing scalar values (string/number/boolean). Object and array values are shown read-only and can be removed. | There is no custom-field *definition* system. Ticket custom fields are free-form JSON written by workflows (Duplicate D7), so the editor cannot render typed inputs. "Relevant custom fields" in his request means the admin removes the ones that do not apply. |
| D8 | **Tags are stored as tag text (`jsonb` string array)**, like `recurring_ticket_definitions.tags`. On load into the form they resolve to existing ticket tag definitions by text. Unknown text becomes a new pending tag (`isNew: true`). | A tag-id reference breaks when a tag definition is deleted or merged. Text matches recurring definitions and the create path (`createTagsForEntity` creates missing definitions). |
| D9 | **Description is stored as `text` in the same format as `tickets.attributes.description`** (serialized BlockNote JSON or legacy plain text) and edited with the same editor and `parseTicketRichTextContent`. | No conversion either way: ticket → template → form round-trips byte-for-byte. Recurring stores parsed `jsonb`, but that is a different contract. Not unified here (see the LEVERAGE note in step 5). |
| D10 | **References (board, category, subcategory, priority) are validated on save and again when a template is applied.** No FKs. | Same policy as recurring definitions (`create_recurring_tickets.cjs` header). Deleting a board must not be blocked by a template. A dangling reference shows up as an editor warning ("Board no longer exists") and the form leaves that field empty, so the user is never handed a broken draft. |
| D11 | **Permission resource `ticket_template`.** Default grants: `read` → PSA msp:Admin, Dispatcher, Manager, Project Manager, Technician; AlgaDesk msp:Admin, Agent (the same holders as `ticket:create`). `create`/`update`/`delete` → msp:Admin only (PSA and AlgaDesk). Create template from ticket requires `ticket_template:create` **and** `ticket:read` plus row-level read of the source (`loadAuthorizedDuplicateSourceRow`). Creating a ticket from a template requires `ticket:create` + `ticket_template:read`. | He asked for template creation to be gated to an admin/configuration role, separate from Duplicate. A dedicated resource lets a tenant grant template management to a "Service Desk Lead" custom role without also granting all of `ticket_settings`. Reusing `ticket_settings:update` would tie templates to unrelated board and SLA configuration. |
| D12 | **UI gating via `checkCurrentUserPermissions`**, the pattern used by `useRecurringTicketPermissions`. The More menu item, the row-menu item, the nav entry and the Quick Add template picker are hidden when the user lacks the permission. The server actions remain the authoritative check. | Unlike Duplicate D14 (which stayed visible, matching Delete), he explicitly wants this action hidden from non-admins, and a precedent hook now exists. |
| D13 | **Template-picker application in Quick Add sets state directly, without `handleBoardChange`**, the same way `applyDuplicateSource` does (`QuickAddTicket.tsx:736-770`). If the draft is dirty, picking a template asks for confirmation first. Template and duplicate modes are mutually exclusive: the picker is hidden in duplicate mode, and `addTicket` rejects a request that carries both ids. | Same state-cascade hazard as Duplicate R1. The client and contact the technician already picked are kept, because a template never sets them. |

### Copy sets (authoritative)

**Ticket → template (Create template from ticket)**

| Ticket field | Template field |
|---|---|
| title | `name` (initial value, admin renames it) and `title` |
| `attributes.description` | `description` (verbatim) |
| board_id, category_id, subcategory_id, priority_id, itil_impact, itil_urgency | same columns |
| tags (TagMapping) | `tags` (text array) |
| `ticket_checklist_items` (name, description, is_required, order, template_id) | `ticket_template_checklist_items` (template_id → `checklist_template_id`). Completion state and assignee **dropped** |
| `attributes.custom_fields` | `custom_fields` (allowlist) |
| client, contact, location, status, assignee, team, agents, due date, comments, time, documents, SLA | **not copied** |

**Template → ticket (create from template)**: title, description, board, category, priority, ITIL and tags are prefilled into the form and editable. Checklist (unchecked, opt-out checkbox) and custom fields are copied on the server. Status = board default.

## Changes, in order

### 1. Schema

New migration `server/migrations/<ts>_create_ticket_templates.cjs` (generate with `cd server && npx knex migrate:make create_ticket_templates --knexfile knexfile.cjs --env migration`). Follow `20261002110000_create_recurring_tickets.cjs`: guarded `createTable`, `ensureTenantDistribution` before FKs, tenant-composite FKs, guarded constraints.

- `ticket_templates`: `tenant uuid`, `template_id uuid default gen_random_uuid()`, `name text not null`, `notes text null` (the admin's note about the template, not shown on tickets), `title text not null`, `description text null`, `board_id uuid null`, `category_id uuid null`, `subcategory_id uuid null`, `priority_id uuid null`, `itil_impact int null`, `itil_urgency int null`, `tags jsonb not null default '[]'`, `custom_fields jsonb not null default '{}'`, `is_active boolean not null default true`, `source_ticket_id uuid null` (where it was created from; informational, no FK), `created_by/updated_by uuid null`, `created_at/updated_at timestamptz`. PK `(tenant, template_id)`. Unique `(tenant, lower(name))` index on active templates, so two templates cannot share a name in the picker. Check constraints: ITIL values 1–5 or null; `subcategory_id IS NULL OR category_id IS NOT NULL`.
- `ticket_template_checklist_items`: `tenant`, `template_item_id`, `template_id`, `item_name text not null`, `description text null`, `is_required boolean not null default true`, `order_number int not null default 0`, `checklist_template_id uuid null` (no FK), timestamps. PK `(tenant, template_item_id)`, index `(tenant, template_id)`, FK `(tenant, template_id) → ticket_templates ON DELETE CASCADE`.
- `tickets.created_from_template_id uuid null`: `hasColumn`-guarded `ADD COLUMN`, no FK, no index (Duplicate D6/R7 reasoning).
- Register both tables in `packages/db/src/lib/tenantTableMetadata.ts` (next to `recurring_ticket_*` at `:74-77`) and `server/migrations/utils/tenantDb.cjs` (`:67-70`).
- **Citus**: the unique name index includes `tenant` (the distribution column), so it is allowed. Read the `citus-migration-gotchas` skill before writing it.

### 2. Permissions

- `server/migrations/utils/permissions/catalog.cjs`: four `ticket_template` entries next to `ticket_settings` (`:300-303`) with the D11 grants, `msp: true, client: false, products: ['algadesk','psa']`.
- New migration `<ts>_add_ticket_template_permissions.cjs`: a copy of `20261002120000_add_recurring_ticket_permissions.cjs` (`reconcileAllTenants`, irreversible down, `transaction: false`).
- Role-editor labels: add the `ticket_template` resource display strings wherever `recurring_ticket` got them in commit `4e4481218c` (`server/public/locales/*/common.json`).

### 3. Shared model and types

- `shared/models/ticketModel.ts`: add `created_from_template_id` to `ticketSchema`, omit it in `ticketUpdateSchema`, and add it to `CreateTicketInput`, `INPUT_DRIVEN_TICKET_COLUMNS` and `CREATE_TICKET_FIELD_HANDLING` (`{ kind: 'column', column: 'created_from_template_id', nullish: true }`). This mirrors how `duplicated_from_ticket_id` was threaded; grep that name to find each site.
- `packages/tickets/src/schemas/ticket.schema.ts`: same addition and omit.
- `packages/types/src/interfaces/ticket.interfaces.ts`: `created_from_template_id?: string | null; created_from_template_name?: string | null;` (the name is display-only).
- New `packages/types/src/interfaces/ticketTemplate.interfaces.ts`: `ITicketTemplate`, `ITicketTemplateChecklistItem`, `TicketTemplateDraft` (the editor's shape, also returned by the from-ticket loader).
- `shared/lib/ticketActivity/types.ts:20-55`: add `CREATED_FROM_TEMPLATE: 'TICKET_CREATED_FROM_TEMPLATE'`.

### 4. Copy-set module

- In `packages/tickets/src/lib/ticketDuplicate.ts`, keep the file and its exports (tests import them), and add:
  - `insertChecklistItemsReplacingTemplates(trx, tenant, { targetTicketId, items, userId }): Promise<number>`: the body of the current `copyChecklistFromSource` from the template-id delete onwards (`:120-177`). Items are `{ item_name, description, is_required, assigned_to, source, template_id }`.
  - `copyChecklistFromSource` becomes "load source items → `insertChecklistItemsReplacingTemplates`". Behaviour is unchanged, and `ticketDuplicate.integration.test.ts` must stay green unmodified.
- New `packages/tickets/src/lib/ticketTemplates.ts` (not `'use server'`):
  - `ticketTemplateInputSchema` (zod, `.strict()`): name 1–200, notes ≤ 2000, title 1–500, description string|null, uuids nullable, ITIL 1–5 nullable, tags ≤ 50 × 1–100 chars, `custom_fields` record (≤ 100 keys), checklist ≤ 200 items `{ item_name 1–500, description?, is_required, checklist_template_id? }`. The subcategory-needs-category refine copies `definitionInput.ts:73-83`.
  - `ticketToTemplateDraft(sourceRow, { tags, checklist })`: the ticket → template copy set, a pure function that can be unit-tested.
  - `findTicketTemplateReferenceProblems(trx, tenant, fields)`: checks that board, category (and that the category belongs to the board), subcategory parent and priority exist. Model it on `packages/tickets/src/lib/recurring/validateReferences.ts`, and leave `// LEVERAGE: pattern ticket-field-reference-validation` at both sites.
  - `templateChecklistToItems(rows)`: rows with a `checklist_template_id` map to `source: 'template'`, the rest to `'manual'`, with `assigned_to: null`.

### 5. Server actions

New `packages/tickets/src/actions/ticketTemplateActions.ts` (`'use server'`). Every action uses `withAuth` and rejects non-internal users. Permission is checked inside the transaction with `hasPermission(user, 'ticket_template', action, trx)`. Errors go through a `ticketTemplateActionErrors.ts` built like `checklistActionErrors.ts`. Shape follows `recurringTicketActions.ts:80, 235-523`.

- `listTicketTemplates({ includeInactive? })` (read): name, title, board name, item count, tag count, updated_at, is_active.
- `getTicketTemplate(templateId)` (read): template + ordered checklist + `referenceProblems`.
- `getTicketTemplateDraftFromTicket(ticketId)` (**create** + `ticket:read`): reuses `loadAuthorizedDuplicateSourceRow` (`ticketActions.ts`, which does row-level read authorization) plus the tag and checklist loads that `getTicketDuplicateSource` (`ticketActions.ts:796-893`) runs. Extract those three loads into a private `loadTicketCopySources(trx, tenant, ticketId)` that both actions call, and leave the duplicate loader's behaviour unchanged. Returns a `TicketTemplateDraft` + `{ source_ticket_id, source_ticket_number, has_inline_images }`.
- `createTicketTemplate(input)` (create): validate → reference check → insert the template + items in one transaction. A duplicate name maps the unique violation to "A template named X already exists".
- `updateTicketTemplate(templateId, input)` (update): replaces the items wholesale (delete + insert in one transaction). Item ids are never referenced elsewhere.
- `setTicketTemplateActive(templateId, isActive)` (update), `deleteTicketTemplate(templateId)` (delete; hard delete, tickets keep `created_from_template_id` and the activity snapshot).
- `listTicketTemplatesForCreate()` (read + `ticket:create`): active templates as `{ template_id, name, board_id }` for the picker.
- `getTicketTemplateForCreate(templateId)` (read + `ticket:create`): the form prefill. Tags resolve to definitions by text (`TagMapping`/`TagModel` lookup for `tagged_type = 'ticket'`). Dangling references come back null with a `warnings[]` list. Returns `checklist` names and `custom_field_count` the way `TicketDuplicateSource` does.

`// LEVERAGE: pattern ticket-template-fields` at `packages/tickets/src/lib/recurring/definitionInput.ts:52-64` and in the new schema: recurring definitions carry the same title/description/board/category/priority/tags/checklist group as a ticket template (see Not doing).

### 6. `addTicket`: create from template

`packages/tickets/src/actions/ticketActions.ts`, `addTicket` (`:520`):

- Parse `ticket_template_id` and `template_copy_checklist` (default on) next to the duplicate fields (`:543-544`).
- If both `duplicate_of_ticket_id` and `ticket_template_id` are present, throw `'A ticket cannot be created from a template and a duplicate at once'`.
- Template path, **before** `createTicketWithRetry` (beside the duplicate block at `:600-613`): internal users only; `hasPermission(user,'ticket_template','read',trx)`, otherwise permission denied; load the template (tenant-scoped, `is_active`), otherwise `'Ticket template not found'`; set `createTicketInput.created_from_template_id` and `createTicketInput.attributes = pickDuplicableAttributes({ custom_fields: template.custom_fields })`.
- After the creation activity (`:668-690`), next to the duplicate block (`:706-750`): if copying is on, call `insertChecklistItemsReplacingTemplates` with the template items, then write `CREATED_FROM_TEMPLATE` (details `{ template_id, template_name, checklist_items_copied, custom_fields_copied }`) using the constant, never a `'TICKET_…'` literal (`ticketActions.suppressionMirror.contract.test.ts` slices on that prefix).
- Leave `ticket_origin: TICKET_ORIGINS.INTERNAL` untouched (`ticketOriginCreatePath.test.ts`).

`createTicketWithSideEffects` (`shared/services/tickets/createTicketWithSideEffects.ts`) is **not** changed in this card. Its only consumer is the recurring generator.

### 7. Detail query: template name for the header

`getConsolidatedTicketData` (`optimizedTicketActions.ts`) and `getTicketById` (`ticketActions.ts`): tenant left join `ticket_templates as tt` on `t.created_from_template_id = tt.template_id`, and select `tt.name as created_from_template_name`. Put it next to the `duplicated_from_ticket_number` join added in phase 1 (grep `duplicated_from_ticket_number`). Keep `optimizedTicketActions.tenantScopedAuth.contract.test.ts` green.

### 8. Routes and composition

- `server/src/app/msp/tickets/templates/{layout,page}.tsx` and `templates/[templateId]/page.tsx`: copies of `recurring/*` (`new` or a UUID, otherwise `notFound()`). The editor page reads `searchParams.fromTicket` (UUID-validated) and passes it through.
- `packages/msp-composition/src/tickets/MspTicketTemplates.tsx`: `MspTicketTemplatesPage`, `MspTicketTemplateEditor` (`MspRecurringTickets.tsx` pattern).
- `server/src/config/menuConfig.ts:119`: add `{ name: 'Ticket Templates', translationKey: 'nav.ticketsTemplates', icon: LayoutTemplate (or FileStack), href: '/msp/tickets/templates', requiredPermission: 'ticket_template:read' }`. Read is granted to technicians so they can browse and start from a template. Edit controls are hidden without `update`.
- Metadata strings: `metadata` namespace `msp.tickets.templates.title`.
- `ticketsModalRoutes.contract.test.ts`: check that it does not enumerate `/msp/tickets/*` children in a way the new segment breaks.
- `packages/tickets/src/lib/createTicketRoute.ts`: `CreateTicketPrefill.templateId`, `buildCreateTicketHref` → `template=<id>`, and parsed back in `parseCreateTicketPrefill`. `server/src/app/msp/_components/CreateTicketRouteClient.tsx` passes `templateId` to `QuickAddTicket`.

### 9. Template UI (`packages/tickets/src/components/templates/`)

Standard components only (`docs/AI_coding_standards.md`), and every interactive element gets an `id`.

- `useTicketTemplatePermissions.ts`: a copy of `useRecurringTicketPermissions.ts` for `ticket_template`.
- `TicketTemplatesPage.tsx`: DataTable (name, board, checklist count, tags, updated, active badge). Row action menu per the DataTable action-menu standard: New ticket from template (needs `ticket:create`), Edit, Activate/Deactivate, Delete (ConfirmationDialog). Header button "New template" (needs create). Empty state that explains the ticket → More → Create template flow.
- `TicketTemplateEditor.tsx`: a full page, using card sections like `RecurringTicketEditor.tsx`:
  - **From-ticket banner** when `fromTicket` is set: "Prefilled from ticket #N. Remove anything specific to that ticket before saving." It links to the ticket. A warning line appears when `has_inline_images` is set (R2).
  - **Template**: name, notes.
  - **Ticket fields**: title, description (the same `TextEditor` + `parseTicketRichTextContent` used by QuickAdd), board / category / priority via the existing `BoardStatusFields`-style pickers in `recurring/RecurringFieldGroups.tsx`. Reuse `PriorityField` and the category group directly. For board, add a `BoardField` variant without status (or a `showStatus={false}` prop on `BoardStatusFields`) rather than forking. ITIL impact/urgency selects appear when the board is ITIL. Data comes from `useRecurringReferenceData`; rename it to a neutral `useTicketFieldReferenceData` if it holds nothing recurring-specific, otherwise leave a `// LEVERAGE: friction` marker.
  - **Tags**: tag-text editor (`TagInput`-style, tickets type).
  - **Checklist**: an editable ordered list (add / rename / required toggle / reorder / remove). Reuse the item-row editing from `ChecklistTemplatesSettings.tsx` if it can be extracted cleanly; otherwise build a local component and leave `// LEVERAGE: pattern checklist-item-list-editor` at both sites. Items carrying a `checklist_template_id` show a small "from <checklist template>" hint.
  - **Custom fields**: a key/value list per D7.
  - Reference-problem warnings inline. Save / Cancel, plus a dirty-state guard on navigation. After saving from a ticket, `router.replace('/msp/tickets/templates/<id>')`.

### 10. Entry points on the ticket

- `packages/tickets/src/components/ticket/TicketDetails.tsx:3650-3674`: after Duplicate and before Delete, add a `DropdownMenu` with a ghost/outline `Button` trigger (`id={`${id}-more-actions-button`}`, `MoreHorizontal`, sr-only "More actions"). Item: `DropdownMenuItem id={`${id}-create-template-menu-item`}` → `router.push('/msp/tickets/templates/new?fromTicket=<id>')`. The menu renders only when `useTicketTemplatePermissions().create` is true, so for users without that permission the header is unchanged. In AlgaDesk mode it behaves the same (the templates route is product-neutral).
- `packages/tickets/src/components/ticketActionsColumn.tsx:55-66`: add "Create template from ticket" after Duplicate. It needs an `onCreateTemplate` prop and a `canCreateTemplate` flag, both supplied by `TicketingDashboard.tsx` from the permissions hook. Use `navigateAwayTo`, not `router.push` (Duplicate step 9 reason).

### 11. Quick Add: start from template

`packages/tickets/src/components/QuickAddTicket.tsx`:

- Prop `templateId?: string` (`:164-200`), wired from the route.
- State: `templateSource`, `copyTemplateChecklist` (default true), `templateOptions`, `templateLoadError`.
- Open effect (`:369-445`): when the user can read templates and the form is not in duplicate mode, load `listTicketTemplatesForCreate()` alongside the form data. If `templateId` is set, also load `getTicketTemplateForCreate` and apply it.
- `applyTemplateSource(src)`: a sibling of `applyDuplicateSource` (`:736`). It sets title, description (+ editor key bump), board, priority, ITIL, categories and pending tags. It does **not** touch client, contact, location, assignee, team or agents (D13). Extract the shared part (title/description/board/priority/ITIL/categories/tags setters) into `applyCopiedTicketFields(fields)`, which both helpers call.
- Picker: a `CustomSelect` (`id={`${id}-template-select`}`) above Title, labelled "Template", with "None" as the first option. On change: if `isDraftDirty`, show a ConfirmationDialog first. Choosing None clears `templateSource` but keeps the field values already applied. It is hidden in duplicate mode, when there are no templates, or without read permission.
- Checklist / custom-field preview: generalise the duplicate checklist block (`:1746-1790`) to take `{ label, items, checked, onChange, customFieldCount }`. It is used once for duplicate and once for template. The `quickAdd.duplicate*` i18n strings stay verbatim (`QuickAddTicket.i18n.test.ts`).
- `handleCreateTicket` (`:1023-1028`): when `templateSource` is set, append `ticket_template_id` and `template_copy_checklist`.
- Pill: "From template: <name>" (`data-testid="quick-add-ticket-template-pill"`), next to the duplicate pill.
- Draft-dirty baseline (`:841-851`): a template prefill counts as baseline, so an untouched template draft is not flagged as unsaved (same fix as `c8a158f0a0` for duplicates).

### 12. Ticket header and activity

- `TicketDetails.tsx` near `:3611-3622`: when `created_from_template_name` is set, show a `Link` "From template: <name>" to `/msp/tickets/templates/<id>`, visible only with `ticket_template:read`. Otherwise show plain text.
- `TicketActivityTimeline.tsx`: `CREATED_FROM_TEMPLATE` → `LayoutTemplate` icon. Text: "{actor} created this ticket from template <name>", using the name snapshot from the activity details.

### 13. i18n

New keys in `server/public/locales/en/features/tickets.json` (`templates.*`, `quickAdd.template*`, `actions.moreActions`, `actions.createTemplate`, `details.fromTemplate`), `common.json` (`nav.ticketsTemplates`, the permission resource label), and `metadata.json`, mirrored into the other locales the way `4e4481218c` did. Run `node scripts/validate-translations.cjs`.

## Tests

**Unit (vitest, `packages/tickets`)**

1. `lib/ticketTemplates.test.ts`:
   - `ticketToTemplateDraft` copies the template copy set and drops completion state, assignee, client and contact.
   - Items with a checklist `template_id` keep it as `checklist_template_id`.
   - Custom fields go through the allowlist.
   - Schema: subcategory without category is rejected, ITIL out of range is rejected, a blank name is rejected, and unknown keys are rejected (`.strict`).
2. `lib/ticketDuplicate.test.ts` stays green after the D4 extraction.
3. `createTicketRoute` round-trips `template` and is absent when unset.
4. `components/templates/__tests__/TicketTemplateEditor.fromTicket.test.tsx`:
   - with `fromTicket`, the editor shows the banner and the prefilled name, title, description, board, category, priority, tags, checklist and custom fields;
   - removing a checklist item and a custom field, then Save, sends exactly the edited input;
   - the inline-image warning appears when it should.
5. `components/__tests__/QuickAddTicket.template.test.tsx` (harness from `QuickAddTicket.duplicate.test.tsx`):
   - choosing a template fills title, description, board, category, priority and tags, leaves client, contact and assignee alone, and sets status to the board default;
   - submit sends `ticket_template_id` (and `template_copy_checklist=false` when unchecked), never a status from the template;
   - a dirty draft asks before applying;
   - the picker is hidden in duplicate mode and without permission;
   - opening with `templateId` preloads the template;
   - an untouched template draft is not dirty.
6. TicketDetails: the More menu and its item render only when `ticket_template:create` resolves true (mock `checkCurrentUserPermissions`). The row menu item behaves the same way.
7. Contract tests that read source text stay green: `QuickAddTicket.i18n.test.ts`, `ticketActions.suppressionMirror.contract.test.ts`, `ticketOriginCreatePath.test.ts`, `optimizedTicketActions.tenantScopedAuth.contract.test.ts`, `ticketsModalRoutes.contract.test.ts`.

**Integration (real DB; `server/src/test/integration/ticketTemplates.integration.test.ts`, structured like `ticketDuplicate.integration.test.ts`)**

8. **From ticket → template**:
   - Seed a ticket with category/subcategory, priority, two tags, three checklist items (one completed, one from checklist template X), `custom_fields`, `watch_list`, SLA attributes, a client, a contact and an assignee.
   - `getTicketTemplateDraftFromTicket` returns the copy set: no completion state, no client, contact or assignee, no `watch_list`/`sla_*`.
   - `createTicketTemplate` with the draft (one item and one custom field removed, name changed) persists exactly that.
9. **Template → ticket** (the acceptance path):
   - `addTicket` with a client, the template's fields and `ticket_template_id` creates a ticket with `created_from_template_id` set and `attributes.custom_fields` = the template's (and nothing else carried).
   - The checklist items are all `completed = false`, in template order, with X-items keeping `template_id = X`.
   - Exactly one set of X items exists when X also auto-applies on the board (D2/D4).
   - The `TICKET_CREATED_FROM_TEMPLATE` activity row is written.
   - Status is the board default.
   - With `template_copy_checklist=false` the template items are absent (auto-applied ones remain).
10. **Permission gating**:
    - A Technician (default grants) is refused by `getTicketTemplateDraftFromTicket`, `createTicketTemplate`, `updateTicketTemplate` and `deleteTicketTemplate`, but can `listTicketTemplatesForCreate` and create a ticket from a template.
    - An Admin is allowed.
    - A custom role with `ticket_template:create` but no row-level read of the source ticket is refused by `getTicketTemplateDraftFromTicket` with "Cannot view ticket".
    - A user without `ticket_template:read` is refused by `addTicket` with `ticket_template_id`, and no ticket is written (rollback).
    - A client-portal user is refused everywhere.
    - Duplicate still works for a Technician (unchanged gate).
11. Both `duplicate_of_ticket_id` and `ticket_template_id` → rejected. An inactive or other-tenant template → "Ticket template not found".
12. Reference validation: a template whose board was deleted reports a problem from `getTicketTemplate`, and `getTicketTemplateForCreate` returns `board_id: null` with a warning.
13. Migrations: the tables and column exist; down drops them; the permission reconcile grants match D11 for PSA and AlgaDesk tenants.

**Manual smoke (dev server, `devOrigin` on 3730)**:
1. As Admin, open a finished ticket → More → Create template from ticket. Remove the person's name from the title, delete a custom field, rename the template "Microsoft 365 Employee Department Change", and Save.
2. As Technician, Tickets → Ticket Templates → New ticket. Pick a client and contact, then Create. The checklist arrives unchecked, the header shows "From template", and the activity row is present.
3. In Quick Add, use the template picker over a half-filled draft and confirm the prompt.
4. As Technician, the More menu is absent.
5. Repeat in AlgaDesk mode.

## Not doing (follow-ups)

- **Recurring definitions referencing a ticket template** (`recurring_ticket_definitions.ticket_template_id`) instead of their own embedded field group. This is the natural consolidation once templates ship (LEVERAGE `ticket-template-fields`), but it needs data migration and recurring editor changes.
- **Client-scoped templates** (D6), and **template visibility by board/team**.
- **Title tokens** (`{{client}}`, `{{contact}}`) in template titles: recurring has `titleTemplate.ts`. Add tokens once the plain template has had real use.
- **Assignment defaults (team/agent) and due-date offset in templates.**
- **"Insert items from checklist template"** inside the template editor's checklist section.
- **Template usage counts / "tickets created from this template"** on the list (the column makes this possible).
- **Re-homing inline description images** into template-owned documents (R2).
- **Client portal and REST API surfaces** for templates; **Quick Add from the client/contact ticket tabs** gets the picker for free only where those tabs use the create route.
- **Changing `createTicketWithSideEffects`** to accept a template (only needed when recurring consumes templates).

## Risks

- **R1: Quick Add state cascade.** Same as Duplicate R1. Applying a template must not go through `handleBoardChange`. Test #5 asserts category and priority after the board's status and category fetches resolve.
- **R2: inline description images.** Images in a ticket description point at that ticket's documents. A template outlives the ticket, so if the source ticket is deleted, or a client-portal viewer of a new ticket cannot read the source, images break. v1 shows a warning in the editor (`has_inline_images`) so the admin can remove or re-upload them. Re-homing is a follow-up.
- **R3: checklist replacement correctness.** The D4 extraction touches phase-1 code. `ticketDuplicate.integration.test.ts` must pass unmodified, which proves the extraction preserved behaviour.
- **R4: permission reconcile on existing tenants.** It is additive only (the `reconcileAllTenants` contract). Tenants with custom admin roles do not get the `create/update/delete` grants automatically; they must assign them. Call this out in the release note.
- **R5: name uniqueness on Citus.** The functional unique index `(tenant, lower(name)) WHERE is_active` must be created after distribution and must include the distribution column (it does). Read `citus-migration-gotchas` before writing the migration.
- **R6: source-text contract tests** (listed in Tests #7) break on careless edits. Keep pinned strings verbatim and use event constants.
- **R7: `ticketsModalRoutes` / intercepting routes.** The new `/msp/tickets/templates` segment sits under `/msp/tickets/@modal`. Verify that the modal slot's default/catch-all does not intercept it.
