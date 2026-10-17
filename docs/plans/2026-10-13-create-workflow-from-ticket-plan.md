# Create Workflow From Ticket — Implementation Plan

**Date:** 2026-10-13
**Branch:** `feature/create-workflow-from-ticket-joymode-alga-2026-00`
**Driver:** PSA ticket alga-2026-0002502 (Joymode Business Solutions). This is the "later phase"
of the request; Duplicate ticket shipped in PR #3608 (`docs/plans/2026-10-02-duplicate-ticket-plan.md`).

## Goal

An administrator looking at a ticket they keep recreating by hand clicks
**More → Create workflow from ticket**, names the workflow, picks a trigger, chooses which parts
of the ticket to import, and lands in the Workflow Designer on a **draft** that already contains
a prefilled *Create ticket* step and the ticket's checklist. They finish it there and save/publish
through the normal designer flow. Nothing is inferred and nothing is published automatically.

## Current state (what the code gives us)

- **No "More" menu on the ticket detail header.** The header action group is
  `packages/tickets/src/components/ticket/TicketDetails.tsx:3625-3674` (presence, layout toggle,
  open-in-new-tab, Duplicate button `:3651-3663`, Delete button `:3664-3673`). PR #3608 added
  Duplicate as a button; the only ⋮ menu is the list-row menu
  (`packages/tickets/src/components/ticketActionsColumn.tsx:19-71`).
- **Draft persistence exists and never publishes.** `createWorkflowDefinitionAction`
  (`ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts:1551-1628`) always writes
  `status: 'draft'` (`:1592`), requires `workflow:manage` (or `admin`) via `requireWorkflowPermission`
  (`:1266-1290`), saves even when validation fails (stores `validation_status/errors`), and returns
  `{ workflowId, draftVersion }`. Publishing is `publishWorkflowDefinitionAction` (`:2296`, `publish`
  permission) and is untouched by this work.
- **Closest precedent:** `createWorkflowFromEventAction`
  (`ee/packages/workflows/src/actions/workflow-event-catalog-v2-actions.ts:530-576`) builds a
  definition with a trigger and `steps: []` and delegates to `createWorkflowDefinitionAction`.
- **Definition shape:** `workflowDefinitionSchema` (`shared/workflow/runtime/types.ts:480`);
  triggers `:427-478` (event / schedule / recurring / date; "manual" = no trigger with
  `payloadSchemaRef: 'payload.Empty.v1'`); `action.call` config
  (`shared/workflow/runtime/nodes/registerDefaultNodes.ts:41-56`); literals are stored raw,
  expressions as `{ $expr }` (`types.ts:5-79`). The designer's "fixed" input mode stores raw
  literals (`ee/server/src/components/workflow-designer/WorkflowActionInputSourceMode.tsx:40-80`).
- **`tickets.create` v1** (`shared/workflow/runtime/actions/businessOperations/tickets.ts:398-488`)
  accepts every field we need: `client_id`, `contact_id`, `title`, `description`, `board_id`,
  `location_id`, `status_id`, `priority_id`, `assignment {primary, additional_user_ids}`,
  `category_id`, `subcategory_id`, `tags: string[]`, `custom_fields` (merged into
  `attributes.custom_fields`, `:497` — the same storage the source ticket uses), `notify`
  (`contact` is an explicit-choice field, `:456`).
- **Checklist actions in the workflow runtime:** only `tickets.apply_checklist`
  (`tickets.ts:1843-1895`, `{ ticket_id, template_id }`, idempotent per template). There is **no**
  action that adds ad-hoc checklist items.
- **Source loading:** `getTicketDuplicateSource` (`packages/tickets/src/actions/ticketActions.ts:796-893`)
  with row-level `authorizeTicketRead` (`:299-348`) and `loadAuthorizedDuplicateSourceRow`
  (`:357-373`). `TicketDuplicateSource` (`packages/tickets/src/lib/ticketDuplicate.ts:11-37`) has
  only a custom-field *count* and checklist items without `template_id`/`description`, so it is
  not sufficient as-is.
