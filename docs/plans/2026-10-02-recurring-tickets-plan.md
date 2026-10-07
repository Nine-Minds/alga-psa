# Plan: Recurring tickets (first-class, all editions)

Base: main @ 8845cc15e2, branch `feature/recurring-tickets-2`. All paths are relative to the worktree root.

## 1. Problem

MSPs want tickets for routine work, such as server patching, backup checks and maintenance visits, to be created automatically on a schedule. Each ticket should arrive already routed to the right board, status and assignee. The request came from community feedback and was well received.

Workflows can do this today, with a `recurring` trigger and a `tickets.create` step. That is not an adequate answer:

- **Most requesters cannot use workflows.** The workflow designer is a "Pro Feature" placeholder in CE (`packages/ee/src/workflows/entry.tsx`). On hosted it requires the Solo tier or higher (`TIER_FEATURES.WORKFLOW_DESIGNER`, `packages/types/src/constants/tierFeatures.ts:53`), so Essentials tenants do not have it.
- **It has the wrong shape.** It takes one workflow per recurring item and per client. The workflows are not visible from the client, show no "next due" date, and keep no per-client history.
- **Workflow-created tickets are incomplete.** `TicketModel.createTicket` publishes `TICKET_CREATED` only when an `eventPublisher` is passed (`shared/models/ticketModel.ts:987-1010`). The workflow `tickets.create` action (`shared/workflow/runtime/actions/businessOperations/tickets.ts:609-632`) passes none. As a result, no SLA is started, no notification is sent, no webhook fires and the ticket is not indexed for search.
- **Competing PSAs ship this as a core feature.** ConnectWise, Autotask, Halo and Syncro all do.

## 2. Decisions (settled in the design session)

| Topic | Decision |
|---|---|
| Availability | Every edition and tier: CE (pg-boss) and hosted Essentials, Solo and Pro (Temporal). It is not tier-gated. |
| Shape | A **definition** holds the ticket template and the schedule, and targets **many clients**. Each client can **override** some fields from day 1. |
| Timing | The occurrence date is the ticket's **due date**. The ticket is **created `lead_days` before it** (default 0). |
| Times | **Create at** (default `08:00`) on `due date − lead_days`. **Due at** (default `17:00`) on the due date. Both use the tenant's timezone. |
| Recurrence | **Daily:** every N days, with a weekdays-only option. **Weekly:** every N weeks, on chosen weekdays. **Monthly:** every N months, either on day X (or the last day) or on the Nth weekday (1st–4th or last). **Yearly:** month and day. A start date is required. The end is never, on a date, or after N occurrences. |
| Non-business days | A per-definition policy: `keep` (default), `previous` business day, or `next` business day. Business days come from the tenant's default business-hours schedule and holidays. |
| Previous ticket still open | A per-definition policy: `always_create` (default) or `skip`. Skips are recorded in run history. |
| Client email on creation | A per-definition toggle, **off by default**. When off, contact-facing "ticket created" emails are suppressed. Internal notifications (assignee, team, SLA) still go out. |
| Origin and creator | A new `ticket_origin = 'recurring'`. The ticket is created by the **system** (`entered_by` null, SYSTEM actor). |
| Template fields | Title with tokens (`{{client}}`, `{{due_date}}`, `{{month}}`, `{{year}}`). Description (rich text). Board → status. Priority. Category and subcategory. Assigned user, team and additional agents. Tags. Checklist template. |
| Per-client | **Overrides:** board/status, priority, category, assignment. **Client-only fields:** contact, location, linked assets. |
| UI | The Tickets nav gains sub-items **All Tickets** and **Recurring**, following the Projects pattern. Recurring has a definitions list and an editor (template, schedule, clients with overrides, run history, preview of the next 5 due dates). The client detail page gets a **Recurring tickets** section. Generated tickets show a **Recurring: \<name\>** badge that links to the definition. |
| Lifecycle | Edits affect future tickets only. A definition, or a single client within it, can be paused. Resuming, a past start date, and adding a client never backfill. An occurrence is created only while `create_at ≤ now < due_at`; one whose due time has already passed is logged as **missed**. A **failed** occurrence (for example, a deleted board or an inactive user) is logged with its reason and retried on every sweep until its due time; the list then shows a warning. Deleting a definition archives it. |
| Permissions | A new `recurring_ticket` resource with read, create, update and delete. **PSA:** Admin, Manager and Dispatcher get all four; Technician gets read. **AlgaDesk:** Admin gets all four; Agent gets read. |

## 3. Grounding in existing code

- **Scheduler.**
  - The CE legacy `JobScheduler.scheduleRecurringJob` turns any cron containing `*` into "once per 24h" (`server/src/lib/jobs/jobScheduler.ts:191-196`), so it **must not be used**.
  - Use the job-runner path instead, `PgBossJobRunner.scheduleRecurringJob`, which honours the real cron (`server/src/lib/jobs/runners/PgBossJobRunner.ts:320-445`). `scheduleDateTriggerScanJob` already uses it (`server/src/lib/jobs/index.ts:1051-1061`).
  - EE uses `MAINTENANCE_FANOUT_SCHEDULES` (`packages/types/src/constants/maintenanceFanoutSchedules.ts:19-64`) together with the per-tenant fan-out registry (`packages/jobs/src/lib/maintenanceJobFanout.ts`).
  - Handlers that need domain code register in `server/src/lib/jobs/registerServerMaintenanceJobs.ts`, with names in `serverMaintenanceJobNames.ts`.
