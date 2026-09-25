# Plan: alga-2026-0002570: date-based workflow triggers (client anniversary, contract renewal, license expiry)

Base: main @ 636c648b53 (worktree HEAD 9fd1ddb58b). All paths are relative to the worktree root.

## 1. Problem, grounded in code

The request is to notify people, or run workflows, on dates tied to business records: client anniversaries, contract renewals, and license expiry. The main use is scheduling TBRs (technology business reviews) and check-ins.

What the code does today:

- **Only three trigger types exist.** They are `event`, `schedule` (one-time `runAt`) and `recurring` (cron). The union is at `shared/workflow/runtime/types.ts:425-445`. None of them can say "N days before *this record's* date".
- **`CONTRACT_RENEWAL_UPCOMING` fires only on save.**
  - The window check is `computeContractRenewalUpcoming`, `shared/workflow/streams/domainEventBuilders/contractEventBuilders.ts:15-53`, with a fixed 90-day window at `:3`.
  - It is called only from save paths: `packages/clients/src/actions/clientContractActions.ts:291-300, 438-447, 654-672` and `packages/billing/src/actions/contractWizardActions.ts:1541-1620`.
  - A contract saved 200 days before renewal therefore never emits the event.
- **`ASSET_WARRANTY_EXPIRING` fires only on save.**
  - The window check is `computeAssetWarrantyExpiring`, `shared/workflow/streams/domainEventBuilders/assetEventBuilders.ts:50-80`, with a 30-day window.
  - It is called from asset create and update only (`packages/assets/src/actions/assetActions.ts:1017-1037, 1309-1329`), and neither call passes an idempotency key.
- **The daily renewal job emits no events.** `packages/jobs/src/lib/handlers/processRenewalQueueHandler.ts:190` scans `client_contracts.decision_due_date` every day and creates renewal tickets, but it publishes nothing.
  - CE schedule: `server/src/lib/jobs/initializeScheduledJobs.ts:410-412`.
  - EE schedule: `ee/temporal-workflows/src/schedules/setupSchedules.ts:480` feeding `packages/jobs/src/lib/maintenanceJobFanout.ts:126`.
- **No anniversary source or event exists.**
  - `clients` has no "client since" column.
  - The UI shows `clients.created_at` as "Client since" (`packages/clients/src/actions/clientPulseActions.ts:397`, `packages/clients/src/components/clients/command-center/PulseCards.tsx:764`). That value is wrong for any client that was imported.
- **No license record with an expiry date exists.**
  - `service_catalog.is_license` / `license_term` describe a product, not a client's license (`server/migrations/20260101090000_add_products_fields_to_service_catalog.cjs:25-27`).
  - `asset_software` has no license fields (`server/migrations/20251130120002_create_software_inventory_tables.cjs:9` lists license tracking as future work).
  - The nearest real expiry dates are `assets.warranty_end_date` and `stock_units.warranty_expires_at`.
- **The two copies of the renewal payload schema have drifted.**
  - The runtime copy (`shared/workflow/runtime/schemas/billingEventSchemas.ts:238-246`) has `decisionDueDate`, `daysUntilDecisionDue` and `renewalCycleKey`.
  - The event-bus copy (`packages/event-schemas/src/schemas/domain/billingEventSchemas.ts:257-262`) does not, and subscribers that re-parse (`packages/event-bus/src/eventBus.ts:530`) lose those fields.

## 2. Design decision

**Build a first-class `date` workflow trigger on top of a shared registry of date sources. The same scan job also emits the lead-window domain events on a schedule instead of only on save.**

Why not events alone? Each workflow needs its own lead time: 30 days before an anniversary for a TBR, 90 or 60 days before a renewal decision, the day a warranty lapses. Events that fire at one fixed window force every workflow to start a run and then discard it with `control.if`. Fixed thresholds also cannot express "on the day" or "7 days after".

The trigger declares its offset, and the engine fires exactly one run per workflow, record and occurrence. Dedupe uses the existing unique `workflow_runs.trigger_fire_key` (`server/migrations/20260308013000_add_workflow_run_trigger_fire_key.cjs`, enforced in `ee/packages/workflows/src/lib/workflowRunLauncher.ts:86-106, 191-230`).

