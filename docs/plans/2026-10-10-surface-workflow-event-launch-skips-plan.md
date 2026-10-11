# Surface per-workflow event launch skips (UI + metric)

Card: alga0002106 follow-up, "Surface per-workflow event launch skips (UI + metric)".
Branch: `feature/alga0002106-surface-per-workflow-event-launch-sk`. Base: `main` @ `b0d0b4dacf`.

## 1. Problem, grounded in the current code

`services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts` (`processEvent`, L120-L560) handles each event like this:

1. It inserts a `workflow_runtime_events` row (L198).
2. It routes waits.
3. It loops over every **published** definition whose trigger `eventName` matches the event (L305-L501).

Inside that loop, the decision not to launch a workflow is recorded in three different ways:

| Branch (line) | Reason | `skipStats` | `skipDiagnostics` / persisted text |
|---|---|---|---|
| `workflow.is_paused` (L327) | paused | `paused` | none (silent) |
| lineage contains workflow (L335) | trigger-loop guard | `workflowCycle` | yes |
| no `payloadSchemaRef` (L355) | missing schema ref | `missingSchemaRef` | yes |
| ref not in registry (L360) | unknown schema ref | `unknownSchemaRef` | yes |
| no source schema for event (L371) | missing source schema | `missingSchemaRef` (shares the counter with the row above) | yes |
| refs differ and no mapping (L380) | schema mismatch | `schemaMismatch` | yes |
| `resolveInputMapping` throws (L409) | mapping failed | **not counted** | yes |
| `safeParse` fails (L418) | payload validation failed | `payloadValidationFailed` | `payloadValidationErrors` |
| `evaluateWorkflowSelfTrigger` denies (L443) | self-trigger / causation depth exceeded | **not counted** | **not persisted** (log only) |
| `launchPublishedWorkflowRun` throws (L486) | launch failed | none | `deliveryErrors` |

The persistence at L530-L555 has three gaps that the card's goal cannot work around:

- **Per-workflow attribution is lost.** `error_message` joins every reason into one free-text string per event. `workflow_runtime_events` has no `workflow_id`, so "how many events did workflow X skip" cannot be queried.
- **Partial skips are never persisted.** Skip text is written only when *nothing* launched or signalled (L542-L545). If an event launches workflow A and schema-mismatches workflow B, B's skip exists only in a debug log. That is the "silently skipped every event" case, and it is the most common one: a tenant with several workflows on `TICKET_CREATED`.
- **The reason taxonomy is lossy.** Two different reasons share `missingSchemaRef`, mapping failures and guard denials are not counted, and `skipStats` only goes to a debug log.

There is no metrics pipeline in the worker (no prom-client or OTel SDK in `services/workflow-worker`). Cloudlab's Alloy OTLP receiver (`nm-kube-config/alloy/values.yaml`) has a **traces-only** output, so OTLP metrics would be dropped silently. Prometheus is kube-prometheus-stack and selects `ServiceMonitor`/`PodMonitor`/`PrometheusRule` objects labelled `release: prometheus` (see `nm-kube-config/tempo-metrics-generator/04-servicemonitor.yaml`). The existing `istio-mesh-pods` PodMonitor scrapes only Envoy's `:15090`, not app metrics. No `PeerAuthentication` exists, so mesh mTLS is PERMISSIVE and a plaintext scrape of the pod port works.

## 2. Key decisions

### D1. A structured skip table, not more columns on `workflow_runtime_events`

One event fans out to N workflows, so a skip is a per-(event, workflow) fact. A child table models that directly. Adding a `workflow_id` column to the event row cannot represent the fan-out. The new table is `workflow_event_launch_skips`:

| column | type | notes |
|---|---|---|
| `tenant` | uuid not null | distribution column |
| `skip_id` | uuid not null default `gen_random_uuid()` | |
| `event_id` | uuid not null | → `workflow_runtime_events.event_id` (logical ref, see D1b) |
| `workflow_id` | uuid not null | |
| `workflow_version` | integer null | latest published version evaluated |
| `event_name` | text not null | denormalized so per-workflow queries need no join |
| `reason` | text not null | stable code, `CHECK` constrained (D2) |
| `intentional` | boolean not null | derived from `reason`; stored so the alarming filter is index-friendly |
| `message` | text not null | the exact human message (the same text the worker writes today) |
| `details` | jsonb null | structured context: `{ issues[], workflowPayloadSchemaRef, sourcePayloadSchemaRef, guardReason, causationDepth, error }` |
| `created_at` | timestamptz not null default now() | |