- **Ticket creation.**
  - `TicketModel.createTicket(input, tenant, trx, validationOptions, eventPublisher?, …)` is at `shared/models/ticketModel.ts:863`.
  - It requires a title, `board_id`, `client_id` and `priority_id`. A missing `status_id` defaults to the board's default status.
  - It auto-applies matching checklist templates (:973-985).
- **Session-free building blocks:**
  - `addTicketResourceCore` (`packages/tickets/src/lib/ticketResourceCore.ts:50`)
  - `assignTeamToTicketCore` (`packages/tickets/src/lib/teamAssignmentCore.ts:42`)
  - `TagModel.getOrCreateTagDefinition` / `createTagMapping` (`shared/models/tagModel.ts:193,250`)
  - `associateAssetWithTicket` (`shared/services/assets/assetTicketAssociation.ts:4`)
  - `applyChecklistTemplateToTicket` (`shared/lib/ticketChecklists/applyTemplates.ts:65`)
  - `writeTicketActivity` (`shared/lib/ticketActivity/writeTicketActivity.ts:103`)
  - `TicketModelEventPublisher` (`packages/tickets/src/lib/adapters/TicketModelEventPublisher.ts`). It publishes after commit, with a SYSTEM actor when no `userId` is given.
- **Client email on create.** `handleTicketCreated` (`server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts:935`) ignores the suppression flags. The update, assigned, comment and closed handlers honour them. `ticketCreatedEventPayloadSchema` (`packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts:31-51`) does not include `suppressionFlagsSchema` (:24-29).
- **Recurrence.**
  - `shared/utils/recurrenceUtils.ts` is tied to schedule entries.
  - It has no nth-weekday support and no timezone, and it anchors on the server's local time.
  - Nothing in the repo uses rrule's `nth`/`bysetpos`. The installed rrule is 2.8.1.
- **Business days.**
  - The day-classification logic lives in `ee/packages/workflows/src/lib/workflowBusinessDayScheduling.ts:93-158`: holiday first, then `is_24x7`, then the enabled `business_hours_entries` row for that weekday.
  - None of its imports are EE-only.
  - Tenants are **not** seeded with a default `business_hours_schedules` row (`server/migrations/20260219000002_create_business_hours.cjs`).
- **Origin.**
  - `TICKET_ORIGINS` is defined at `packages/types/src/interfaces/ticket.interfaces.ts:18-27`, with a duplicate copy in `shared/models/ticketModel.ts:17-22`.
  - It is normalized in `packages/tickets/src/lib/ticketOrigin.ts:55-82`, where unknown values become `'other'`.
  - The badge is `packages/tickets/src/components/TicketOriginBadge.tsx`.
  - The column has no DB check constraint.

## 4. Design

### 4.1 Layering

```
Tickets ▸ Recurring pages, client-page section, ticket badge     (application)
recurring-ticket actions + generator sweep                      (orchestration)
createTicketWithSideEffects (session-free ticket composition)   (domain service — new layer)
recurrence engine + business-day calendar (pure, shared)        (engine — new / extracted)
recurring_ticket_* tables, tickets, business hours, holidays    (data)
```

Two new lower layers are introduced. Both exist because the feature would otherwise re-derive logic that is already scattered:

1. **`shared/lib/recurrence/`**: a pure, timezone-correct, date-level recurrence engine.
   - Its rule type (`RecurrenceRule`) covers everything decided in §2.
   - It works on calendar dates (`YYYY-MM-DD` strings / `Temporal.PlainDate`). It never relies on the server's local time.
2. **`shared/lib/businessHours/businessDayCalendar.ts`**: business-day classification, extracted from `workflowBusinessDayScheduling.ts`.
   - Workflows are refactored to call it, with no change in behaviour.
   - When the tenant has **no default business-hours schedule**, the calendar falls back to Mon–Fri plus tenant-wide holidays (`holidays.schedule_id IS NULL`). This fallback applies only to the recurring-ticket caller; the workflow caller keeps its current "schedule required" validation. The editor tells the user which calendar is in use, for example "Business days: Mon–Fri (no default business hours set)". The fallback is therefore visible, not silent.
3. **`packages/tickets/src/lib/createTicketWithSideEffects.ts`**: one session-free composition for a complete ticket. The recurring generator is its first consumer.
   - It creates the model row, then adds the team, additional agents, tags, assets, checklist template and activity.
   - It publishes `TICKET_CREATED` and `TICKET_ASSIGNED` after commit.
   - It takes an explicit actor (`{ type: 'system' }` or `{ type: 'user', userId }`) and notification-suppression flags.
   - The UI `addTicket`, the workflow `tickets.create` action and the renewal job each re-implement parts of this. Mark each of them with `// LEVERAGE: pattern ticket-create-composition`; converging them is a follow-up (§7).

### 4.2 Data model