The domain events stay useful for notification channels and for existing event-triggered workflows. The fix for them is to emit them from the same scan, deduped through a ledger, so saving a record and the daily scan never fire twice for one occurrence.

Layering:

```
workflow designer "Date" trigger / event catalog          (application)
date-trigger-scan job: workflow launcher + event emitter  (orchestration)
date source registry: one source per record date          (engine)
clients / client_contracts / assets tables                (data)
```

### Trigger shape (new union member in `shared/workflow/runtime/types.ts`)

```ts
export const workflowDateTriggerSchema = z.object({
  type: z.literal('date'),
  source: z.enum(['client.anniversary', 'contract.renewal_decision', 'contract.end', 'asset.warranty_end']),
  offsetDays: z.number().int().min(-365).max(365),       // negative = before the date, 0 = on the day
  localTime: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'), // tenant-local time of day to fire
  timezone: z.string().min(1).optional(),                // defaults to the tenant timezone
}).strict();
```

- The run payload is the source's payload schema. Each source owns a schema ref: `payload.ClientAnniversary.v1`, `payload.ContractRenewalDate.v1`, `payload.ContractEndDate.v1` and `payload.AssetWarrantyEnd.v1`.
- Each payload carries `occursOn`, `fireDate`, `offsetDays`, the entity IDs, `clientId`, `clientName` and source-specific fields (`yearsAsClient`, `renewalMode`, `endDate`, `assetName`, and so on).
- When the trigger is `date`, the designer sets `payloadSchemaRef` from the source, just as inferred mode does for event triggers.

### Date sources (engine: `packages/jobs/src/lib/dateTriggers/`)

Each source implements the same interface:

```ts
interface DateTriggerSource {
  id: DateTriggerSourceId;
  payloadSchemaRef: string;
  domainEvent?: { eventType: string; windowDays: number };
  findOccurrences(knex, tenant, fromDate: string, toDate: string): Promise<DateOccurrence[]>;
}
```

`findOccurrences` takes `fromDate` and `toDate` as local-calendar `YYYY-MM-DD` strings, inclusive, and returns each occurrence's `{ entityId, clientId, occursOn, cycleKey, payload }`.

| Source | Date column | Occurrence rule | Domain event emitted by the scan |
|---|---|---|---|
| `client.anniversary` | `COALESCE(clients.client_since, clients.created_at::date)`, active clients only | Recurs yearly. A Feb 29 date falls on Feb 28 in non-leap years. The first-year date itself is excluded (`yearsAsClient >= 1`). | `CLIENT_ANNIVERSARY_UPCOMING` (new), 30-day window |
| `contract.renewal_decision` | `client_contracts.decision_due_date`, active contracts, `renewal_mode <> 'none'` | One per `renewal_cycle_key` | `CONTRACT_RENEWAL_UPCOMING`, 90-day window. This reuses `computeContractRenewalUpcoming` and `buildContractRenewalUpcomingPayload` (`contractEventBuilders.ts:15, 106`). |
| `contract.end` | `client_contracts.end_date`, active contracts | Once | none |
| `asset.warranty_end` | `assets.warranty_end_date`, assets that are not retired or disposed | Once per distinct warranty date (`cycleKey` = the date) | `ASSET_WARRANTY_EXPIRING`, 30-day window. This reuses `computeAssetWarrantyExpiring` and `buildAssetWarrantyExpiringPayload` (`assetEventBuilders.ts:50, 168`). |

- Every source query uses `tenantDb(...)` scoping, like the per-tenant jobs in `server/src/lib/jobs/initializeScheduledJobs.ts:18-33`.
- The yearly recurrence arithmetic lives in one pure helper, `nextAnnualOccurrence(anchor, from, to)`, with its own tests.

### Anchor column: `clients.client_since`

`clients.client_since date NULL` ships on main (`server/migrations/20260923120000_add_client_since_to_clients.cjs`), along with its details-tab field, REST/CSV/webhook plumbing, Pulse card and the `packages/clients/src/lib/clientSince.ts` helpers. This work only reads it.

- The anniversary source uses it, falling back to `created_at`.

### Dedupe ledger: `date_trigger_emissions`

The ledger is keyed `(tenant, dedupe_key)` and is unique. It follows the `prepaid_balance_alerts` pattern (`server/migrations/20260815000000_add_prepaid_balance_alerts.cjs:114,139`).