- **Package boundaries:** `tickets` and `workflows` are both vertical packages and may not import
  each other (`eslint-plugin-custom-rules/no-feature-to-feature-imports.js`,
  `tools/nx-tests/moduleBoundaries.test.ts`). The designer is EE-only; CE resolves
  `@alga-psa/workflows/entry` to a "requires Pro" stub (`server/next.config.mjs:444-446`, `741-743`,
  `1100`). The established CE-safe seam pattern is the aliased
  `@alga-psa/user-activities/server/workflow-task-actions` (`server/next.config.mjs:447-458`).
- **Ticket-detail slot pattern:** `renderCreateProjectTask` / `renderQuickInvoice` are declared on
  `TicketDetails.tsx:246,252`, threaded through `TicketDetailsContainer.tsx:92-93,357-358`, and
  filled by `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx:57-98`.
- **Permission source in ticket UI:** server bootstrap
  (`server/src/app/msp/tickets/[id]/page.tsx:148,177`, type in
  `packages/tickets/src/lib/ticketScreenBootstrap.ts`), with a client fallback through
  `getCurrentUserPermissions()` (`TicketDetails.tsx:350-388`).
- **Designer deep link:** `/msp/workflow-editor/<workflowId>`
  (`server/src/app/msp/workflow-editor/[workflowId]/page.tsx`; helper `workflowEditorPath` in
  `ee/server/src/components/workflow-designer/workflowEditorRoute.ts`).

## Design decisions

**D1 — The draft is self-contained: trigger + `tickets.create` + checklist steps. No template
entity.** The sibling card "Create Template From Ticket" has no code yet, and a workflow that
references a ticket template would make this feature depend on an entity that does not exist.
The prefilled `tickets.create` step is already a complete, editable "template" in designer terms.
When the template card ships, a follow-up can offer "use template X" as an alternative step; that
is out of scope here.

**D2 — Generated definition shape.**

```ts
{
  id: uuidv4(), version: 1,
  name: <admin-entered>,
  description: 'Created from ticket #<ticket_number> (<title>)',
  payloadSchemaRef: <from trigger, see D4>,
  trigger: <see D4>,          // omitted for Manual
  steps: [
    { id: 'create-ticket', type: 'action.call', name: 'Create ticket',
      config: { actionId: 'tickets.create', version: 1, saveAs: 'createdTicket',
                designerGroupKey: 'ticket', designerTileKind: 'core-object',
                inputMapping: { ...literal fields from the source, D3 } } },
    // zero or more, in source order (D5)
    { id: 'apply-checklist-<n>', type: 'action.call', name: 'Apply checklist: <template name>',
      config: { actionId: 'tickets.apply_checklist', version: 1,
                inputMapping: { ticket_id: { $expr: 'vars.createdTicket.ticket_id' }, template_id: '<uuid>' } } },
    { id: 'add-checklist-items', type: 'action.call', name: 'Add checklist items',
      config: { actionId: 'tickets.add_checklist_items', version: 1,
                inputMapping: { ticket_id: { $expr: 'vars.createdTicket.ticket_id' }, items: [...] } } }
  ]
}
```