- PK `(tenant, skip_id)`. Unique `(tenant, event_id, workflow_id)`: inserts use `ON CONFLICT DO NOTHING`, so a redelivered event cannot double-count. The unique key includes the distribution column, which satisfies the Citus rule (see the `citus-migration-gotchas` skill).
- Index `(tenant, workflow_id, created_at DESC)` for the per-workflow summary and drill-down.
- Partial index `(tenant, created_at DESC) WHERE intentional = false` for the list-page badge aggregation.
- **D1a. Distribution.** Distribute on `tenant` with `colocate_with => 'workflow_runtime_events'`. Do not use the shared `ensureTenantDistribution` helper, because it colocates with `tenants`, and that group is not guaranteed to be the group the v2 workflow tables were placed in (`ee/server/migrations/20260529130000_distribute_workflow_v2_tables.cjs`). The skip table must join colocated with `workflow_runtime_events` and `workflow_definitions`. The migration checks `canCreateDistributedTable` and `isDistributed` from `server/migrations/utils/citusDistribution.cjs` and is a no-op on plain Postgres (CE/CI).
- **D1b. No FKs.** On CE, `workflow_definitions` / `workflow_runtime_events` still have single-column PKs, while EE has `(tenant, id)` PKs. A composite FK cannot target both. Cleanup is explicit instead:
  - `deleteWorkflowDefinitionAction` (`ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts:2126`) deletes the workflow's skip rows in its existing transaction.
  - `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts` (table list at L83) gains the table.
  - `packages/db/src/lib/tenantTableMetadata.ts` gains `workflow_event_launch_skips: { scope: 'tenant' }`.
- Retention matches `workflow_runtime_events`, which has no pruning today. Volume is bounded by the event rows already stored (at most one skip per matching workflow per event). Retention is out of scope; it gets the same treatment as the event table when that lands.

### D2. A closed reason taxonomy with explicit intentional vs. alarming

There is one source of truth, `workflowLaunchSkipReasons.ts` in `ee/packages/workflows/src/lib/`. It is shared by the worker, the actions and the UI:

| code | intentional | source branch |
|---|---|---|
| `missing_schema_ref` | no | L355 |
| `unknown_schema_ref` | no | L360 |
| `missing_source_schema` | no | L371 (split from `missing_schema_ref`; different fix for the author) |
| `schema_mismatch` | no | L380 |
| `payload_mapping_failed` | no | L409 |
| `payload_validation_failed` | no | L418 |
| `launch_failed` | no | L486 (Temporal launch error; same author-visible outcome, no run) |
| `paused` | **yes** | L327 |
| `lineage_loop_guard` | **yes** | L335 |
| `self_trigger_guard` | **yes** | L443, `reason === 'self_trigger'` |
| `causation_depth_exceeded` | **yes** | L443, `reason === 'causation_depth_exceeded'` |

- Intentional skips are **persisted and shown separately** (a "Guarded / paused" group in the drawer), and they are excluded from the banner, the list badge and the alert. Persisting them answers "why didn't my workflow fire while paused/looping?" without crying wolf. A paused workflow on a busy event writes one row per event. That is the same order of magnitude as the event row itself, so it is acceptable.
- The DB `CHECK (reason IN (...))` and a TS `const` tuple are kept in sync by a unit test that reads the migration's list.

### D3. Worker: one collector, written for every skip regardless of other launches

`skipStats`, `skipDiagnostics` and `payloadValidationErrors` are replaced by a single `LaunchSkip[]` collector with a `recordSkip({ workflow, version, reason, message, details })` helper. After the loop:

1. **Always** batch-insert the collected skips: `WorkflowEventLaunchSkipModelV2.insertMany`, `ON CONFLICT DO NOTHING`. This closes the partial-skip gap.
2. Increment the metric once per skip (D4), and once per successful launch.
3. Keep the existing `error_message` semantics on the event row unchanged: same conditions, and text derived from the collector's `message`s in the same order (validation messages first, then the other skips). This avoids regressing Run Studio and the Events tab, where an event that launched something must not read as an error (comment at L437-L439 and test at L755).
4. The debug "Event processed" log replaces `skipStats` with `skipCountsByReason` derived from the collector.

Failure handling follows the coding standards' fail-fast rule. If the skip insert throws, the error propagates to the consumer's existing `logger.error` and rethrow (L101-L107). It is not swallowed. Note that the `existing` idempotency check (L171) means a redelivery after a crash between event insert and skip insert will not re-evaluate. That gap already exists for `error_message`; it is called out in §7 as a known limitation and not widened here.