- **Domain events.** Emission inserts the ledger row with `ON CONFLICT DO NOTHING RETURNING` and publishes only if a row was inserted.
  - The key is `event:<EVENT_TYPE>:<entityId>:<cycleKey>`.
  - The same key is passed as `eventId` to `publishEvent`, as a v5 UUID (`packages/event-bus/src/publishers/index.ts:17-18, 87`). That also dedupes at the workflow worker (`services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts:171-181`).
  - The existing save-time emitters go through the same helper, `emitDateDomainEventOnce(...)`, so saving a record and the scan share one guard.
- **Date-trigger runs.** These need no ledger row. They rely on `triggerFireKey = date:<workflowId>:<source>:<entityId>:<occursOn>:<offsetDays>`.
  - The key deliberately leaves out the version, so republishing a workflow does not fire again.
  - It includes `offsetDays`, so a workflow whose offset is edited fires for the new offset.

### Scan job: `date-trigger-scan` (per tenant, hourly, idempotent)

Handler: `packages/jobs/src/lib/handlers/dateTriggerScanHandler.ts`.

1. Resolve the tenant timezone with `getTenantTimezone(tenantId)` (`packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts:388`), then compute the local `today` and `now`.
2. **Emit domain events.** For each source that has a `domainEvent`, find occurrences in `[today, today + windowDays]` and emit each one once through the ledger. This replaces "only on save" and also catches records that entered the window by the passage of time.
3. **Launch date-triggered workflows (EE only).**
   - List published workflows whose latest definition has `trigger.type === 'date'`. Use the same lookup as `WorkflowRuntimeV2EventStreamWorker.ts:311-352`, wrapped in a shared helper rather than copied.
   - For each workflow, compute `fireDate = occursOn + offsetDays`, which means querying occurrences in `[today - offsetDays - LOOKBACK_DAYS, today - offsetDays]`. `LOOKBACK_DAYS` is 3, so an outage of up to three days catches up.
   - Launch each occurrence whose `fireDate <= today` and whose tenant-local time has reached `localTime`.
   - Launch with `launchPublishedWorkflowRun(knex, { triggerType: 'date', triggerFireKey, triggerMetadata: { source, occursOn, offsetDays, entityId }, payload })`.
   - Validate the payload against the source schema before launching, as the event worker does.
4. **Cap the batch.** Cap launches per tenant per tick at 500 and log how many are left. The next hourly tick picks up the rest, because the fire key makes re-scans safe.

Why hourly: it lets `localTime` fire close to the tenant's local morning in every timezone, and the fire key and ledger make repeats free.

Registration:

- **CE:** a pg-boss recurring job per tenant with cron `'5 * * * *'` and singleton key `date-trigger-scan:<tenant>`. Copy `scheduleProjectDateReadinessJob` (`server/src/lib/jobs/index.ts:689-701`) and its call at `initializeScheduledJobs.ts:147-153`. Register the handler in `server/src/lib/jobs/registerAllHandlers.ts` next to `project-date-readiness` (`:278`). Step 3 is skipped in CE, because workflow runtime launching is EE-only (`registerAllHandlers.ts:565-629`).
- **EE:** add `'date-trigger-scan': { scope: 'tenant', ... }` to `MAINTENANCE_JOBS` (`packages/jobs/src/lib/maintenanceJobFanout.ts:118`), and add `{ jobName: 'date-trigger-scan', cron: '5 * * * *' }` to `ee/temporal-workflows/src/schedules/setupSchedules.ts:~480`.

## 3. Changes by file (in order of work)

### Phase A: schemas and events (no behaviour change)