Add one migration, `server/migrations/20261002110000_create_recurring_tickets.cjs`, following `20260923100000_create_billing_profile_contacts.cjs`:

- composite PKs with `tenant`
- `ensureTenantDistribution` from `./utils/citusDistribution.cjs`
- tenant-composite FKs added after distribution
- `exports.config = { transaction: false }`

Register every table in `packages/db/src/lib/tenantTableMetadata.ts` and in the migration shim `server/migrations/utils/tenantDb.cjs`.

**`recurring_ticket_definitions`** (PK `tenant, definition_id`)

- `name text not null`
- `is_active bool not null default true`
- `archived_at timestamptz null`
- **Template:**
  - `title_template text not null`
  - `description jsonb null` (BlockNote JSON, the same format `QuickAddTicket` serializes)
  - `board_id uuid not null`, `status_id uuid null` (null = board default), `priority_id uuid not null`
  - `category_id uuid null`, `subcategory_id uuid null`
  - `assigned_to uuid null`, `assigned_team_id uuid null`
  - `additional_agent_ids jsonb not null default '[]'`
  - `tags jsonb not null default '[]'` (tag texts)
  - `checklist_template_id uuid null`
- **Schedule:**
  - `recurrence jsonb not null` (a `RecurrenceRule`, zod-validated)
  - `start_date date not null`
  - `create_time text not null default '08:00'`, `due_time text not null default '17:00'`
  - `lead_days int not null default 0` (check `0 ≤ lead_days ≤ 365`)
  - `non_business_day_policy text not null default 'keep'` (check in `keep|previous|next`)
- **Behaviour:**
  - `open_previous_policy text not null default 'always_create'` (check in `always_create|skip`)
  - `notify_client_on_create bool not null default false`
- **Audit:** `created_by`, `updated_by`, `created_at`, `updated_at`

**`recurring_ticket_definition_clients`** (PK `tenant, definition_client_id`; unique `tenant, definition_id, client_id`)

- `definition_id` (FK, cascade delete), `client_id` (FK)
- `is_active bool not null default true`
- `overrides jsonb not null default '{}'`. This is zod-validated, and each group is either present (overridden) or absent (inherited):
  ```ts
  {
    board?: { board_id; status_id | null },
    priority?: { priority_id },
    category?: { category_id | null; subcategory_id | null },
    assignment?: { assigned_to | null; assigned_team_id | null; additional_agent_ids: uuid[] }
  }
  ```
  Groups keep dependent fields consistent: a board override always carries its status, and an assignment override can deliberately mean "unassigned".
- `contact_id uuid null`, `location_id uuid null` (client-only)
- `evaluated_through timestamptz not null`. This is the window watermark (§4.4). It is set to `now()` whenever the row starts or resumes being active: client added, client resumed, or definition resumed.

**`recurring_ticket_client_assets`** (PK `tenant, definition_client_id, asset_id`): FK to `recurring_ticket_definition_clients` with cascade, and FK to `assets` with cascade.

**`recurring_ticket_occurrences`** (PK `tenant, occurrence_id`): this table is both the run history and the idempotency ledger.

- `definition_id`, `definition_client_id`, `client_id`
- `occurrence_date date not null`: the **nominal** rule date, before business-day adjustment.
- `due_date date not null`: the adjusted date.
- `create_at timestamptz`, `due_at timestamptz`
- `status text not null` (check in `created|skipped|missed|failed`)
- `ticket_id uuid null`, `reason text null`, `attempts int not null default 0`, `last_attempt_at timestamptz`, `created_at`
- **Unique `(tenant, definition_client_id, occurrence_date)`.** This is the idempotency key. Keying on the nominal date means changing the non-business-day policy never creates a duplicate.
- Index `(tenant, ticket_id)` for the ticket badge lookup. Index `(tenant, definition_id, due_at desc)` for history.

`tickets` gets no new column. The badge resolves the definition through `recurring_ticket_occurrences.ticket_id`.

### 4.3 Recurrence engine (`shared/lib/recurrence/`)

`RecurrenceRule` (zod, in `shared/lib/recurrence/rule.ts`):

```ts
type RecurrenceRule =
  | { frequency: 'daily';   interval: number; weekdaysOnly: boolean }
  | { frequency: 'weekly';  interval: number; weekdays: Weekday[] }            // ≥1
  | { frequency: 'monthly'; interval: number;
      on: { type: 'dayOfMonth'; day: number | 'last' }                           // 1–31 | last
        | { type: 'nthWeekday'; nth: 1 | 2 | 3 | 4 | 'last'; weekday: Weekday } }
  | { frequency: 'yearly';  month: number; day: number };
// plus: end: { type: 'never' } | { type: 'onDate'; date } | { type: 'afterCount'; count }
```

Functions:

- `listOccurrenceDates(rule, startDate, { from, to }): PlainDate[]`
  - Build an `RRule` with dates treated as floating UTC midnight, so no server timezone is involved.
  - `nthWeekday` maps to `byweekday: RRule.TU.nth(2)` (`nth(-1)` for last).
  - `dayOfMonth` greater than the month's length clamps to the last day, using `bymonthday: -1` for `last`. Days 29–31 clamp; they are not skipped. This is documented in the UI hint.
  - `afterCount` maps to rrule `count` counted from `startDate`. `onDate` maps to `until`.