All imported values are **literals** (the designer's "fixed" mode). Per the customer, we do not
infer automation rules or map anything to trigger payload fields; the admin rewires fields to
`payload.*` in the designer if they want to.

**D3 — Field mapping into `tickets.create`** (follows the duplicate copy-set, D7/D9/D12 of the
duplicate plan):

| Source | `tickets.create` input | Group (dialog checkbox) |
|---|---|---|
| `client_id`, `contact_id`, `location_id` | same | Properties (always) |
| `title`, `attributes.description` (raw string as stored) | `title`, `description` | Properties |
| `board_id`, `category_id`, `subcategory_id`, `priority_id` | same | Properties |
| `assigned_to` / `assigned_team_id`, additional agents | `assignment { primary: {type:'user'\|'team', id} \| null, additional_user_ids }` | Assignment |
| tags (`tag_text`) | `tags: string[]` | Tags |
| `attributes.custom_fields` (allowlist, values not count) | `custom_fields` | Custom fields |
| — | `notify: { internal: true, contact: false }` set explicitly so the explicit-choice field validates | always |

Never imported: `status_id` (board default applies; matches duplicate D9), due date, SLA/system
attributes, comments, time entries, documents, ITIL impact/urgency (not inputs of
`tickets.create`). "Properties" is always on — without client/board/priority/title the step is
invalid, and the whole point is a working starting draft.

**D4 — Trigger selection.** The dialog offers **Manual** (default) or **an event from the
workflow event catalog** (`listEventCatalogOptionsV2Action`,
`workflow-event-catalog-v2-actions.ts:180`), Tickets category listed first. The server resolves
`payloadSchemaRef` from the catalog by `eventName` (it does not trust a client-sent ref, and fails
fast on an unknown event — `createWorkflowFromEventAction` falls back to `''`, which fails the
schema parse). Date-source catalog rows reuse `getDateTriggerSourceByCatalogEvent` /
`buildDateTriggerForSource` exactly as `createWorkflowFromEventAction` does. Extract that trigger
construction (`:543-557`) into a shared helper `buildTriggerForCatalogEvent()` in the same file and
use it from both actions — trivial, and it removes the copy before it exists. Schedule/recurring
triggers are not offered: they are stripped from drafts (`normalizeTimeTriggerDraftContract`,
`workflow-runtime-v2-actions.ts:424-454`) and configured in the designer.

**D5 — Checklist → workflow actions.**
- Items with a `template_id` whose template still exists and is active → one
  `tickets.apply_checklist` step per distinct template, in order of first appearance. This keeps
  the template link (and the action is idempotent per template, so an auto-applied template is not
  duplicated). Edits the admin made to template-sourced items on the source ticket are not
  carried; the template is the source of truth. The dialog says so in its checklist summary.
- All other items (manual items, or items whose template is gone/inactive) → **one new action,
  `tickets.add_checklist_items` v1**, carrying `items: [{ item_name, description?, is_required }]`
  in source order. Items are imported unchecked and unassigned.
- New action rather than creating a checklist template on the fly: generating a draft must not
  write tenant configuration outside the workflow (a stray template would survive a discarded
  draft and show up in Settings).

**D6 — New runtime action `tickets.add_checklist_items` v1** in
`shared/workflow/runtime/actions/businessOperations/tickets.ts`, next to `tickets.apply_checklist`
(`:1843`). Input `{ ticket_id, items: [{ item_name (min 1), description?, is_required (default false) }] (min 1) }`;
output `{ ticket_id, added: [{ checklist_item_id, item_name }] }`. Requires `ticket:update`.
Inserts into `ticket_checklist_items` with `source: 'workflow'`, `template_id: null`,
`order_number` appended after the current max, `created_by` = workflow actor. The insert core goes
in `shared/lib/ticketChecklists/` (new `addItems.ts`, exported from `index.ts`) so the runtime
action does not duplicate the SQL in `packages/tickets/src/actions/checklists/ticketChecklistActions.ts:96`
(`addChecklistItem`); that action is left as-is (marker `// LEVERAGE: pattern ticket-checklist-insert`
there if the shapes diverge). Registered in the designer's ticket group in
`shared/workflow/runtime/designer/actionCatalog.ts:76-84` so it is hand-addable too.

**D7 — Server flow: load (tickets) → build (pure, shared) → persist (workflows), composed in an EE
seam.** This respects the vertical boundary and duplicate-plan D4 (server-side load; the client
sends only ids and choices).
1. **Load:** new `getTicketWorkflowBlueprint(ticketId)` server action in
   `packages/tickets/src/actions/ticketActions.ts`, reusing `loadAuthorizedDuplicateSourceRow`
   (row-level read auth) plus `ticket:read`. Returns a `TicketWorkflowBlueprint`: the
   `TicketDuplicateSource` fields plus custom-field **values** (allowlisted
   `attributes.custom_fields`), and checklist items with `description`, `template_id`, template
   name, and template `is_active`. Implemented by extending the existing loader query block
   (`:817-841`), not a second loader.
2. **Build:** pure `buildWorkflowDraftFromTicket(blueprint, { name, trigger, include })` in
   new `shared/workflow/runtime/designer/draftFromTicket.ts`. `TicketWorkflowBlueprint` type lives
   there too, and tickets imports it from `@alga-psa/shared` (tickets already depends on shared).
   No I/O, so it is fully unit-testable.
3. **Persist (composition):** `workflows` cannot import `tickets`, so the composing action lives
   one level up in a new EE server file, `ee/server/src/workflows/createFromTicket/actions.server.ts`
   (`'use server'`, `withAuth`): `createWorkflowFromTicketAction({ ticketId, name, trigger:
   {type:'manual'} | {type:'event', eventName}, include: { assignment, tags, customFields,
   checklist } })`. It imports `getTicketWorkflowBlueprint` from `@alga-psa/tickets`,
   `buildWorkflowDraftFromTicket` from `@alga-psa/shared`, and `createWorkflowDefinitionAction` /
   `buildTriggerForCatalogEvent` from `@alga-psa/workflows`. Order: fail fast when
   `!isEnterpriseEdition()` → `workflow:manage` check (`requireWorkflowPermission` semantics,
   `workflow-runtime-v2-actions.ts:1266-1290`) → blueprint load (ticket read + row auth) → resolve
   trigger → build → `createWorkflowDefinitionAction({ definition })` (re-checks `manage`, writes
   `status: 'draft'`) → audit `workflow_definition_create_from_ticket` with
   `{ sourceTicketId, include, triggerEventName }` → return `{ workflowId }`. The workflows package
   gains only the exported `buildTriggerForCatalogEvent` helper.
4. The client navigates to `/msp/workflow-editor/<workflowId>` (`workflowEditorPath`).

**D8 — CE/EE seam.** New alias `@alga-psa/workflows/ticket-actions` (client entry) in
`server/next.config.mjs` at all three alias blocks (`:444-458`, `:741-753`, `:1100-1115`):
EE → `ee/server/src/workflows/createFromTicket/entry.tsx`, CE →
`packages/ee/src/workflows/createFromTicket/entry.tsx`. The CE stub exports
`createWorkflowFromTicketEnabled = false` and a component returning `null`, mirroring
`packages/user-activities/src/client/workflow-tasks`. `MspTicketDetailsContainerClient` passes the
slot only when enabled, so CE never shows the menu item and never bundles the designer. Add
the alias to `tsconfig.base.json` paths only if type resolution needs it the way the existing
`@alga-psa/user-activities/...workflow-tasks` aliases do. Copy their approach and do not change
other paths.

**D9 — The "More" menu.** Add a ⋮ **More** dropdown to the detail header between Duplicate and
Delete (`TicketDetails.tsx:3663`), using `DropdownMenu` from `@alga-psa/ui/components/DropdownMenu`
with trigger id `${id}-more-actions-menu` and item id `create-workflow-from-ticket-menu-item`. It renders only
when it has at least one item. For now its one item is "Create workflow from ticket". Duplicate stays a button,
so PR #3608 does not regress. The dialog is rendered **outside** the dropdown content so closing
the menu does not unmount it. New slot prop on `TicketDetails` / `TicketDetailsContainer`:
`renderCreateWorkflowFromTicket?: (args: { ticketId: string; ticketNumber: string; title: string;
open: boolean; onOpenChange: (open: boolean) => void }) => ReactNode`. Hidden in Alga Desk mode,
same as `renderCreateProjectTask`.

**D10 — Permission gating (admin/configuration role).** UI: the item shows only when the user has
`workflow:manage` or `workflow:admin`. Add `canManageWorkflows` to the ticket screen bootstrap
(`ticketScreenBootstrap.ts`, computed in `server/src/app/msp/tickets/[id]/page.tsx:148` from the
permissions already fetched there). Reuse the existing client fallback in `TicketDetails.tsx:350-388`
for drawer opens without a bootstrap: compute it from the same `getCurrentUserPermissions()` result
in the same effect, with no extra request. Server: enforced independently in the EE action (D7),
plus `ticket:read` and row-level read auth on the source. `ticket:create` is **not** required to
author the draft. It is checked at run time by `tickets.create` (`tickets.ts:490`) under the
workflow actor. This is a deliberate departure from duplicate D14: this feature is admin-only, so
the UI must not show an item that always fails.

**D11 — Dialog (EE component `CreateWorkflowFromTicketDialog`).** Uses `Dialog` with a `footer`
prop and `max-w-lg`, and calls `form.requestSubmit()` from the footer. Fields:
- Workflow name, required. Defaults to the ticket title.
- Trigger: a `CustomSelect`. Manual first, then catalog events grouped by category with Tickets first. Loaded on open.
- Import checkboxes: Assignment, Tags, Custom fields (with count), Checklist (with item count and
  "N from templates / M ad-hoc"). Properties are listed read-only as always included.
- An inline warning when a `TICKET_CREATED` trigger is chosen. The step creates tickets, and the
  runtime self-trigger guard (`ee/packages/workflows/src/lib/workflowSelfTriggerGuard.ts`) will skip
  the re-entrant launches. The admin should add a condition.
- Submit "Create draft & open designer". It runs `createWorkflowFromTicketAction`, then
  `router.push(workflowEditorPath(id))`. Errors show inline and the dialog stays open.

All interactive elements get ids. i18n: the menu strings go in `features/tickets` and the dialog
strings in `msp/workflows`, across all 11 locales (de, en, es, fr, it, nl, pl, pt, sv, xx, yy),
the same set PR #3608 touched.

**D12 — The generated draft must validate clean.** With Properties always included, every
required `tickets.create` input is present, and `notify.contact` is set explicitly. Acceptance
requires `validation_status` to be valid on the created row, so the admin can publish without
edits. If validation reports errors, the test fails. It does not fall back to a different shape.

## Changes, in order

1. **Runtime action + shared checklist insert** (D6)
   - `shared/lib/ticketChecklists/addItems.ts` (new), `index.ts` export.
   - `shared/workflow/runtime/actions/businessOperations/tickets.ts`: register
     `tickets.add_checklist_items` after `:1895`.
   - `shared/workflow/runtime/designer/actionCatalog.ts:76-84`: add to ticket group.
   - Tests: `shared/workflow/runtime/actions/businessOperations/__tests__/` (schema, permission,
     ordering, `source='workflow'`). Update any action-registry snapshot or fixture catalog
     (`tools/workflow-harness/generate-fixture-catalog.cjs`) that enumerates actions.
2. **Pure builder** (D2, D3, D5)
   - `shared/workflow/runtime/designer/draftFromTicket.ts` (new): `TicketWorkflowBlueprint` type,
     `buildWorkflowDraftFromTicket()`.
   - Unit tests: each include toggle; team vs user primary; no checklist → no checklist steps;
     template + ad-hoc mix → step order; inactive template → items fall to ad-hoc; output parses
     with `workflowDefinitionSchema` and passes `validateWorkflowDefinition`
     (`shared/workflow/runtime/validation/publishValidation.ts:30`) with zero errors, for Manual
     and `TICKET_CREATED`.
3. **Ticket blueprint loader** (D7.1)
   - `packages/tickets/src/actions/ticketActions.ts`: `getTicketWorkflowBlueprint`, sharing the
     query block with `getTicketDuplicateSource` (`:817-841`). Keep the pinned helper names and
     strings in `optimizedTicketActions.ts` untouched (duplicate plan R6).
   - Tests next to the existing duplicate-source tests: internal-only, `ticket:read` required, row
     auth denial → "Permission denied: Cannot view ticket", custom-field values allowlisted.
4. **Workflows helper** (D4)
   - `ee/packages/workflows/src/actions/workflow-event-catalog-v2-actions.ts`: extract
     `buildTriggerForCatalogEvent()` from `:543-557`. It resolves `payloadSchemaRef` from the
     catalog and throws on an unknown event. `createWorkflowFromEventAction` uses it, and its
     existing tests stay green.
5. **EE server action + seam** (D7.3, D8)
   - `ee/server/src/workflows/createFromTicket/actions.server.ts`, `entry.tsx`,
     `CreateWorkflowFromTicketDialog.tsx` (new).
   - `packages/ee/src/workflows/createFromTicket/entry.tsx` (CE stub, new).
   - `server/next.config.mjs` aliases (three blocks).
6. **Ticket UI** (D9, D10)
   - `packages/tickets/src/lib/ticketScreenBootstrap.ts`: `canManageWorkflows`.
   - `server/src/app/msp/tickets/[id]/page.tsx:148-177`: compute it.
   - `TicketDetails.tsx`: More menu, slot prop, permission fallback (`:350-388`).
   - `TicketDetailsContainer.tsx:92-93,357-358`: thread the slot through.
   - `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx:57-98`: fill the slot
     from the seam when enabled and not in Alga Desk mode.
7. **i18n**: `server/public/locales/*/features/tickets.json` and `*/msp/workflows.json`, all 11 locales.
8. **Integration and acceptance tests**
   - `server/src/test/integration/createWorkflowFromTicket.integration.test.ts` (new, pattern of
     `workflowDesignerGroupedPersistence.integration.test.ts`):
     - Happy path. The row has `status='draft'`, there are no `workflow_definition_versions` rows,
       the trigger and steps match, `validation_status` is valid, and the audit row is written.
     - `publishWorkflowDefinitionAction` returns `ok: true` on the result, so it publishes normally.
     - Running the published workflow (manual) creates a ticket with the board, category,
       priority, tags and custom fields and with the checklist items unchecked.
   - Permission gating:
     - No `workflow:manage` → 403 and nothing is written.
     - `workflow:manage` but no read on the source ticket (row auth) → denied and nothing is written.
     - A client-portal user → denied.
     - CE edition → fails fast.
   - UI tests (vitest + RTL): the More menu is hidden without `canManageWorkflows`, hidden in CE
     (slot absent), hidden in Alga Desk mode, and opens the dialog. The dialog submits the expected
     payload and navigates to `/msp/workflow-editor/<id>`.
   - Manual smoke on the dev server (http://feature-create-workflow-from-ticket-joymode-alga-2026-00.localhost:3559):
     ticket → More → create → designer opens the draft → save → publish.

## Out of scope

- Referencing a ticket template (follow-up after the Create Template From Ticket card ships).
- Inferring rules, conditions, or payload-field mappings from the ticket or its history.
- Importing comments, time entries, documents, status, due date, SLA state, or ITIL impact/urgency.
- Schedule/recurring triggers in the dialog (set them in the designer).
- A ⋮ entry in the ticket *list* row menu, client portal, REST/MCP endpoint, and Alga Desk mode.
- Moving Duplicate into the new More menu.
- Auto-publishing, under any path.

## Risks

- **R1 — Description format.** `attributes.description` may be serialized rich-text JSON. It is
  passed as-is to `tickets.create.description`, the same as duplicate. Verify in the integration
  run that the created ticket renders identically. If it does not, fix the runtime action's
  description handling rather than converting in the builder.
- **R2 — Template drift.** For template-sourced checklist items, the template's current content is
  applied, not the ticket's edited copy (D5). The dialog states this.
- **R3 — Self-trigger with `TICKET_CREATED` and related ticket events.** The runtime guard skips
  loops. The dialog warns about it. We do not auto-insert a condition, because that would be
  inference.
- **R4 — Stale literals.** Board, category, user, tag and template ids are frozen at creation. If
  one is later deleted, the designer validation surfaces it. This is accepted for a starting draft.
- **R5 — Source-text contract tests** on ticket actions (duplicate plan R6). Extend the existing
  loader. Do not rename or move the pinned helpers.
- **R6 — Alias drift.** The new seam must be added to all three `next.config.mjs` alias blocks, or
  one bundler path breaks in CE. Cover this with a CE build check (`EDITION=ce` type-check and build) before
  the PR.
- **R7 — Designer visibility.** The designer resolves `requestedWorkflowId` from
  `listWorkflowDefinitionsAction` (`WorkflowDesigner.tsx:2843-2872`). Created drafts default to
  `is_visible=true`. The happy-path test asserts this so the deep link always opens.