1. `packages/event-schemas/src/schemas/domain/billingEventSchemas.ts:257-262`: add the optional `decisionDueDate`, `daysUntilDecisionDue` and `renewalCycleKey` so it matches `shared/workflow/runtime/schemas/billingEventSchemas.ts:238-246`. This fixes the drift.
2. Add the `CLIENT_ANNIVERSARY_UPCOMING` event, using the inventory-events commit `9cd18bc159` as the template:
   - `packages/event-schemas/src/schemas/domain/crmEventSchemas.ts` and `shared/workflow/runtime/schemas/crmEventSchemas.ts`: the payload schema `{ clientId, clientName, anniversaryDate, yearsAsClient, daysUntilAnniversary }`.
   - `packages/event-schemas/src/schemas/eventBusSchema.ts`: add the name to `EVENT_TYPES` (`:194`) and an entry to `EventSchemas` (`~:1290-1500`).
   - `packages/event-schemas/src/schemas/domain/workflowEventPayloadSchemas.ts` and `shared/workflow/runtime/schemas/workflowEventPayloadSchemas.ts`: map `payload.ClientAnniversaryUpcoming.v1`. The runtime copy is the one `shared/workflow/runtime/init.ts:26-30` registers.
   - New migration `server/migrations/<ts>_seed_client_anniversary_event_catalog.cjs`: upsert into `system_event_catalog`, copying `20260716140000_seed_inventory_workflow_events.cjs` and using a literal timestamp (Citus).
3. Add the date-trigger payload schemas (`payload.ClientAnniversary.v1`, `payload.ContractRenewalDate.v1`, `payload.ContractEndDate.v1`, `payload.AssetWarrantyEnd.v1`) in a new file, `shared/workflow/runtime/schemas/dateTriggerPayloadSchemas.ts`, and register them in the runtime ref map.
4. `shared/workflow/runtime/types.ts:425-445`: add `workflowDateTriggerSchema` to the `workflowTriggerSchema` union and export the `WorkflowDateTrigger` type.
5. Widen `triggerType` to include `'date'` in:
   - `ee/packages/workflows/src/lib/workflowRunLauncher.ts:34,53`
   - `ee/packages/workflows/src/lib/workflowRuntimeV2TemporalContract.ts:14`
   - `ee/packages/workflows/src/actions/workflow-runtime-v2-schemas.ts:139`, the run-list filter
   - `ee/packages/workflows/src/components/automation-hub/WorkflowList.tsx:110,161-177,242`, the filter and label
   - `ee/packages/workflows/src/lib/workflowScheduleLifecycle.ts:76`: confirm that `isTimeTriggerDefinition` keeps ignoring `date`. Date triggers need no per-workflow runner schedule.

### Phase B: data and engine