- `adjustForNonBusinessDays(dates, policy, calendar): Array<{ nominal, due }>`
  - `previous` and `next` walk at most 31 days and throw if no business day is found.
  - Nominal dates that collapse onto the same adjusted date keep the earliest nominal date.
- `toZonedInstant(date, 'HH:MM', timeZone): Date`
  - Uses `Temporal.ZonedDateTime` with `disambiguation: 'compatible'`, which handles DST gaps and overlaps.
- `describeRule(rule, t)`: a localized summary for the list and editor.

`shared/utils/recurrenceUtils.ts` (schedule entries) is **not** changed. Add `// LEVERAGE: pattern recurrence-engine — schedule entries should move onto shared/lib/recurrence` at `generateOccurrences`. Add the same marker at the inline recurrence UI in `packages/scheduling/src/components/schedule/EntryPopup.tsx:1720`.

### 4.4 Generator sweep: `generate-recurring-tickets`

The handler is `packages/tickets/src/lib/recurring/generateRecurringTicketsForTenant.ts`. It runs per tenant, **every 15 minutes**, and is idempotent.

1. Load the tenant timezone (`getTenantTimezone`, `packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts:388`). Load the business-day calendar **only if** some active definition's policy is not `keep`.
2. For each active, unarchived definition × active definition-client, enumerate the **candidate occurrences**. These are all `{nominal, due}` dates where:
   - `create_at = toZonedInstant(due − lead_days, create_time)`
   - `due_at = toZonedInstant(due, due_time)`
   - `create_at ≤ now` and `due_at > evaluated_through`

   To get them, enumerate rule dates in `[localDate(evaluated_through) − 2 days, localDate(now) + lead_days + 2 days]`, adjust, and filter.
3. For each candidate, look up the occurrence row by `(definition_client_id, occurrence_date)`:
   - **A row exists with status `created`, `skipped` or `missed`:** do nothing.
   - **No row, or a row with status `failed`, and `due_at ≤ now`:** if there is no row, insert one with status `missed`. A `failed` row stays failed; it is final once due.
   - **No row, or a row with status `failed`, and `due_at > now`:** **generate** (step 4).
4. **Generate**, in one transaction:
   1. Insert or update the occurrence row. Use `ON CONFLICT DO NOTHING` for a new row. For a failed row, update it with `attempts + 1`, guarded by `status = 'failed'`.
   2. If `open_previous_policy = 'skip'`, check whether the most recent `created` occurrence for this definition-client points to a ticket that is still open (status not closed). If so, mark the row `skipped` with reason `previous_open:<ticket_number>` and stop.
   3. Resolve the effective fields: definition defaults, then client overrides, then client-only fields. Render the title tokens:
      - `{{client}}` is the client name.
      - `{{due_date}}` is the due date in long form, in the tenant's default locale, falling back to `en`.
      - `{{month}}` and `{{year}}` come from the due date.
   4. Call `createTicketWithSideEffects`, passing:
      - `ticket_origin: 'recurring'`, `source: 'recurring_ticket'`, `due_date: due_at`
      - actor `system`
      - `suppressContactNotifications: !notify_client_on_create`
      - the assets, tags, team, additional agents and checklist template
   5. Set the row to `created` with the new `ticket_id`.
   
   **On error:** roll back, then upsert the row in a fresh transaction as `failed`. Record `reason` (an actionable message, for example "Board ‘Patching’ no longer exists" or "Assigned user is inactive") and increment `attempts`.
5. After each definition-client has been processed, set `evaluated_through = now`. A crash mid-sweep leaves the watermark unchanged for any rows it did not reach.
6. Log a summary per tenant. The handler throws only on infrastructure failure. Per-occurrence failures are data and are stored in the occurrence row.

Why this window rule works:

- **No backfill.** Activation sets `evaluated_through = now`, so any occurrence that was already past due at activation is excluded.
- **Today's occurrence still appears.** An occurrence whose `create_at` has passed but whose `due_at` has not is still a candidate, so it is created.
- **Outages are visible.** Occurrences that come due during an outage show up as `missed`.

**Registration in both editions.** Copy the `date-trigger-scan` wiring:

- **Job name.** `SERVER_MAINTENANCE_JOBS.generateRecurringTickets` in `server/src/lib/jobs/serverMaintenanceJobNames.ts`.
- **EE fan-out.** `registerMaintenanceJob(..., { scope: 'tenant', tenants: tenantsWithActiveRecurringTickets, run })` in `registerServerMaintenanceJobs.ts`. The selector lists only tenants that have at least one active, unarchived definition.
- **EE schedule.** `{ jobName: 'generate-recurring-tickets', cron: '*/15 * * * *' }` in `MAINTENANCE_FANOUT_SCHEDULES`. Update the parity test `server/src/test/unit/maintenanceJobFanout.unit.test.ts:276-290`.
- **CE.**
  - Register the handler in `server/src/lib/jobs/registerAllHandlers.ts`.
  - Add `scheduleGenerateRecurringTicketsJob(tenantId)` to `server/src/lib/jobs/index.ts`. It goes through `getJobRunnerInstance().scheduleRecurringJob(name, { tenantId }, '*/15 * * * *', { singletonKey: 'generate-recurring-tickets:<tenant>' })` and returns `null` in EE.
  - Call it from `server/src/lib/jobs/initializeScheduledJobs.ts`.