### D4. Metric via prom-client on the worker's existing HTTP port, scraped by a ServiceMonitor

- Why not OTel: the worker has no SDK, and cloudlab's Alloy pipeline drops OTLP metrics (traces-only output). A scrape endpoint plugs into the path Prometheus already uses, with no collector changes.
- Add `prom-client` to `services/workflow-worker/package.json`. New module `services/workflow-worker/src/metrics.ts` owns a dedicated `Registry` with default Node process metrics and:
  - `alga_workflow_event_launch_skips_total{tenant, workflow_id, event_name, reason, intentional}` (counter)
  - `alga_workflow_event_launches_total{tenant, workflow_id, event_name}` (counter). This gives a denominator for "skipped everything" alerting and dashboards.
- Cardinality: series exist only for (tenant × workflow × reason) combinations that actually occur. The label set is bounded by published event-triggered workflows. `workflow_key` is deliberately **not** a label, because renames would churn series. The alert links to the workflow page instead.
- `HealthServer` (`services/workflow-worker/src/healthServer.ts`) serves `GET /metrics` from the registry on the same port (4000, already the named `http` container/service port).
- The worker class takes a metrics sink by constructor injection (default: the module singleton) so unit tests can assert increments without a global registry.
- Helm (`ee/helm/workflow-worker`): add `templates/servicemonitor.yaml`, gated by `metrics.serviceMonitor.enabled` (default `false`), with `metrics.serviceMonitor.labels` (cloudlab sets `release: prometheus`), `interval: 30s`, `port: http`, `path: /metrics`. Off by default keeps appliance/CE installs unaffected.
- `nm-kube-config` (separate repo, separate commit, applied after the image ships):
  - `workflow-worker/{hosted,prod}.values.yaml`: `metrics.serviceMonitor.enabled: true` with the `release: prometheus` label.
  - New `workflow-worker/prometheusrule-launch-skips.yaml` (`release: prometheus`):
    ```
    alert: WorkflowEventLaunchSkipsSustained
    expr: sum by (tenant, workflow_id, reason) (
            increase(alga_workflow_event_launch_skips_total{intentional="false"}[1h])
          ) >= 3
    for: 30m
    labels: { severity: warning }
    annotations: summary/description naming tenant, workflow_id, reason; runbook → workflow page
    ```
  - A second rule, `WorkflowEventLaunchesAllSkipped`, fires when alarming skips > 0 and launches == 0 for the same workflow over 6h. That is the "skipped every event" signal. Thresholds are starting values to tune against real traffic once the series exists.

### D5. Where it is shown: the workflow page, the list and the event detail

The per-workflow page (`/msp/workflow-editor/[workflowId]`, rendered in `editor-designer` mode by `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`) has no tabs. It has a header (L5831-L5849) and a properties sidebar of stacked cards (Settings L4173, Audit L4245). The skip signal belongs in the **header**, because the problem is that authors never look for it. A sidebar card would only be seen when no step is selected.

1. **`WorkflowLaunchSkipBanner`**: an `Alert variant="warning"` under the page title. It is shown only in designer mode, for a saved, published workflow with alarming skips > 0 in the last 7 days. Copy: "Skipped 14 events in the last 7 days — schema mismatch (12), payload validation failed (2)". It has a `Button id="workflow-launch-skips-view"` labelled "View skipped events" and a "Last skipped 3 minutes ago" line. There is no banner when the only skips are intentional.
2. **`WorkflowLaunchSkipsDrawer`** (`Drawer`), which opens from the banner:
   - Window `CustomSelect` (`id="workflow-launch-skips-window"`: 24h / 7d / 30d).
   - Per-reason summary rows: translated reason label, `Badge` count, last seen, and a one-line "what to fix" hint per reason (for example, mismatch → "Add a payload mapping on the trigger or change the workflow's input schema").
   - Group toggle: "Needs attention" vs. "Guarded / paused (intentional)".
   - `DataTable` drill-down. Columns: Received (relative + absolute tooltip), Event (event catalog display name, falling back to `event_name`), Reason (`Badge`), Message (truncated). **No raw IDs**: neither `skip_id`, `event_id` nor `workflow_id` is shown. Expanding a row shows the full `message` and, for validation failures, the `details.issues` rendered as a path/message list. It also has an "Open event" link to `/msp/workflow-control?section=events&eventId=…`; the ID is used only in the URL.
   - Paged server-side (`page`, `pageSize`), filterable by reason.
