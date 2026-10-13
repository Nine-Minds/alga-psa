# Batch duplicate: one ticket copy per selected contact — implementation plan

Driver: PSA ticket alga-2026-0002502 (Joymode Business Solutions, Munjal Thakkar). This follows single-ticket Duplicate (`docs/plans/2026-10-02-duplicate-ticket-plan.md`, PR #3608), which creates one copy per action. Duplicating one at a time works for four people. For a request like "do this for these 12 employees" it is too slow.

## Outcome

A **Duplicate for contacts…** action, available from the ticket detail header and from the ticket list row menu, opens a dialog for the source ticket. The technician:

1. picks contacts of the source's client (multi-select);
2. edits a title template that starts as the source title, for example changing `Onboard John Smith` to `Onboard {{contact}}`;
3. sees one row per copy with its contact and rendered title, and can edit any row's title, remove a row, or add a copy with no contact;
4. presses **Review**, checks a read-only summary of what will be created, then presses **Create 12 tickets**;
5. gets a results list: each created ticket links to its new number, and each failed copy shows its error with **Retry failed**.

Each copy gets the same copy set, exclusions, provenance (`duplicated_from_ticket_id`, `TICKET_DUPLICATED_FROM` / `TICKET_DUPLICATED_TO`) and `ticket:create` permission as single Duplicate. Each copy is also atomic: its checklist (unchecked), custom fields, team, additional agents, tags and provenance are written in one transaction.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| B1 | **Copies are per contact. There is no separate quantity mode.** An **Add copy without contact** button adds blank rows, which covers "N copies" when needed. | Every one of his examples is "same ticket, different person". A row list with optional contacts includes quantity as a special case, so there is one surface instead of two modes. Each row is `{ key, contactId \| null, title }`, which leaves room for a later `assetId` (devices) without redesign. |
| B2 | **Only the contact and the title vary per copy. All other fields come from the source exactly as single Duplicate copies them.** Shared fields are shown read-only in the review step. | The 12-employee case does not need to change board, priority or assignee per copy. Editing shared fields would mean running `QuickAddTicket`'s effect cascade (risk R1 of the previous plan) inside a batch form. If shared fields need to change, the technician edits the source, or makes one single Duplicate and batches from that. |
| B3 | **The client is fixed to the source client.** The contact picker is scoped to it, and the server rejects contacts from any other client. | `location_id`, contact and billing all hang off the client. Allowing a different client per copy would invalidate the copied location. `TicketModel.createTicket` does not check that the contact belongs to the client (`shared/models/ticketModel.ts`: create has no contact/client check), so the batch action must. |
| B4 | **Title tokens reuse the recurring token engine.** Pull the generic parts of `packages/tickets/src/lib/recurring/titleTemplate.ts` (`TOKEN_PATTERN`, unknown-token detection, substitution) into `packages/tickets/src/lib/titleTokens.ts`. Recurring keeps its API as thin wrappers. Duplicate defines its own token set: `{{contact}}` (contact full name) and `{{client}}` (client name). | Same `{{token}}` syntax, same whitespace tolerance (`{{ contact }}`), same rule that an unknown token is an error rather than literal text. There is one parser, not two. |
| B5 | **Tokens are substituted in the title only. The description is copied verbatim.** | The description is BlockNote JSON. Substituting inside it means walking text nodes across inline marks, where a token can be split by formatting. The title identifies each copy in lists, notifications and search. Description tokens are a follow-up. |
| B6 | **The client renders the titles. The server receives final title strings and checks them.** The server rejects an empty title and a title that still contains a `{{…}}` token. | What the technician reviewed is exactly what is created. Both sides use the same pure renderer, so there is no drift. The leftover-token check stops a broken template from reaching a ticket, which is the same rule recurring tickets use. |
| B7 | **New server action `duplicateTicketBatch`. Each copy runs in its own transaction, sequentially.** A preflight transaction checks permissions, loads the source and validates contacts; if it fails, the whole request is refused and nothing is created. | Separate transactions per copy are what make partial failure reportable: copy 7 failing does not roll back copies 1 to 6. Running them one after another keeps ticket-number allocation and connection use predictable. |
| B8 | **Reuse the existing copy path; do not fork it.** Pull `addTicket`'s inline duplicate blocks (`ticketActions.ts:597-613` and `:706-750`) and `getTicketDuplicateSource`'s draft loading (`:815-883`) into shared helpers. `addTicket`, `getTicketDuplicateSource` and `duplicateTicketBatch` all call them. | The copy set (the attributes allowlist, the checklist rule, provenance and both activity rows) stays defined in one place. A change to it applies to single and batch duplicate together. |
| B9 | **Batch copies are created through `createTicketWithSideEffects` (actor `{ type: 'user' }`), not N calls to `addTicket`.** | `addTicket` leaves team, additional agents and tags to client-side follow-up calls. For 12 copies that is 36 extra round trips that are not atomic with the create. `createTicketWithSideEffects` writes all of them inside the copy's transaction. It is the layer `addTicket`'s own `LEVERAGE: pattern ticket-create-composition` marker (`ticketActions.ts:621`) points to. `addTicket` is not moved onto it in this change (see Not doing). |
| B10 | **At most 50 copies per request**, enforced on the server and in the UI. | It bounds request time (about 50 sequential creates) and puts a limit on mistakes. His ceiling is about 20. |
| B11 | **A `batch_id` (uuid) goes in the details of both provenance activity rows.** | The source ticket gets one `TICKET_DUPLICATED_TO` row per copy. With `batch_id`, the timeline can later group "duplicated this ticket 12 times". v1 renders the rows as single Duplicate does. |
| B12 | **No bulk-bar entry in v1.** | The bulk bar acts on N selected *source* tickets. This feature is one source to N contacts. "Duplicate each selected ticket once" is a different feature with no driver behind it. |
| B13 | **Retry resends only the failed rows, with the same keys.** Rows that were created are locked. | No duplicate tickets on retry. The keys let the UI match results to rows. |
| B14 | **Internal users only**, with the same guard as single Duplicate (`user.user_type !== 'internal'` → permission error). | The MSP surface. The copied checklist is internal data. |

## Changes, in order

### 1. Token engine: `packages/tickets/src/lib/titleTokens.ts` (new, pure)

- Move from `recurring/titleTemplate.ts` (`:15`, `:27-35`):
  - `TOKEN_PATTERN`;
  - `findUnknownTokens(template, known: readonly string[]): string[]`;
  - `substituteTokens(template, values: Record<string, () => string>): string`, which throws `Unknown title token(s): …` exactly as `renderTitleTemplate` does today (`:53-57`);
  - `hasTokens(template): boolean`.
- `recurring/titleTemplate.ts`: rewrite `findUnknownTitleTokens` and `renderTitleTemplate` on top of these, with the same signatures and messages. `recurring/__tests__/titleTemplate.test.ts` must pass unchanged. That is the regression check for the move.
- New `packages/tickets/src/lib/duplicateTitle.ts` (pure, safe for the client bundle; `ticketDuplicate.ts` imports knex and is not):
  - `DUPLICATE_TITLE_TOKENS = ['contact', 'client'] as const`;
  - `renderDuplicateTitle(template, { contactName: string | null, clientName }): { title: string } | { error: 'unknown_token', tokens: string[] } | { error: 'contact_required' }`. A template containing `{{contact}}` on a row with no contact returns `contact_required`, never an empty string.
  - `validateDuplicateTitle(title): 'empty' | 'unresolved_token' | null`, used by both client and server. The ticket schemas set no maximum title length (`shared/models/ticketModel.ts`, `title: z.string().min(1)`), so neither does this check. Single Duplicate and quick-add do not limit length either.
- The `LEVERAGE: pattern title-tokens` marker is not needed, because this step is the extraction.

### 2. Shared duplicate helpers (no forked copy path)

`packages/tickets/src/lib/ticketDuplicate.ts` (server-only module, already not `'use server'`):

- `duplicateCreateInputPatch(source): Pick<CreateTicketInput, 'duplicated_from_ticket_id' | 'attributes'>` returns `{ duplicated_from_ticket_id: source.ticket_id, attributes: pickDuplicableAttributes(source.attributes) }`.
- `recordDuplicateCopy(trx, tenant, { source, targetTicketId, targetTicketNumber, actorUserId, copyChecklist, batchId? }): Promise<{ checklistItemsCopied }>`. Move `ticketActions.ts:706-750` here unchanged: `copyChecklistFromSource` when `copyChecklist` is set, then `TICKET_DUPLICATED_FROM` on the copy and `TICKET_DUPLICATED_TO` on the source, with `batch_id` added to both details when present. Use `TICKET_ACTIVITY_EVENT.*` constants, never string literals.

`packages/tickets/src/actions/ticketActions.ts`:

- `addTicket`: replace `:611-612` with `Object.assign(createTicketInput, duplicateCreateInputPatch(duplicateSourceTicket))` and `:706-750` with a `recordDuplicateCopy(...)` call. Behaviour stays identical. `server/src/test/integration/ticketDuplicate.integration.test.ts` must pass unchanged.
- Pull a private `loadDuplicateSourceDraft(trx, tenant, source): Promise<TicketDuplicateSource>` out of `getTicketDuplicateSource` (`:817-883`: client, contact, agents, tags, checklist). `getTicketDuplicateSource` then becomes the auth checks plus `loadAuthorizedDuplicateSourceRow` plus `loadDuplicateSourceDraft`.
- Keep `getTicketDuplicateSource`'s `source.attributes` handling and its `satisfies TicketDuplicateSource` as they are.

### 3. `createTicketWithSideEffects`: analytics pass-through

`shared/services/tickets/createTicketWithSideEffects.ts`: add an optional `analyticsTracker?: IAnalyticsTracker` to `CreateTicketWithSideEffectsInput` (`:79`) and pass it to `createTicketWithRetry` in place of `undefined` (`:142`). Without it, batch copies would not record the `ticket_created` analytics that `addTicket` sends through `TicketModelAnalyticsTracker`. Existing callers pass nothing, so their behaviour is unchanged.

### 4. Server action: `duplicateTicketBatch`

In `packages/tickets/src/actions/ticketActions.ts`, next to `getTicketDuplicateSource`, so it can use the private `loadAuthorizedDuplicateSourceRow`, `ticketBulkFailureMessage` (`:125`) and `loadDuplicateSourceDraft`:

```ts
export interface TicketDuplicateBatchCopy { key: string; contactId: string | null; title: string }
export interface TicketDuplicateBatchResult {
  batchId: string;
  created: Array<{ key: string; ticketId: string; ticketNumber: string; title: string }>;
  failed: Array<{ key: string; message: string }>;
}
export const duplicateTicketBatch = withAuth(async (
  user, { tenant },
  sourceTicketId: string,
  copies: TicketDuplicateBatchCopy[],
  options: { copyChecklist: boolean },
): Promise<TicketDuplicateBatchResult | TicketActionError>)
```

1. **Shape checks.** The user is internal (B14). There are 1 to 50 copies (B10). Keys are unique and non-empty. Each `contactId` is null or a UUID. Any violation returns a validation `TicketActionError` and nothing is created.
2. **Preflight** (one transaction):
   - `hasPermission(user, 'ticket', 'read')` and `hasPermission(user, 'ticket', 'create')`;
   - `loadAuthorizedDuplicateSourceRow`;
   - `loadDuplicateSourceDraft`;
   - one query, `contacts where client_id = source.client_id and contact_name_id in (…)`, returning the set of allowed contact ids.

   Any thrown error is mapped through `ticketActionErrorFrom` and refuses the whole batch.
3. **Per copy, in order.**
   - **Validation, before any transaction opens:**
     - `validateDuplicateTitle(copy.title)` must pass;
     - the contact must be null or in the allowed set. Otherwise the copy fails with "Contact does not belong to {client}".
   - **Create**, in `withTransaction(db, trx => …)`:
     - Re-run `loadAuthorizedDuplicateSourceRow` in this transaction, so a source deleted partway through the batch fails the remaining copies cleanly (R5 of the previous plan).
     - Call `createTicketWithSideEffects(trx, tenant, …)` with:
       - `actor: { type: 'user', userId: user.user_id }`;
       - `ticket`:
         - from the source: `client_id`, `board_id`, `location_id`, `category_id`, `subcategory_id`, `priority_id`, `itil_impact`, `itil_urgency`, `assigned_to`, and `description: draft.description`;
         - from the copy: `title` and `contact_id: copy.contactId ?? undefined`;
         - fixed values: `source: 'web_app'` and `ticket_origin: TICKET_ORIGINS.INTERNAL`;
         - `...duplicateCreateInputPatch(source)`.

         Do not set `status_id`. `TicketModel.createTicket` falls back to the board default (`ticketModel.ts:918-920`), which matches D9 of the previous plan. Do not set `due_date`.
       - `teamId: draft.assigned_team_id`;
       - `additionalAgentIds: draft.additional_agents.map(a => a.user_id)`;
       - `tags: draft.tags.map(t => t.tag_text)`;
       - `analyticsTracker: new TicketModelAnalyticsTracker()`.
     - Then call `recordDuplicateCopy(trx, …, { copyChecklist: options.copyChecklist, batchId })`.
     - Push the copy to `created`.
   - **On error:** push `{ key, message: await ticketBulkFailureMessage(error, 'Failed to create copy') }` to `failed` and `console.error` the raw error. This is the same pattern as `bulkAssignTickets` (`:2144-2207`).
4. If anything was created, call `revalidatePath('/msp/tickets')`. Return `{ batchId, created, failed }`.

Notes:

- **Assignee.** Pass `assigned_to` together with `teamId`. `assignTeamToTicketCore` only promotes the team lead when no primary assignee is set, so the source's assignee is kept.
- **Additional agents.** The source's `team_member` resources come through `additional_agents`. `createTicketWithSideEffects` already skips agents that the team step recorded (`:162-175`), so they are not added twice.
- **Checklist.** `TicketModel.createTicket` auto-applies matching templates before `recordDuplicateCopy` runs, the same order as in `addTicket`. `copyChecklistFromSource`'s template-replacement rule (D8) therefore holds without change.
- **Contract tests.** `ticketActions.suppressionMirror.contract.test.ts` slices the file on `eventType: 'TICKET_`. The new action writes no activity literals, because they all live in `recordDuplicateCopy`. Keep it that way.

### 5. UI: `BatchDuplicateTicketDialog`

New `packages/tickets/src/components/ticket/BatchDuplicateTicketDialog.tsx`, using standard components only (`Dialog`, `Button`, `Input`, `Checkbox`, `Alert`, `Badge`, `MultiContactPicker` from `@alga-psa/ui/components/MultiContactPicker`, `DataTable` or a plain table as the neighbouring bulk dialogs do). Props: `{ sourceTicketId: string; isOpen: boolean; onClose(): void; onCompleted?(result): void }`.

- **Load.** When the dialog opens, call `getTicketDuplicateSource(sourceTicketId)` and `getContactsByClient(source.client.id, 'active')` (`clientLookupActions.ts:62`). A loader error shows in a destructive `Alert` and disables every action, as the single Duplicate modal does.
- **Step "setup":**
  - A header reading "Duplicate #N for contacts" with the source title.
  - A title-template `Input`, initialised to `source.title`, with token buttons for `DUPLICATE_TITLE_TOKENS`. Copy the token-button row from `RecurringTicketEditor.tsx:424-437`, including insert-at-cursor.
  - If the source title contains the source contact's name, show a muted hint: "Replace '{{name}}' with {{contact}} to personalise each copy." Offer a one-click **Replace** button that does the substitution in the template.
  - `MultiContactPicker` with `clientId={source.client.id}`. Selecting a contact appends a row and deselecting removes it. The order is the order of selection.
  - An **Add copy without contact** button.
  - A rows table with columns:
    - contact name, or an em dash;
    - the rendered title as an `Input`, which follows the template until the user edits that row and then keeps the row's own text, with a small "reset to template" control;
    - a per-row error from `renderDuplicateTitle` / `validateDuplicateTitle`;
    - a remove button.
  - A **Copy checklist items (unchecked)** checkbox, default on, shown when `source.checklist.length > 0`. Use the same wording as single Duplicate.
  - A count, "N of 50", with the add controls disabled at 50.
  - **Review** is enabled when there is at least one row and no row has an error.
- **Step "review"** (read-only):
  - Shared copy-set summary: client, board, category, priority, assignee and team, additional agents, tags, checklist count with copy/skip, custom-field count, and "Status: board default". Show what is not copied in a single muted line: "Comments, time entries, attachments and due date are not copied."
  - The final list of `contact → title`.
  - Buttons: **Back** and **Create N tickets**.
- **Step "results":**
  - A created list with each row as `Link` → `/msp/tickets/<id>` reading "#number title".
  - A failed list showing each message.
  - **Retry failed (k)** resends only the failed rows with the same keys (B13). Created rows stay in the created list.
  - **Done** closes the dialog and calls `onCompleted`.
  - A top-level whole-request error, such as a permission error or a missing source, shows in the `Alert`, keeps the user on review, and nothing has been created.
- **Pending state.** While the action runs, disable every button and show "Creating N tickets…". Closing is blocked while pending.
- **Dismiss guard.** If rows exist and nothing has been created, closing asks for confirmation. Reuse the pattern used by `QuickAddTicket` and `BulkChangeStatusDialog` (see `QuickAddTicket.dismissGuard.test.tsx` and `BulkChangeStatusDialog.dismissGuard.test.tsx`).
- **Stable IDs.** Prefix every element with `batch-duplicate-` (`-template-input`, `-token-contact`, `-contact-picker`, `-add-blank-row`, `-row-${key}-title`, `-row-${key}-remove`, `-copy-checklist`, `-review-button`, `-create-button`, `-retry-button`).
- **i18n.** Add `batchDuplicate.*` keys to `server/public/locales/en/features/tickets.json` and the other locales by repo convention (`de es fr it nl pl pt sv`, plus the `xx`/`yy` pseudo-locales). Then run `node scripts/validate-translations.cjs`. Use `t('…', { count })` plurals for "Create {{count}} tickets" and "Retry failed ({{count}})".

### 6. Entry points

- **Ticket detail header** (`packages/tickets/src/components/ticket/TicketDetails.tsx:3651-3663`). Keep the one-click **Duplicate** button exactly as it is, because the single-copy loop must not get slower. Next to it, add a narrow outline `Button` with a `ChevronDown` that opens a `DropdownMenu` with one item, **Duplicate for contacts…** (`Users` icon, `id={`${id}-batch-duplicate-menu-item`}`). The ui package has no split-button component. Add `const [batchDuplicateOpen, setBatchDuplicateOpen] = useState(false)` and render `<BatchDuplicateTicketDialog sourceTicketId={ticket.ticket_id} …/>`. In `onCompleted`, refresh the activity timeline (the source has new `DUPLICATED_TO` rows) through the same refresh the page uses after other mutations.
- **Ticket list row menu** (`packages/tickets/src/components/ticketActionsColumn.tsx`):
  - Add `onBatchDuplicate: (ticketId) => void` to the options and a second `DropdownMenuItem` with `id="batch-duplicate-ticket-menu-item"`. Keep the click `stopPropagation`, for the same reason documented at `:57-59`.
  - In `TicketingDashboard.tsx:1643-1650`, wire it to `setBatchDuplicateSourceId(ticketId)`, render the dialog once at dashboard level, and add the setter to the memo deps.
  - In `onCompleted`, refresh the list the same way the bulk dialogs do after a bulk action.
  - `ticketActionsColumn.columnFit.test.tsx` must stay green: the column width does not change.
- **AlgaDesk mode.** Show the batch entry in both modes. It is not routed through `buildCreateTicketHref`, so `isAlgaDeskMode` is not involved.
- **Bulk bar**: not changed (B12).

### 7. Activity timeline

`TicketActivityTimeline.tsx` and `bento/BentoTimelineTile.tsx` already render `TICKET_DUPLICATED_FROM` and `TICKET_DUPLICATED_TO` from the single-Duplicate work. The new `batch_id` detail is ignored by them. Make no rendering change in v1 beyond checking the 12 rows display correctly (see Risks).

## Tests

**Unit (vitest, `packages/tickets`)**

1. `src/lib/__tests__/titleTokens.test.ts`:
   - `findUnknownTokens` on known and unknown sets;
   - whitespace inside braces;
   - repeated tokens;
   - `substituteTokens` throws on an unknown token;
   - `hasTokens`.
2. `src/lib/recurring/__tests__/titleTemplate.test.ts` passes unchanged after the move.
3. `src/lib/__tests__/duplicateTitle.test.ts` covers token substitution:
   - `Onboard {{contact}}` with "Jane Doe" renders "Onboard Jane Doe";
   - `{{ contact }} – {{client}}` renders both tokens;
   - `{{contact}}` with no contact returns `contact_required`;
   - `{{contat}}` returns `unknown_token` with `['contat']`;
   - a template with no tokens is returned unchanged;
   - `validateDuplicateTitle` returns `empty` for an empty or whitespace title and `unresolved_token` for a title containing `{{x}}`.
4. `src/components/ticket/__tests__/BatchDuplicateTicketDialog.test.tsx` (mock harness as in `QuickAddTicket.duplicate.test.tsx`):
   - selecting 3 contacts gives 3 rows with titles rendered from the template;
   - editing the template updates rows that have not been edited but not rows that have;
   - a blank row with `{{contact}}` blocks Review with a row error;
   - the cap of 50 is enforced;
   - review lists the shared copy set and the final titles;
   - Create calls `duplicateTicketBatch` with `{ key, contactId, title }[]` and `copyChecklist`;
   - a partial-failure result shows the created links and the failed messages, and Retry resends only the failed keys;
   - a whole-request error keeps the user on review with the `Alert`;
   - a loader permission error disables the dialog.
5. `ticketActionsColumn` test: the second menu item calls `onBatchDuplicate` and does not trigger the row click.

**Integration (real DB; extend `server/src/test/integration/ticketDuplicate.integration.test.ts`, or add `ticketDuplicateBatch.integration.test.ts` with the same seeding and `createAuthModuleMock`)**

6. **Happy path, the acceptance case.** Seed a source with:
   - a contact;
   - a checklist of 3 items, one of them completed;
   - `custom_fields`;
   - a team;
   - 2 additional agents;
   - 2 tags;
   - system attributes (`watch_list`, `sla_*`, `source_reference`).

   Batch it to 12 contacts of the same client, with titles rendered from `Onboard {{contact}}`. Assert, for each of the 12 tickets:
   - its own number;
   - the correct `contact_name_id`;
   - the correct title;
   - the board's default status;
   - 3 checklist items, all unchecked, in source order;
   - `custom_fields` present and no system attributes;
   - the team, agents and tags;
   - `duplicated_from_ticket_id` set to the source;
   - a `TICKET_DUPLICATED_FROM` row carrying `batch_id`.

   The source has 12 `TICKET_DUPLICATED_TO` rows with the same `batch_id`.
7. **Partial failure:**
   - The batch includes one contact from another client and one title containing `{{contact}}`. Those two land in `failed` with messages. The rest are created. Nothing is written for the failed copies: no ticket, and no activity on the source.
   - Make a copy fail inside its transaction, for example by mocking `copyChecklistFromSource` to throw on the 3rd call. That copy's ticket is rolled back, and copies 1–2 and 4–N exist.
8. **Permissions:**
   - without `ticket:create`, the whole request is refused and 0 tickets are created;
   - without row-level read on the source, the request is refused with "Cannot view ticket" and 0 created;
   - a client-portal user is refused;
   - a missing or other-tenant source returns "Source ticket not found";
   - 0 copies, 51 copies and duplicate keys are each refused with a validation error and 0 created.
9. **Source deleted mid-batch:** delete the source after the preflight (through a hook or mock between copies). The remaining copies fail with "Source ticket not found", and the copies already made remain.
10. **Single-Duplicate regression:** the existing `ticketDuplicate.integration.test.ts` cases pass unchanged after the step 2 extraction.
11. `copyChecklist: false` copies no source checklist items. Auto-applied templates still apply.

**Contract tests that must stay green:**

- `ticketActions.suppressionMirror.contract.test.ts`;
- `ticketOriginCreatePath.test.ts`;
- `optimizedTicketActions.tenantScopedAuth.contract.test.ts`;
- `QuickAddTicket.i18n.test.ts`;
- `TicketingDashboard.i18n.test.ts`;
- `ticketActionsColumn.columnFit.test.tsx`.

**Manual smoke** (dev server at the card's `devOrigin`): from a Joymode-like source with a checklist, run Duplicate for contacts with 12 contacts and `{{contact}}`, then open three copies and check the contact, title, unchecked checklist and "Duplicated from #N". Run it again from the list row menu. Force a failure: pick a contact, delete it from another tab, then press Create. That copy fails with the contact error and the rest are created. Use Retry after removing the row. Check that single Duplicate still works in one click.

## Not doing (follow-ups)

- **Moving `addTicket` onto `createTicketWithSideEffects`**, which would put single Duplicate's team, agents and tags into the same transaction. Single Duplicate does not need it for this feature. `addTicket` is pinned by source-text contract tests and drives every quick-add, so the move needs its own change. The existing `LEVERAGE: pattern ticket-create-composition` marker stays.
- **Per-copy devices (assets) or internal users.** The row model leaves room for `assetId`. Add it when there is a driver for "one per device".
- **Tokens in the description** (B5).
- **Editing shared fields in the batch dialog** (B2).
- **Duplicating a ticket into a different client.**
- **Timeline grouping by `batch_id`**, for example "duplicated 12 times".
- **Bulk-bar duplicate of N selected tickets** (B12).
- **Batch duplicate on the client and contact ticket tabs** (`MspClientTickets`, `MspContactTickets`).
- **Background or async execution beyond 50 copies.**
- **Client portal or API endpoint.**

## Risks

- **R1: two creation compositions for duplicates.** Single Duplicate goes through `addTicket` and batch goes through `createTicketWithSideEffects`. The duplicate-specific parts are shared (step 2), but the parts outside them could drift, for example the `CREATED` activity details or the SLA event publisher. Integration test 6 asserts the same observable copy set as the single-Duplicate test. The follow-up that moves `addTicket` onto the shared composition removes the risk. Add a `// LEVERAGE: pattern ticket-create-composition` marker at the new call site that points to it.
- **R2: request duration.** 50 sequential creates, each with checklist, team, agents and tags, could take several seconds. The UI shows a pending state and blocks closing. If the server-action timeout becomes a problem in practice, the follow-up is a background job.
- **R3: event fan-out.** Each copy publishes `TICKET_CREATED`, `TICKET_ASSIGNED` and any agent events, so the assignee gets N notifications. That is correct (N tickets), but noisy. Notification suppression stays off by default, the same as single Duplicate. A "don't notify assignee" option is left until someone asks for it.
- **R4: contact state between picking and creating.** The server only checks that the contact belongs to the source client, so an inactive contact is accepted. This matches `addTicket`, which does not check contact activity either.
- **R5: titles are rendered on the client.** A tampered client could send arbitrary titles. That is no worse than single Duplicate, where the client sends the title. The server still enforces the title checks, the contact-to-client check, permissions and row-level read.
- **R6: `ticketBulkFailureMessage` masks unexpected errors** with the fallback text. The raw error is logged on the server. Expected errors such as permission and validation messages pass through as they are.
- **R7: moving the token engine** could change recurring behaviour. The recurring tests run unchanged as the guard.