### 4.5 `createTicketWithSideEffects` (new)

`packages/tickets/src/lib/createTicketWithSideEffects.ts`:

```ts
createTicketWithSideEffects(trx, tenant, {
  actor: { type: 'system' } | { type: 'user'; userId: string },
  ticket: CreateTicketInput,            // title, board/status/priority, client/contact/location, category, assigned_to, due_date, description, origin/source
  teamId?, additionalAgentIds?, tags?, assetIds?, checklistTemplateId?,
  notificationSuppression?: { suppressContactNotifications?: boolean },
}): Promise<{ ticketId; ticketNumber }>
```

1. Call `TicketModel.createTicketWithRetry(...)` with a `TicketModelEventPublisher(trx)`. Its `publishTicketCreated` metadata carries the suppression flag.
2. Team: call `assignTeamToTicketCore`. Agents: call `addTicketResourceCore` for each agent, and publish the returned events after commit. Tags: `TagModel`. Assets: `associateAssetWithTicket`, extended with a `relationshipType` parameter (default `'related'`), passing `'affected'`. Checklist: `applyChecklistTemplateToTicket(..., 'template')`.
3. Write `writeTicketActivity` with `TICKET_ACTIVITY_ACTOR.SYSTEM` and `TICKET_ACTIVITY_SOURCE.SYSTEM`. Publish `TICKET_ASSIGNED` after commit when there is an assignee, mirroring `addTicket` (`packages/tickets/src/actions/ticketActions.ts:561-611`). Include the SLA-stage event published there.
4. For a system actor, the cores that require an `actorUserId` (`addTicketResourceCore`, `assignTeamToTicketCore`, `associateAssetWithTicket.created_by`) need an explicit system representation.
   - Widen their signatures to accept `actorUserId: string | null` wherever the stored column is nullable.
   - Where a column is NOT NULL, such as `asset_associations.created_by`, keep the existing tenant-earliest-user convention from `associateAssetWithTicket`.
   - Verify each one while implementing. Never invent a fake user ID.

### 4.6 Event schema and email change

- Add `...suppressionFlagsSchema.shape` to `ticketCreatedEventPayloadSchema` (`packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts:31-51`). Mirror the change in the runtime schema copy if one exists.
- `handleTicketCreated` (`ticketEmailSubscriber.ts:935`) must call `resolveTicketNotificationSuppression(payload)`.
  - If suppressed, skip the primary contact/client email (`:1171`) and contact-type watchers.
  - Internal recipients are unchanged.
  - This matches the update handler at :1240 and :1465.
- This is a general fix: any creator that sets the flag is now honoured.

### 4.7 Ticket origin `recurring`

- Add `RECURRING: 'recurring'` to `TICKET_ORIGINS` in `packages/types/src/interfaces/ticket.interfaces.ts:18-27` and in the duplicate in `shared/models/ticketModel.ts:17-22`. Add `// LEVERAGE: pattern ticket-origins-duplicate` at the duplicate.
- Map it in `packages/tickets/src/lib/ticketOrigin.ts` (`SOURCE_HINT_TO_ORIGIN`, `normalizeStoredOrigin`).
- Update `TicketOriginBadge.tsx`: lucide `Repeat` icon, label, variant.
- Update `ticketExportActions.ts:79-87`: label `recurring`. Leave the existing stale `email`/`manual` cases alone.
- Add i18n keys `origin.recurring` in `features/tickets.json` and `tickets.origin.recurring` in `common.json`.

### 4.8 Permissions

- Add four entries to `server/migrations/utils/permissions/catalog.cjs`, in alphabetical position near `project_task`/`ticket`:
  ```js
  { resource: 'recurring_ticket', action: 'read'|'create'|'update'|'delete', msp: true, client: false,
    description: …, products: ['algadesk','psa'],
    defaultGrants: { algadesk: ['msp:Admin', /* read only: */ 'msp:Agent'], psa: ['msp:Admin','msp:Manager','msp:Dispatcher', /* read only: */ 'msp:Technician'] } }
  ```
- Add the migration `server/migrations/20261002120000_add_recurring_ticket_permissions.cjs`, copying `20260828120000_add_credential_audit_permission.cjs` (`reconcileAllTenants`, a throwing down migration, `transaction: false`).
- Every server action checks `hasPermission(user, 'recurring_ticket', <action>)`, using the `withAuth` pattern from `ticketActions.ts:431-439`.

### 4.9 Server actions: `packages/tickets/src/actions/recurringTicketActions.ts`