3. **Workflow list** (`ee/packages/workflows/src/components/automation-hub/WorkflowList.tsx`): a warning `Badge` "N skipped" next to the status badge for workflows with alarming skips in the last 7 days. It comes from one grouped query per page load, not per row.
4. **Event detail panel** (`ee/server/src/components/workflow-designer/WorkflowEventList.tsx`, `workflow-event-detail-panel` around L544-L600): a "Workflows not launched" section listing workflow **name** + reason `Badge` + message from the structured rows. The existing `error_message` line stays.

"Within one event" acceptance: the skip row is inserted synchronously while the event is processed, so the next load or refresh of the workflow page shows it. The banner also refetches on window focus. Live push is not needed.

### D6. Server actions

New file `ee/packages/workflows/src/actions/workflow-launch-skip-actions.ts`, re-exported wherever the runtime actions are exported. All actions are `withAuth` + `requireWorkflowPermission(user, 'read', knex)`, and all queries use `workflowTenantTable(knex, tenant, 'workflow_event_launch_skips')`. Zod inputs go in `workflow-runtime-v2-schemas.ts`.

| action | input | output |
|---|---|---|
| `getWorkflowLaunchSkipSummaryAction` | `{ workflowId, from? }` (default now-7d) | `{ from, alarming: { total, lastSkippedAt, byReason: [{ reason, count, lastSkippedAt }] }, intentional: { …same } }` |
| `listWorkflowLaunchSkipsPagedAction` | `{ workflowId, from?, to?, reason?, intentional?, page, pageSize }` | `{ items: [{ skipId, eventId, eventName, eventDisplayName, reason, intentional, message, details, createdAt }], totalItems }` |
| `listWorkflowLaunchSkipCountsAction` | `{ workflowIds: uuid[], from? }` | `Record<workflowId, number>` (alarming only) |
| `listEventLaunchSkipsAction` | `{ eventId }` | `[{ workflowName, workflowKey, reason, intentional, message, details }]` |

The event display name is resolved from `event_catalog` / `system_event_catalog` via the same lookup the Events tab uses. The persistence model `WorkflowEventLaunchSkipModelV2` lives in `shared/workflow/persistence/workflowEventLaunchSkipModelV2.ts`, with the re-export shim in `ee/packages/workflows/src/persistence/` + `index.ts`, following the existing pattern of `workflowRuntimeEventModelV2.ts`.

## 3. Files to change

**Schema / data**
- `server/migrations/20261010120000_create_workflow_event_launch_skips.cjs` (new; colocated distribution per D1a)
- `packages/db/src/lib/tenantTableMetadata.ts` (register table)
- `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts` (add to deletion list)
- `shared/workflow/persistence/workflowEventLaunchSkipModelV2.ts` (new)
- `ee/packages/workflows/src/persistence/workflowEventLaunchSkipModelV2.ts` + `index.ts` (re-export)

**Domain**
- `ee/packages/workflows/src/lib/workflowLaunchSkipReasons.ts` (new: codes, `intentional` map, i18n key map)

**Worker / metric**
- `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts` (collector, persistence, metric calls; keeps `error_message` semantics)
- `services/workflow-worker/src/metrics.ts` (new)
- `services/workflow-worker/src/healthServer.ts` (`/metrics`)
- `services/workflow-worker/src/index.ts` (wire metrics into the worker)
- `services/workflow-worker/package.json` (+ `prom-client`; the workspace lockfile updates with it)
- `ee/helm/workflow-worker/templates/servicemonitor.yaml` (new) and `ee/helm/workflow-worker/values.yaml` (`metrics.serviceMonitor`)

**Actions**
- `ee/packages/workflows/src/actions/workflow-launch-skip-actions.ts` (new) + the actions index export
- `ee/packages/workflows/src/actions/workflow-runtime-v2-schemas.ts` (inputs)
- `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts` (`deleteWorkflowDefinitionAction` cleanup)

**UI**
- `ee/server/src/components/workflow-designer/WorkflowLaunchSkipBanner.tsx` (new)
- `ee/server/src/components/workflow-designer/WorkflowLaunchSkipsDrawer.tsx` (new)
- `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx` (mount the banner in the designer-mode header)
- `ee/packages/workflows/src/components/automation-hub/WorkflowList.tsx` (skip badge)
- `ee/server/src/components/workflow-designer/WorkflowEventList.tsx` ("Workflows not launched" section)
- `server/public/locales/<lang>/msp/workflows.json` for en, de, es, fr, it, nl, pl, pt, sv and the `xx`/`yy` pseudo-locales (`designer.launchSkips.*`, `workflowList.launchSkips.*`, `eventList.detail.launchSkips.*`, `launchSkipReasons.*`)

