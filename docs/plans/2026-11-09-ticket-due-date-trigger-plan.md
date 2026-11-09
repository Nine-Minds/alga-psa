# Ticket due date, recurring provenance, and a `ticket.due_date` date trigger

Customer: Joymode Business Solutions, PSA ticket alga-2026-0002909 (multi-stage renewal reminders off a
recurring ticket's due date). This plan covers the general enabler only; the full milestone feature is
tracked separately on the 2.0 project.

Branch: `feature/workflow-ticket-due-date-trigger-recurring-prove`. At the time of writing the branch is
identical to `main` (`0184722cd6`); none of what follows is implemented yet.

## 1. What exists today

| Concern | Where | Current behaviour |
|---|---|---|
| Ticket due date storage | `tickets.due_date` (`timestamptz`, nullable; `server/migrations/202501060000_add_due_date_to_tickets.cjs`) | Written by the ticket UI (`packages/tickets/src/actions/ticketActions.ts`), the REST API, `TicketModel.createTicket`/`updateTicket`, the recurring generator, and the SLA services (`packages/sla/src/services/slaService.ts:649`, `slaPauseService.ts:197`), which move it together with `sla_resolution_due_at` when it was auto-filled from SLA. No index on it. |
| Ticket origin | `tickets.ticket_origin` (text, default `internal`; `20260209160000_add_ticket_origin_to_tickets.cjs`) | Values from `TICKET_ORIGINS` (`packages/types/src/interfaces/ticket.interfaces.ts:19`): `internal`, `client_portal`, `inbound_email`, `api`, `recurring`. |
| Recurring provenance | `recurring_ticket_occurrences` (`20261002110000_create_recurring_tickets.cjs`) | One row per `(definition_client_id, occurrence_date)`, with `definition_id`, `occurrence_id`, `occurrence_date`, `due_date` (date), `due_at`, `status`, `ticket_id` (no FK), indexed on `(tenant, ticket_id)`. The ticket itself carries only `ticket_origin = 'recurring'` and `source = 'recurring_ticket'`. |
| Recurring generator | `packages/tickets/src/lib/recurring/generateRecurringTicketsForTenant.ts:329-436` | Claims the occurrence row first (so `occurrenceId` is known), then calls `instantiateTicketTemplate(... origin: { ticket_origin: 'recurring', source }, dueDate: candidate.dueAt)`, then writes `ticket_id` onto the occurrence row. `candidate.dueAt` is the definition's due date at its due time in the tenant timezone. The ticket is created `lead_days` before the due date (`candidateOccurrences.ts:52`; `lead_days` 0..365, default 0). |
| TICKET_CREATED schema | `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts:47` | No due date, origin or recurring ids. |
| TICKET_CREATED emitters | `shared/models/ticketModel.ts:1218` (the main path: UI, inbound email, workflows, generator via `createTicketWithSideEffects`); `buildApiTicketCreatedPayload` (REST `TicketService`); `buildRmmTicketCreatedPayload`; `buildInboundPublisherTicketCreatedPayload` (`shared/lib/tickets/ticketWorkflowEventPayloads.ts`) | `TicketModel` passes `source`, `board_id`, `priority_id`, `client_id`, requester names, plus creator extras. `createTicketWithSideEffects` (`shared/services/tickets/createTicketWithSideEffects.ts:212`) adds suppression flags and actor provenance through `TicketModelEventPublisher`'s `ticketCreatedPayload`. |
| `tickets.find` | `shared/workflow/runtime/actions/businessOperations/tickets.ts:1537` (`ticketSummarySchema`), `:1675` (action) | Returns ids, display names, `entered_at`/`updated_at`/`closed_at`, `is_closed`, `response_state`, optional `attributes`. No `due_date`, no `ticket_origin`, no recurring ids. It is the only ticket read action in the runtime. |
| `tickets.update_fields` | same file, `:734` | Accepts `patch.due_date` and writes it to **`attributes.due_date`**, never to the `tickets.due_date` column (`:770`, `:851`, `:872`, `:952`). |
| Date trigger sources | definitions: `packages/event-schemas/src/schemas/domain/dateTriggerSourceDefinitions.ts`; payload schemas: `dateTriggerPayloadSchemas.ts`; queries: `packages/jobs/src/lib/dateTriggers/sources/*` registered in `registry.ts`; launcher: `ee/packages/workflows/src/lib/dateTriggerLauncher.ts` | Six sources, none keyed on a ticket date. Window sources are scanned over `today - offset - 3 .. today - offset`; a fire date more than 3 days in the past is skipped; the fire key is `date:{workflowId}:{source}:{entityId}:{occursOn}:{offsetDays}`. |

## 2. Mismatches between the card and the code

These change the shape of the work and need a decision from the captain where marked.

1. **`tickets.update_fields` writes the wrong place.** A workflow that sets a due date today stores it in
   `attributes.due_date`; the UI, SLA, the generator and every report read the column. A workflow-set due
   date is therefore invisible everywhere except to another workflow reading attributes. The trigger and
   the new read fields must use the column, so `update_fields` must be changed to write the column (§5).
2. **The done-when only holds for definitions with `lead_days >= 57`.** A recurring ticket does not exist
   until `lead_days` before its due date. With an offset of -60 the fire date is due - 60; the launcher's
   lookback is 3 days, so the ticket must exist by due - 57. With the default `lead_days = 0` a -60 trigger
   never fires for a recurring ticket. This is window-mode behaviour working as designed, not a bug in the
   new source. Joymode's schedule must create renewal tickets at least 60 days ahead (lead_days 60), or the
   requirement moves to a trigger keyed on the recurring schedule's upcoming occurrences, before any
   ticket exists. That second source is out of scope here (§9). **Decision for the captain:** accept
   "configure lead_days >= offset" as the answer for Joymode, or scope the occurrence-keyed source in.
3. **Recurring ids cannot be read back at TICKET_CREATED time.** The generator writes `ticket_id` onto
   the occurrence row *after* the ticket (and its TICKET_CREATED payload) is built. A lookup by ticket id
   inside the create path finds nothing. The ids must be passed down from the generator (§4.2).
4. **There are four TICKET_CREATED emitters, not one.** Adding the fields to the `TicketModel` path covers
   UI, inbound email, workflow-created and recurring tickets. The REST builder and the RMM builder are
   separate and must be extended separately (§4.2).
5. **Multi-stage reminders are N workflows.** A date trigger has exactly one `offsetDays`, so -60/-30/-7
   reminders are three workflows (or three published versions of a template). Several offsets on one
   trigger is not part of this card (§9).
6. **The SLA services move `tickets.due_date`.** When the due date was auto-filled from the SLA resolution
   deadline, pausing/resuming SLA or changing priority shifts it. Under the "a changed due date is a new
   occurrence" rule, that produces a fresh firing for the new date. Recurring tickets get an explicit due
   date from the schedule, so they are only affected if it happens to equal the SLA deadline to within a
   minute. Called out so nobody mistakes it for a duplicate-fire bug.
7. **No index on `tickets.due_date`.** The new source scans tickets by `(tenant, due_date)` once per
   published workflow per tick. It needs an index (§6.4).

## 3. Shared shape: recurring provenance

The same three facts appear in the event payload, in `tickets.find`, and in the date-trigger payload.
They are produced by one loader and one zod fragment, not three hand-written copies.

- **Loader** `loadTicketRecurringProvenance(db, tenant, ticketIds)` in
  `packages/tickets/src/lib/recurring/ticketRecurringProvenance.ts`: reads
  `recurring_ticket_occurrences` where `ticket_id IN (...) AND status = 'created'` (uses the existing
  `(tenant, ticket_id)` index) and returns `Map<ticketId, { definitionId, occurrenceId, occurrenceDate }>`.
  `occurrenceDate` is the nominal (unadjusted) schedule date, `YYYY-MM-DD`. Used by `tickets.find`
  (single id) and as a left join shape in the date-trigger query (the query joins directly; the loader
  documents the rule "the created occurrence row is the provenance").
- **Rule for more than one row:** an occurrence row's `ticket_id` is only set on the `created` path and
  each occurrence creates at most one ticket, so one row per ticket is expected. If a data repair ever
  produces two, take the one with the latest `due_at`; do not error.
- **Zod fragment** in `packages/event-schemas/src/schemas/domain/commonEventPayloadSchemas.ts`:

  ```ts
  export const ticketRecurrenceSchema = z.object({
    definitionId: withWorkflowPicker(z.string(), 'Recurring schedule', 'recurring-ticket-definition'),
    occurrenceId: z.string().describe('Recurring occurrence ID (one per scheduled date)'),
    occurrenceDate: dateOnlySchema('Scheduled date of the occurrence (YYYY-MM-DD)').optional(),
  }).describe('Set when the ticket was generated by a recurring schedule');
  ```

  No `recurring-ticket-definition` picker kind exists today. Until one does, `definitionId` is a plain
  described `z.string()`; adding the picker is a separate change and not needed for the done-when.

## 4. TICKET_CREATED payload

### 4.1 Schema additions (`ticketEventSchemas.ts`, `ticketCreatedEventPayloadSchema`)

All additive and optional, so existing payloads, stored runs and simulations stay valid.

| Field | Type | Meaning |
|---|---|---|
| `dueDate` | `z.string().datetime({ offset: true }).nullable().optional()` | `tickets.due_date` as an ISO 8601 instant; `null` when the ticket has none. |
| `ticketOrigin` | `z.enum(['internal','client_portal','inbound_email','api','recurring']).or(z.string()).optional()` | The stored `ticket_origin`. The enum documents the known values for the designer; the `.or(z.string())` keeps a future origin from failing validation of a live event. |
| `recurrence` | `ticketRecurrenceSchema.optional()` | Present only when `ticketOrigin === 'recurring'`. |

Naming follows the rest of the ticket event schemas (camelCase: `ticketId`, `clientName`). The card's
`due_date` / `ticket_origin` / `definition_id` / `occurrence_id` are the database names; workflow-facing
names in event payloads are camelCase, and `tickets.find` output (§5) keeps its existing snake_case.

The static catalog row for TICKET_CREATED in `ee/packages/workflows/src/models/eventCatalog.ts:265`
lists only `tenantId`, `ticketId`, `userId` and actor fields; add `dueDate`, `ticketOrigin` and
`recurrence` there so the catalog view matches the zod schema.

### 4.2 Emitters

- **`TicketModel.createTicket`** (`shared/models/ticketModel.ts:1218`): add
  `dueDate: cleanedInput.due_date ? new Date(cleanedInput.due_date).toISOString() : null` and
  `ticketOrigin: cleanedInput.ticket_origin || TICKET_ORIGINS.INTERNAL` (the same default the column
  builder at `:585` applies) to `metadata`. This covers every caller that goes through the model.
- **Recurring ids**: extend `InstantiateTicketTemplateInput.origin` to
  `{ ticket_origin; source; recurrence?: { definitionId; occurrenceId; occurrenceDate } }`; the generator
  passes `{ definitionId: definition.definition_id, occurrenceId, occurrenceDate: candidate.nominal }`
  (all known before the ticket is created). `instantiateTicketTemplate` forwards it as a new
  `CreateTicketWithSideEffectsInput.eventPayload?: { recurrence?: ... }`, which
  `createTicketWithSideEffects` merges into `eventExtras` beside suppression and actor provenance. No
  database read in the create path.
- **REST** (`buildApiTicketCreatedPayload`, called from `TicketService.ts:2112`): add `dueDate` and
  `ticketOrigin` inputs. The REST service creates tickets with origin `api`; pass what it stored.
- **RMM** (`buildRmmTicketCreatedPayload`): add `ticketOrigin` and `dueDate` only if the RMM ticket
  creation sets them; otherwise leave it, and the fields stay absent (they are optional).
- **Inbound outbox** (`buildInboundPublisherTicketCreatedPayload`): spreads `data.metadata`, which comes
  from `TicketModel`, so it picks the fields up with no change. Verify in the contract test.

## 5. `tickets.find` and `tickets.update_fields`

### 5.1 `ticketSummarySchema` additions

| Field | Type | Source |
|---|---|---|
| `due_date` | `isoDateTimeSchema.nullable().describe('Due date')` | `tickets.due_date`, ISO instant |
| `ticket_origin` | `z.string().nullable().describe('Where the ticket came from (internal, client_portal, inbound_email, api, recurring)')` | `tickets.ticket_origin` |
| `recurrence` | `z.object({ definition_id, occurrence_id, occurrence_date }).nullable().describe('Recurring schedule that generated the ticket')` | `loadTicketRecurringProvenance`, queried only when `ticket_origin = 'recurring'` |

Backward compatibility: purely additive. `ticketSummarySchema` is a non-strict `z.object`, so callers that
ignore the new keys are unaffected; saved workflows that read existing fields keep their types. The
designer's output-type inference shows the new fields automatically. No action version bump is needed
(the schema only grows).

Workflows that previously set a due date through `update_fields` stored it in `attributes.due_date`;
they keep reading it via `include.attributes` until §5.2's backfill runs, and afterwards `due_date` is
the right field. `due_date` does **not** fall back to `attributes.due_date`: one field, one meaning.

### 5.2 `tickets.update_fields`

- `patch.due_date` writes the column: pass `due_date` to `TicketModel.updateTicket` (which already accepts
  it, `ticketModel.ts:271`) and stop writing `mergedAttributes.due_date`. Note that `update_fields` calls
  `updateTicket` with no event publisher (`tickets.ts:886-894`), so it emits status/assignment transitions
  through `publishTicketTransitionsAfterCommit` but no TICKET_UPDATED. That is true of every field it
  patches today, and this card leaves it as is (§9).
- Change the field description to "Due date" (drop "stored in ticket.attributes.due_date").
- `before.due_date` / `after.due_date` in the run audit read the column.
- Add `due_date: isoDateTimeSchema.nullable()` to the output schema.
- **Backfill migration** (`server/migrations/2026110912xxxx_backfill_ticket_due_date_from_attributes.cjs`,
  `transaction: false` for Citus): for tickets where `due_date IS NULL` and
  `attributes->>'due_date'` is a valid timestamp, copy it into the column. Leave the attribute key in
  place so a workflow still reading `attributes.due_date` keeps working. Rows whose attribute does not
  parse are left alone and counted in the migration log.
- Retain-authority (`retainWorkflowTicketAuthority`) already receives the patch keys; `due_date` is
  among them, no change.

## 6. The `ticket.due_date` date-trigger source

### 6.1 Definition (`dateTriggerSourceDefinitions.ts`)

```ts
{
  id: 'ticket.due_date',
  labelKey: 'designer.form.dateSourceTicketDueDate',
  defaultLabel: 'Ticket due date',
  payloadSchemaRef: 'payload.TicketDueDate.v1',
  mode: 'window',
  // Once per (ticket, due date): the fire key includes occursOn, so a changed due date is a new
  // occurrence and an unchanged one never fires twice.
  recurrence: 'once',
  hasParams: false,
  usesOffset: true,
}
```

No `domainEvent` (no upcoming-due-date domain event is wanted) and no `catalogEventType` (the source
documents its payload through the payload schema like `contract.end`).

Everything derived from the definition list (zod `source` enum, schema ref map, designer source picker,
schema policy) picks it up. Hand-written per-source tables that must also gain an entry:
- `shared/workflow/runtime/dateTriggerOccurrence.ts` `DATE_TRIGGER_OCCURRENCE_RULES`:
  `{ recordKind: 'ticket', payloadDateField: 'dueDate', fromRecord: r => ... toIsoDateOnly(r.due_date) }`,
  filling `ticketId`, `ticketNumber`, `title`, `ticketOrigin` for the Run dialog test payload.
- `ee/server/src/components/workflow-designer/workflowRunDateTrigger.ts` `SOURCE_DATE_NAMES`:
  `'ticket.due_date': { key: 'runDialog.dateTrigger.dateNames.ticketDueDate', defaultValue: "the ticket's due date" }`.
- Locale strings `designer.form.dateSourceTicketDueDate` and `runDialog.dateTrigger.dateNames.ticketDueDate`
  in `server/public/locales/*/msp/workflows.json` (en, de, es, fr, it, nl, pl, pt, xx).

### 6.2 Payload schema `payload.TicketDueDate.v1` (`dateTriggerPayloadSchemas.ts`)

```ts
'payload.TicketDueDate.v1': z.object({
  ...common,                          // occursOn, fireDate, offsetDays, clientId?, clientName?
  ticketId,
  ticketNumber: z.string(),
  title: z.string(),
  dueDate: dateOnlySchema('Due date in the tenant timezone (YYYY-MM-DD)'),
  dueAt: z.string().describe('Due date and time (ISO 8601 timestamp)'),
  statusId: ticketStatusId,
  statusName: z.string(),
  boardId,
  boardName: z.string(),
  priorityId: withWorkflowPicker(z.string(), 'Priority', 'ticket-priority').optional(),
  contactId: contactId.optional(),
  assignedUserId: assignedUserId.optional(),
  ticketOrigin: z.string().describe('Where the ticket came from (recurring for schedule-generated tickets)'),
  recurrence: ticketRecurrenceSchema.optional(),
}).passthrough(),
```

Like `TicketStatusAge.v1`, it carries everything a reminder step needs, so the workflow does not have to
call `tickets.find` before acting.

### 6.3 Query (`packages/jobs/src/lib/dateTriggers/sources/ticketDueDate.ts`)

Registered in `registry.ts`; `registry.test.ts` then requires it.

```
tickets t
  JOIN statuses s           ON (s.tenant, s.status_id) = (t.tenant, t.status_id)  AND s.is_closed = false
  LEFT JOIN boards b        ON (b.tenant, b.board_id)  = (t.tenant, t.board_id)
  LEFT JOIN clients c       ON (c.tenant, c.client_id) = (t.tenant, t.client_id)
  LEFT JOIN tenant_settings ts ON ts.tenant = t.tenant
  LEFT JOIN recurring_ticket_occurrences o
                            ON (o.tenant, o.ticket_id) = (t.tenant, t.ticket_id) AND o.status = 'created'
WHERE t.due_date IS NOT NULL
  AND t.due_date >= (:fromDate::date::timestamp AT TIME ZONE tz)
  AND t.due_date <  ((:toDate::date + 1)::timestamp AT TIME ZONE tz)
ORDER BY t.ticket_id
```

with `tz = COALESCE(ts.settings->>'timezone', 'UTC')`, exactly as `assetMaintenanceDue.ts` does.

- **Matching:** `occursOn = toTenantLocalDate(t.due_date, tz)`; `entityId = ticket_id`;
  `cycleKey = occursOn`; `clientId = client_id ?? ''`.
- **Closed tickets:** excluded through `statuses.is_closed`, the signal `ticket.status_age` and the
  recurring generator's skip policy already use. Not `tickets.is_closed`: it is only written for
  historical imports at create time (`ticketModel.ts:484`), so it is not the authoritative closed flag.
  A ticket reopened inside the window becomes eligible again; the fire key stops a second firing for the
  same date.
- **Timezone:** the due date is an instant; the occurrence date is its tenant-local calendar date. The
  launcher then compares `fireDate = occursOn + offsetDays` with the workflow's local today (trigger
  `timezone`, else the tenant's). This is the same split every existing window source uses.
- **Due-date edits:** the fire key is `date:{workflowId}:ticket.due_date:{ticketId}:{occursOn}:{offset}`.
  - Moved to another calendar day → new key → fires once for the new date when its fire date comes round.
  - Moved within the same day (time only) → same key → no second firing.
  - Moved back to a date that already fired → same key → no second firing.
  - Cleared → no longer matched; nothing fires.
- **Missed windows:** a fire date more than 3 days in the past is skipped by the launcher, never
  back-filled. This covers tickets created or given a due date after their fire date (see §2.2), due
  dates moved earlier past the fire date, and scheduler outages longer than 3 days.
- **Volume:** `MAX_LAUNCHES_PER_TICK` (500 per tenant) applies as for all sources.

### 6.4 Index

New migration, `transaction: false` (Citus distributed table):

```sql
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_due_date
  ON tickets (tenant, due_date) WHERE due_date IS NOT NULL;
```

## 7. Consuming it in workflows

Recurring-only reminder, 60 days out (trigger `{ type: 'date', source: 'ticket.due_date', offsetDays: -60 }`):

```json
{ "type": "control.if",
  "condition": { "$expr": "payload.ticketOrigin = 'recurring'" },
  "then": [ "... send reminder to payload.contactId / payload.assignedUserId ..." ] }
```

Limit to one schedule: `payload.recurrence.definitionId = '<definition id>'`.

From a TICKET_CREATED workflow: `payload.ticketOrigin = 'recurring' and $exists(payload.dueDate)`.

From any workflow holding a ticket id: `tickets.find` → `vars.ticket.due_date`,
`vars.ticket.ticket_origin`, `vars.ticket.recurrence.definition_id`.

Multi-stage (Joymode): three published workflows with offsets -60, -30 and -7, each with its own
condition and message. The recurring schedule must have `lead_days >= 60` (§2.2).

Expressions are JSONata (`shared/workflow/runtime/expressionEngine.ts`): equality is `=`, conjunction is
`and`, and `$exists()` tests for an absent optional field.

## 8. Tests

| Layer | File | Asserts |
|---|---|---|
| Schema | `packages/event-schemas` ticket schema tests | TICKET_CREATED accepts payloads with and without `dueDate`/`ticketOrigin`/`recurrence`; rejects a malformed `recurrence`; unknown origin string passes. `payload.TicketDueDate.v1` accepts a full payload, rejects a non-date `dueDate`. |
| Source registry | `packages/jobs/src/lib/dateTriggers/registry.test.ts` | Unchanged test; must pass with the new definition and query. |
| Designer | `ee/server/src/components/workflow-designer/__tests__/dateTriggerPayloadSchemas.test.ts`, `dateTriggerSwitch.test.ts` | New source appears in the picker with its payload schema; switching to it sets the schema ref. |
| Run dialog | `shared/workflow/runtime` occurrence rule tests | `fromRecord` with a ticket record yields `occursOn` = due date, `dueDate` payload field. |
| Emitter contract | `server/src/test/unit/workflow-event-contracts` | `TicketModel` path, REST path and inbound path TICKET_CREATED payloads validate and, for a recurring create, `expectFields` pins `ticketOrigin = 'recurring'` and `recurrence.occurrenceId`. |
| Generator | `packages/tickets` recurring generator integration test | Generated ticket has `due_date = dueAt`, `ticket_origin = 'recurring'`; captured TICKET_CREATED carries `recurrence.{definitionId, occurrenceId, occurrenceDate}` matching the occurrence row. |
| `tickets.find` | runtime action tests | Returns `due_date`, `ticket_origin`; `recurrence` set for a generated ticket, `null` otherwise. |
| `tickets.update_fields` | runtime action tests | `patch.due_date` updates the column, not attributes; output and audit show it; `null` clears it. |
| Backfill | migration unit test | Copies a valid `attributes.due_date` only where the column is null; leaves unparsable values. |
| Trigger query | `ee/server/src/__tests__/integration/dateTriggerSources.integration.test.ts` | Open ticket due inside the window is found with the tenant-local `occursOn`; closed-status ticket excluded; ticket without due date excluded; due date at 23:30 in a non-UTC tenant lands on the local date; recurring ticket carries `recurrence`, others do not. |
| Launcher | `ee/packages/workflows/src/lib/dateTriggerLauncher.test.ts` | Same ticket/date/offset fires once across repeated ticks; changing the due date to a later day fires again; fire date 4+ days in the past does not fire. |
| End to end | new integration test (`ee/server/src/__tests__/integration/ticketDueDateTrigger.integration.test.ts`) | Recurring definition with `lead_days = 60`; generator creates the ticket; workflows at -60 and -30 with `payload.ticketOrigin = 'recurring'` condition; run `dateTriggerScanHandler` with `now` at due-60 → one -60 run whose payload has `recurrence.definitionId`; again at due-30 → one -30 run; close the ticket, scan at due-7 for a -7 workflow → no run. A second definition with `lead_days = 0` and a -60 workflow → no run (documents §2.2). |

## 9. Not in this card

- A trigger keyed on a recurring schedule's upcoming occurrences, before a ticket exists (the
  `lead_days < |offset|` case).
- Several offsets on one date trigger (multi-stage in one workflow).
- Back-filling missed fire dates beyond the 3-day lookback, or firing immediately for a ticket created
  after its fire date.
- An upcoming-due-date domain event (`domainEvent`) for tickets.
- A `due_date` input on the `tickets.create` workflow action.
- TICKET_UPDATED from `tickets.update_fields` (it emits none for any field today), and due-date fields
  on TICKET_UPDATED beyond the `changes.due_date` a UI edit already produces.
- Changing the SLA services' due-date syncing (§2.6).
- The Joymode-specific milestone feature tracked on the 2.0 project.