| Action | Permission | Purpose |
|---|---|---|
| `listRecurringTicketDefinitions(filters)` | read | List rows with name, `describeRule` summary, client count, next due date (earliest across active clients), status (active / paused / archived), and failure warning (the latest occurrence of any client is `failed`). |
| `getRecurringTicketDefinition(id)` | read | Definition plus its clients, overrides and asset IDs. |
| `createRecurringTicketDefinition(input)` / `updateRecurringTicketDefinition(id, input)` | create / update | Validate with zod. Check that the status belongs to the board, the category belongs to the board, the title tokens are known (unknown `{{…}}` is a save error), and the priority exists. |
| `setRecurringTicketDefinitionActive(id, active)` | update | When resuming, reset `evaluated_through = now` for all of the definition's active clients. |
| `archiveRecurringTicketDefinition(id)` | delete | Set `archived_at`. Archived definitions are read-only. |
| `addClientsToRecurringTicketDefinition(id, clientIds)` | update | Insert rows with `evaluated_through = now`. |
| `updateRecurringTicketClient(definitionClientId, { overrides, contact_id, location_id, assetIds })` | update | Validate that the contact, location and assets belong to the client. |
| `setRecurringTicketClientActive(definitionClientId, active)` / `removeClientFromRecurringTicketDefinition(definitionClientId)` | update | Removal keeps occurrence history; occurrence rows do not reference the client row by FK cascade. |
| `listRecurringTicketOccurrences(id, { status?, clientId?, page })` | read | Run history. |
| `previewRecurringTicketOccurrences(draft)` | read | The next 5 `{ due_at, create_at }` from now for an **unsaved** draft, using the tenant timezone and calendar. Also reports which business-day calendar is in use. |
| `listRecurringTicketsForClient(clientId)` | read | Data for the client-page section. |
| `getRecurringSourceForTicket(ticketId)` | read | `{ definition_id, name }` or `null`, for the badge. |

### 4.10 UI

All components live in `packages/tickets/src/components/recurring/` unless noted otherwise. All strings go in `features/tickets.json` under `recurring.*`. Add keys to every real locale, then run `node scripts/generate-pseudo-locales.cjs` and `node scripts/validate-translations.cjs`. Follow the DataTable, Dialog and loading-state standards in `docs/AI_coding_standards.md`.

- **Nav.**
  - `server/src/config/menuConfig.ts:107-112`: turn Tickets into a group with `subItems`. Use `All Tickets` → `/msp/tickets` and `Recurring` → `/msp/tickets/recurring`, with keys `nav.ticketsAll` and `nav.ticketsRecurring` in `msp/core.json`, following Projects at :125-133.
  - `/msp/tickets/*` already sits in `msp_core_helpdesk` (`server/src/lib/productSurfaceRegistry.ts:56`), so AlgaDesk gets it with no rule change.
  - If the sidebar supports per-item permission gating, hide Recurring without `recurring_ticket:read`. Otherwise the page shows the standard permission-denied state.
- **Routes.**
  - `server/src/app/msp/tickets/recurring/page.tsx` is the list. `server/src/app/msp/tickets/recurring/[definitionId]/page.tsx` is the editor, with `new` used for create.
  - Add a `layout.tsx` with metadata, as in `server/src/app/msp/projects/templates/`.
  - Confirm that the `@modal/(.)…` intercepting routes and `[id]/page.tsx` do not capture the static `recurring` segment.
- **`RecurringTicketsPage`.** A DataTable with columns Name, Schedule, Clients, Next due, Status and a warning icon. It has a filter for active / paused / archived and a "New recurring ticket" button.
- **`RecurringTicketEditor`.** A page with these sections:
  1. **Details:** name, active toggle.
  2. **Ticket template:**
     - title with a token helper
     - rich-text description (the same editor QuickAdd uses)
     - `BoardPicker`
     - a status `CustomSelect` loaded through `getTicketStatuses(boardId)`, with a "Board default" option
     - `PrioritySelect`, `CategoryPicker`
     - `UserAndTeamPicker` for the assignee and team, `MultiUserPicker` for additional agents
     - `QuickAddTagPicker`
     - a checklist-template `CustomSelect` loaded through `getChecklistTemplates`
  3. **Schedule:**
     - `RecurrenceRuleEditor`, a new reusable component in `packages/ui/src/components/recurrence/` built on `shared/lib/recurrence`. It provides frequency, interval, weekday chips, a monthly mode toggle (day X / Nth weekday) and end options.
     - start date, create time, due time and lead days
     - non-business-day policy, with a calendar note
     - a **Next 5 due dates** preview that recomputes as the draft changes
  4. **Behaviour:** the previous-open policy, and the "Email the client contact when a ticket is created" toggle (off).
  5. **Clients:**
     - A table with columns Client, Overrides summary, Contact, Location, Assets, Next due, an Active toggle, and an actions menu (Edit overrides, Remove).
     - **Add clients** opens a dialog using `ClientPicker`. It adds one client at a time and keeps the dialog open for more, because no multi-client picker exists. Add `// LEVERAGE: pattern multi-client-picker`.
  6. **History:** an occurrences DataTable with columns Due, Client, Status (created / skipped / missed / failed), Ticket link and Reason, with status and client filters.
- **`RecurringClientOverridesDialog`.** It is shared by the editor and the client page.
  - Each override group has an "Override" checkbox that reveals the group's fields. When it is unchecked, the field shows the inherited value as a hint.
  - Contact uses `ContactPicker` with `getContactsByClient`. Location uses a `CustomSelect` with `getClientLocations`.
  - Assets use a new `ClientAssetMultiSelect`, a client-scoped asset `AsyncSearchableSelect` in `packages/assets/src/components/`. No pure multi-asset picker exists today; `AssociatedAssets` is bound to an existing entity.