**Ops (nm-kube-config, separate commit after the image ships)**
- `workflow-worker/hosted.values.yaml`, `workflow-worker/prod.values.yaml` (enable ServiceMonitor)
- `workflow-worker/prometheusrule-launch-skips.yaml` (new)

## 4. Implementation order

1. Reason taxonomy + migration + model (+ tenant metadata, tenant deletion, workflow delete cleanup).
2. Worker collector refactor with persistence. Existing worker tests stay green, with assertions on structured rows added.
3. Metrics module, `/metrics`, worker wiring, Helm ServiceMonitor.
4. Server actions + schemas.
5. Banner + drawer on the designer page; list badge; event detail section; i18n.
6. nm-kube-config values + PrometheusRule (after the image is deployed).

## 5. Tests

**Worker unit tests** (`services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts`):
- Each of the 11 reasons produces exactly one skip row with the right `reason`/`intentional`/`message`/`details`, and one metric increment with matching labels.
- **Regression for the partial-skip gap:** an event that launches workflow A and schema-mismatches workflow B persists B's skip while the event row's `error_message` stays null.
- `payload_mapping_failed` and `self_trigger_guard` / `causation_depth_exceeded` are now recorded (they were previously invisible).
- A successful launch increments `alga_workflow_event_launches_total`.
- Existing `error_message` text and conditions are unchanged (current tests at L582, L646, L755 and L822 keep passing as-is).

**Other unit tests:**
- `metrics.ts` and `healthServer.ts`: `/metrics` returns Prometheus text containing both counters; `/health` is unchanged.
- Reason-taxonomy sync test: the TS tuple equals the migration `CHECK` list; every reason has en i18n keys.

**Integration** (`server/src/test/integration/`, real DB, per the `integration-testing` skill):
- Migration up/down.
- Model `insertMany` idempotency (a duplicate `(event, workflow)` is ignored).
- Each action's tenant isolation, window filtering, alarming vs. intentional split and paging.
- `deleteWorkflowDefinitionAction` removes skips.
- Extend `workflowRuntimeV2TriggerLaunch.integration.test.ts`: publish a workflow whose trigger schema mismatches, emit one event, and `getWorkflowLaunchSkipSummaryAction` returns `schema_mismatch: 1`. This is the card's acceptance criterion as a test.

**UI component tests** (vitest + RTL):
- Banner hidden with zero or only-intentional skips; copy and pluralization; drawer table renders without ID columns; reason filter and window select call the actions with the right input.
- List badge rendering.
- Event detail section rendering.

**Helm:** `helm template` with `metrics.serviceMonitor.enabled=true` renders a valid ServiceMonitor; the default renders none.

**Manual / live (dev stack on this card, port 3913):**
- Publish a `TICKET_CREATED` workflow with a deliberately mismatched payload schema and no mapping, then create a ticket. The banner reads "Skipped 1 event in the last 7 days — schema mismatch"; the drawer shows the exact message; the event detail lists the workflow by name.
- `curl :4000/metrics` on the worker shows `alga_workflow_event_launch_skips_total{…reason="schema_mismatch",intentional="false"} 1`.
- Check light and dark themes.

**Post-deploy:** in cloudlab Prometheus, `sum by (reason) (alga_workflow_event_launch_skips_total)` returns series (alerting acceptance).

## 6. Out of scope

- Publish-time schema compatibility checks (the sibling alga0002106 work). This card is the runtime and drift detector.
- Retention/pruning for runtime events and skips.
- Backfilling skips from historical `error_message` text. That text is free-form and lacks per-workflow attribution for the partial case, so a parse would be lossy and misleading.

## 7. Risks and known limitations

- **Crash window.** If the worker dies after the event row insert but before the skip insert, the redelivered event short-circuits on the `existing` check (L171) and its skips are lost. That gap already exists for `error_message` and is unchanged here. Closing it would mean moving the idempotency marker to the end of processing, which changes launch idempotency semantics. That is a separate card if needed.
- **Metric cardinality.** The `tenant` × `workflow_id` labels are bounded by published event-triggered workflows that actually skip. If a tenant publishes hundreds of broken workflows, the series count grows linearly. That is acceptable for a counter, and the PrometheusRule aggregates.
- **Scrape through Istio** depends on PERMISSIVE mTLS in `msp` (true today: no `PeerAuthentication` exists in nm-kube-config). If STRICT is ever introduced, the ServiceMonitor needs the Istio TLS settings or metrics merging.
- **Multiple worker replicas (HPA):** counters are per pod, and the rules use `sum by` + `increase`, so restarts and replica churn are handled.