6. New migration `server/migrations/20260923130000_add_date_trigger_emissions.cjs` (after main's `client_since` migration):
   - The `date_trigger_emissions(tenant uuid, dedupe_key text, event_type text, entity_id uuid, occurs_on date, emitted_at timestamptz, PRIMARY KEY (tenant, dedupe_key))` table, distributed on `tenant` in the same way as the other tenant tables. Check the recent Citus migration pattern.
   - An index on `clients (tenant, client_since)` for the anniversary scan. `client_contracts (tenant, decision_due_date, status)` already has one (`202602211130_...:69-70`). Add `assets (tenant, warranty_end_date)` if it is missing.
7. Client model: no changes here. `client_since` (type, schemas, REST, details form, Pulse card) comes from main. `setClientLifecycleStatus` returns its row through main's `withClientSinceDateString` so the details form keeps the stored day.
8. `packages/jobs/src/lib/dateTriggers/`:
   - `types.ts`
   - `annual.ts`, holding `nextAnnualOccurrence` and the leap-day rule
   - `sources/clientAnniversary.ts`, `sources/contractRenewalDecision.ts`, `sources/contractEnd.ts`, `sources/assetWarrantyEnd.ts`
   - `registry.ts`
   - `emitOnce.ts`, holding `emitDateDomainEventOnce(knex, tenant, { eventType, entityId, cycleKey, payload, ctx })`, which inserts the ledger row and then calls `publishWorkflowEvent` with a deterministic `eventId`
9. Route the save-time emitters through `emitDateDomainEventOnce`:
   - `packages/clients/src/actions/clientContractActions.ts:291-300, 438-447, 654-672`
   - `packages/billing/src/actions/contractWizardActions.ts:1592-1620`
   - `packages/assets/src/actions/assetActions.ts:1017-1037, 1309-1329`

   Keep the existing `compute*` window checks.

### Phase C: scan job

10. `packages/jobs/src/lib/handlers/dateTriggerScanHandler.ts`: implement steps 1-4 of the scan job. The workflow-launch step is injected as a dependency (`launchDateTriggeredWorkflows`), which is provided only in EE, so the CE build does not import EE code.
11. The EE launcher goes in `ee/packages/workflows/src/lib/dateTriggerLauncher.ts`. It lists published `date` workflows, queries the source registry, and calls `launchPublishedWorkflowRun`. Extract the published-workflow lookup from `WorkflowRuntimeV2EventStreamWorker.ts:311-352` into a shared helper in `shared/workflow/persistence` and use it from both places.
12. Registration:
    - `server/src/lib/jobs/registerAllHandlers.ts`: add the handler, and inject the EE launcher inside the `includeEnterprise` block (`:565`).
    - `server/src/lib/jobs/index.ts`: add `scheduleDateTriggerScanJob`.
    - `server/src/lib/jobs/initializeScheduledJobs.ts`: add the per-tenant CE call.
    - `packages/jobs/src/lib/maintenanceJobFanout.ts:118`: add the EE entry.
    - `ee/temporal-workflows/src/schedules/setupSchedules.ts:~480`: add the EE schedule.

### Phase D: designer UI (EE)

13. `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`:
    - Extend `TriggerTypeSelection` (in use at `:2221-2240`) to `'event' | 'manual' | 'date'`.
    - Add a "Date" trigger panel next to the event picker (`~:3963-4100`). It has a source select with labels such as "Client anniversary", "Contract renewal decision date", "Contract end date" and "Asset warranty end"; a number field for days plus a before/on/after select, which together map to the signed `offsetDays`; a local time field; and an optional timezone.
    - Selecting a source sets `payloadSchemaRef` to the source's schema, following the inferred-schema path at `:2132-2150`.
    - Show a plain-language summary, for example "Runs 30 days before each client's anniversary at 08:00 (America/New_York)".
    - All strings go in the workflows locale namespace (en plus the pseudo-locales, following the project i18n rules).
14. `ee/packages/workflows/src/components/automation-hub/WorkflowList.tsx`: add a "Date" trigger badge and filter entry.
15. Validation in the publish path: reject a `date` trigger whose `payloadSchemaRef` does not match the source's schema.

### Phase E: tests (write them with each phase)

See section 6.

## 4. Out of scope, and why

- **License expiry as its own record.** Alga has no record of a license held by a client and when it expires.
  - `service_catalog.is_license` marks a product type, and nothing stores per-client license terms or expiry dates.
  - Designing that record is its own product decision: whether data is entered by hand or synced from Pax8, CIPP/M365 or distributors, whether it is per contract line or per subscription, and how quantities work. It should not be decided as a side effect of a trigger feature.
  - This plan covers expiry needs with `asset.warranty_end` and `contract.end`, and the registry is built so a `license.expiry` source later means one source file plus the migration that creates the license record.
  - **Recommend a follow-up card:** "License records with expiry dates (manual + Pax8/CIPP sync)". The captain should confirm this split, because the card title names license expiry.
- **`stock_units.warranty_expires_at`.** Inventory units that are not yet deployed as assets are left out. That can be added later as a source if anyone asks.
- **Built-in (non-workflow) notifications for these dates.** Users get notified by building a date-triggered workflow that uses `notifications.send_in_app` or `email.send` (`shared/workflow/runtime/actions/businessOperations/notifications.ts:22`, `email.ts:25`). Adding the new event to `INTERNAL_NOTIFICATION_EVENT_TYPES` (`packages/event-bus/src/publishers/index.ts:51`) is a separate product decision.
- **Per-record conditions inside the trigger**, such as "only clients with tag X". Workflows already do this with `control.if` on the payload. Trigger-level filters can come later if they are needed.
- **Changing `process-renewal-queue` behaviour.** It keeps creating renewal tickets as it does now. The new scan only adds event emission and workflow launches.

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **The first deploy floods tenants.** Every in-window contract and warranty, and every client whose anniversary is within 30 days, emits an event on the first scan. | Ledger dedupe limits this to one event per occurrence. It is still a one-time burst of real events. **Recommendation:** the migration pre-seeds the ledger for occurrences already inside their window at deploy time, so only records that newly enter the window emit. Date-triggered workflows are new, so they have no backlog. |
| **Anniversary dates based on `created_at` are wrong for imported clients.** | Anchor on main's `client_since`, falling back to `created_at`. The anniversary payload reports `anniversarySource: 'client_since' \| 'created_at'` so workflows can filter on it. |
| **A timezone or DST boundary fires on the wrong day, or fires twice.** | All date maths runs on tenant-local calendar dates (`YYYY-MM-DD` strings), never on UTC instants, and the fire key contains `occursOn` and `offsetDays`. Unit tests cover DST transitions and UTC±12 tenants. |
| **Save-time emitters and the scan both fire for one occurrence.** | One ledger helper handles both paths, and the deterministic `eventId` dedupes again at the workflow worker. |
| **A large tenant's scan cost or burst of runs.** | Every source query is a range query on an indexed date column. Launches are capped at 500 per tick, and the remainder is carried to the next tick by the idempotent re-scan. |
| **The CE build pulls in EE code.** | The workflow launcher is injected only inside `includeEnterprise`. The CE handler runs the event-emission step only. |
| **Editing a workflow's offset refires past occurrences.** | Fires are limited to `fireDate` in `[today - LOOKBACK_DAYS, today]`, so an edit fires at most three days back. |
| **Citus.** | The new table is distributed on `tenant`, every query includes `tenant`, and migrations use literal timestamps (the pattern in `20260716140000_seed_inventory_workflow_events.cjs`). |

**Implementation note:** The anniversary source currently loads active clients for the tenant and computes recurring annual dates in application code. A simple `client_since` date range cannot find anniversaries recurring from anchors in prior years. Optimizing this source needs a month/day index strategy that also accounts for the `created_at` fallback and tenant-local dates; defer that optimization until its query plan is measured. The contract and warranty sources use bounded date ranges.

## 6. How to verify

**Unit tests** (vitest, next to the sources):

- `annual.ts`:
  - Feb 29 anchors in leap and non-leap years
  - Ranges that span a year end
  - `yearsAsClient` counting
  - Excluding the first-year date
- Each source's `findOccurrences` against a seeded DB:
  - Renewal: respects `renewal_mode = 'none'` and inactive contracts
  - Warranty: skips retired assets
- `emitDateDomainEventOnce`: a second call does not publish, and the `eventId` is stable.
- `dateTriggerScanHandler`:
  - Fake clock plus a fixed tenant timezone. Covers fire-date maths for offsets of -30, 0 and +7; honours `localTime`; catches up over the 3-day lookback; applies the batch cap.
  - Running twice in the same tick launches nothing new, because the fire key dedupes.
- Trigger schema: `date` parses, and bad offsets or times are rejected. Update the `workflowDefinitionSchema` round-trip tests.
- The existing `packages/billing/tests/contractRenewalUpcomingEvent.wiring.test.ts` and `shared/workflow/streams/domainEventBuilders/__tests__/contractEventBuilders.test.ts` keep passing, updated for the ledger helper.
- Event-schema test for `CLIENT_ANNIVERSARY_UPCOMING`, mirroring `packages/event-schemas/src/schemas/domain/inventoryEventSchemas.test.ts`, plus a catalog migration test.

**Integration tests** (the integration-testing skill patterns):

- On a real DB, seed a client with `client_since` 30 days from now in the tenant's local calendar, a contract with `decision_due_date` 60 days out, and an asset whose warranty ends today. Publish three `date` workflows: -30 on anniversary, -60 on the renewal decision, 0 on warranty end. Run the handler, and assert exactly three `workflow_runs` with the expected `trigger_fire_key` and payload. Run it again and assert no new runs.
- Assert that the scan wrote `CONTRACT_RENEWAL_UPCOMING`, `ASSET_WARRANTY_EXPIRING` and `CLIENT_ANNIVERSARY_UPCOMING` ledger rows and published each event once. Saving the contract afterwards publishes nothing more.

**Manual smoke test (EE dev env):**

1. In the Workflow Designer, create a workflow with a Date trigger, "30 days before client anniversary at 08:00", that runs `notifications.send_in_app` to yourself. Publish it.
2. Set a client's "Client since" so the anniversary is exactly 30 days from today.
3. Trigger `date-trigger-scan` for the tenant through the job runner or a Temporal schedule trigger.
4. Confirm that:
   - The run appears in Run Studio with trigger type "Date".
   - The in-app notification arrives.
   - A second manual trigger creates no second run.
   - The Pulse card shows the edited "Client since".

**Build gates:** `npm run build` for CE and EE, the lint and typecheck targets for the touched packages, and the migration run on a Citus test DB (`docker-compose.test-citus.yaml`).