- **Client page.**
  - Add a `recurring-tickets` tab, labelled "Recurring tickets", to `baseTabContent` in `packages/clients/src/components/clients/ClientDetails.tsx` (~:1460).
  - Render it through a new cross-feature render prop, `renderClientRecurringTickets`, following `renderClientOpportunities`:
    - interface: `packages/clients/src/context/ClientCrossFeatureContext.tsx:145`
    - providers: `packages/msp-composition/src/clients/MspClientCrossFeatureProvider.tsx` and `AlgaDeskClientCrossFeatureProvider.tsx`
  - It is available in AlgaDesk mode, so do not add it to `excludedTabs` (:1796-1805).
  - Add `'recurring-tickets': 'service'` to `RAIL_GROUP_BY_TAB` in `command-center/FocusViewHost.tsx:24-37`.
  - The section lists the definitions that include this client: name, schedule, next due date, this client's overrides summary, and an active toggle. Actions are edit overrides (the dialog), remove, and open definition. An "Add to recurring ticket" action picks an existing definition.
- **Ticket badge.**
  - In `packages/tickets/src/components/ticket/TicketDetails.tsx`, after the origin badge (:3690), render `Recurring: <name>` as a link to `/msp/tickets/recurring/<id>` when `getRecurringSourceForTicket` returns a source.
  - Load it alongside the existing ticket data. Show it only for `ticket_origin = 'recurring'`, which avoids the lookup for other tickets.
  - The client portal shows only the origin badge ("Recurring"), with no definition link.

## 5. Order of work

**Phase A: engine (pure, no behaviour change)**

1. `shared/lib/recurrence/` (rule, `listOccurrenceDates`, `adjustForNonBusinessDays`, `toZonedInstant`, `describeRule`) with unit tests.
2. `shared/lib/businessHours/businessDayCalendar.ts`, extracted from `workflowBusinessDayScheduling.ts`, plus the Mon–Fri fallback builder. Refactor the workflow file onto it, and make sure the existing workflow scheduling tests still pass unchanged.

**Phase B: data and permissions**

3. The tables migration and its metadata registration (§4.2).
4. The permission catalog entries and reconcile migration (§4.8).
5. Add the `recurring` origin across types, model, normalizer, badge, export and i18n (§4.7).

**Phase C: ticket composition and events**

6. `createTicketWithSideEffects`, with the signature widening for a system actor (§4.5).
7. Suppression on `TICKET_CREATED`: schema plus `handleTicketCreated` (§4.6).

**Phase D: generator**

8. `generateRecurringTicketsForTenant` (§4.4).
9. Registration for CE and EE, the tenant selector, and the parity test update.

**Phase E: actions and UI**

10. `recurringTicketActions.ts` (§4.9).
11. `RecurrenceRuleEditor`, `ClientAssetMultiSelect`, `RecurringClientOverridesDialog`.
12. Nav, routes, `RecurringTicketsPage`, `RecurringTicketEditor`.
13. The client-page tab via the cross-feature render prop.
14. The ticket-detail badge.

## 6. Verification

**Unit tests** (vitest, next to the code):

- **Recurrence engine.**
  - Daily: every N days; weekdays only.
  - Weekly: every 2 weeks on Mon and Thu.
  - Monthly: day 31 clamps in February and April; `last`; 2nd Tuesday (Patch Tuesday 2026–2027 against a known list); last Friday; every 3 months.
  - Yearly: Feb 29 in non-leap years clamps to Feb 28.
  - End conditions: `afterCount` counted from `startDate`, `onDate` inclusive.
  - Runs with the server process in a timezone that differs from the tenant's: set `TZ=Pacific/Auckland`, use an `America/New_York` tenant, and assert identical dates.
- **`adjustForNonBusinessDays`.**
  - Weekend → previous/next.
  - A holiday on a Monday plus the `next` policy lands on Tuesday.
  - A recurring (month-day) holiday.
  - Collisions collapse to the earliest nominal date.
  - A calendar with no business day throws.
- **`toZonedInstant`.** The spring-forward gap (02:30 does not exist) and the fall-back overlap, in `America/New_York` and `Europe/Stockholm`.
- **Business-day calendar.** Parity with the old workflow classification on the existing fixtures. Fallback: no default schedule gives Mon–Fri plus global holidays.
- **Title token rendering.** Each token; an unknown token is rejected at save.
- **Zod schemas.** `RecurrenceRule` and `overrides`; invalid combinations are rejected.

**Integration tests** (integration-testing skill patterns, real DB, fake clock):

- **Happy path.** A definition with 2 clients, one of which overrides the assignee and the board/status. At `create_at` the sweep creates 2 tickets with the right fields:
  - board, status, priority, category, assignee, team, additional agents
  - tags, assets (`affected`), checklist items, contact, location
  - `due_date`, `ticket_origin = 'recurring'`, `entered_by` null
  
  It also writes `created` occurrence rows and publishes `TICKET_CREATED` with a SYSTEM actor. Running the sweep again creates nothing.
- **Lead days.** With `lead_days = 3`, the ticket appears 3 days before the due date and not earlier.
- **Skip policy.** The previous ticket is still open, so the next occurrence is `skipped` with the reason. After the previous ticket is closed, the following occurrence is created.
- **Missed.** Advance the clock past `due_at` without sweeping. The next sweep records `missed` and creates no ticket.
- **No backfill.**
  - A definition created with a `start_date` 3 months in the past produces no tickets for past occurrences.
  - Pausing, advancing past 2 occurrences, then resuming produces no backfill and no `missed` rows for the paused period.
  - Resuming between `create_at` and `due_at` creates today's ticket.
- **Failure and retry.** Delete the board referenced by an override. The occurrence is `failed` with an actionable reason, and the list's warning flag is true. Restore a valid board before `due_at`; the next sweep creates the ticket and `attempts` is 2.
- **Concurrency.** Two sweeps running in parallel for the same tenant produce exactly one ticket per occurrence, enforced by the unique key.
- **Client email.** With `notify_client_on_create = false`, the `ticket-created-client` email is not sent and the internal assignee email is. With `true`, both are sent.
- **Permissions.** The reconcile migration grants as specified for PSA and AlgaDesk. Technician and Agent can read but get "Permission denied" on create.
- **Edits.** Changing the template after a ticket was created leaves that ticket unchanged, and the next occurrence uses the new template.

**Manual smoke test** (dev stack, port 3916):

1. Go to Tickets ▸ Recurring ▸ New. Create "Server patching – {{month}} {{year}}": monthly, 2nd Tuesday, create 08:00, due 17:00, lead 3 days, policy `next`. Confirm the preview shows the next 5 Patch Tuesdays.
2. Add two clients. Give one an assignee override, a contact and two assets.
3. Set the start date so an occurrence's `create_at` is in the past and its `due_at` is in the future. Trigger the job: in CE, through the job runner; in EE, through the maintenance-fanout schedule trigger.
4. Confirm that:
   - two tickets exist with the "Recurring" origin badge and a "Recurring: Server patching…" link
   - the overridden assignee, contact, assets and checklist are present
   - the SLA has started
   - no client email was sent
   - the History tab shows `created`
5. Open the client's Recurring tickets tab. The definition is listed with the next due date. Edit the override there and confirm the change shows in the definition editor.
6. Pause the client, then resume it. No backfill happens.

**Build gates:**

- `npm run build` for CE and EE
- lint and typecheck for the touched packages
- migrations run on the Citus test DB (`docker-compose.test-citus.yaml`)
- `node scripts/validate-translations.cjs`

## 7. Out of scope (follow-up cards)

- **Converging ticket creation onto `createTicketWithSideEffects`.** The UI `addTicket`, the workflow `tickets.create` action and `processRenewalQueueHandler` should move onto it. That also fixes the pre-existing bug where workflow-created and renewal tickets never publish `TICKET_CREATED` (no SLA, notifications, webhooks or search indexing). These sites are marked `LEVERAGE: pattern ticket-create-composition`.
- **CE legacy-scheduler cadence bug.** `JobScheduler.scheduleRecurringJob` turns `*/15` (auto-close) and `*/5` (SLA timer) into once per 24h (`server/src/lib/jobs/jobScheduler.ts:191-196`). This needs its own card.
- **A ticket-list origin column or filter.** Today the list has neither; origin is available to reports and export only.
- **Per-definition timezone.** v1 uses the tenant timezone.
- **Tokens in the description, and a general template language.**
- **"Run now" and pre-generating future occurrences.**
- **REST API, workflow actions or events for recurring definitions** (for example `RECURRING_TICKET_OCCURRENCE_FAILED`), and the mobile app badge.
- **Moving schedule-entry recurrence onto `shared/lib/recurrence`** (`LEVERAGE: pattern recurrence-engine`).

## 8. Risks

| Risk | Mitigation |
|---|---|
| DST or server-timezone drift moves due dates. | The engine works on calendar dates only. Instants are built through `Temporal.ZonedDateTime` in the tenant timezone. Tests run with a mismatched process `TZ`. |
| Duplicate tickets from overlapping sweeps or retries. | Unique `(tenant, definition_client_id, occurrence_date)`, with the row inserted in the same transaction as the ticket. EE also has the Redis maintenance lock. |
| Changing the non-business-day policy re-fires a date. | The key is the nominal date, which the policy cannot change. |
| A tenant with no default business hours picks `previous`/`next`. | Mon–Fri plus global holidays, stated in the editor. It is not silent. |
| The refactor changes workflow business-day behaviour. | Extraction only, with the existing workflow tests kept as the guard. |
| Suppression changes `TICKET_CREATED` email behaviour for other creators. | Only payloads that set the flag are affected. Today, no creator sets it on create. |
| Sweep cost on large tenants. | The EE tenant selector limits the sweep to tenants with active definitions. Enumeration is bounded by the watermark window, about one day plus `lead_days`. |
| In CE, tenants created after server boot get no schedule until restart. | Same as every per-tenant CE job today (`initializeScheduledJobs.ts`). Not addressed here. |
