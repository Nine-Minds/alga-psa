# Cutover Sequence

This artifact defines the operational cutover order after the core client-cadence parity work exists. The goal is to keep coexistence explicit instead of letting readers, writers, scheduler identity, and downstream consumers switch at unrelated times.

## Reader-First Core Cutover

### Stage A — Reader compatibility before writer cutover

- Keep invoice APIs, invoice models, preview rows, renderer adapters, portal readers, and export preview readers dual-shape aware before new writes depend on canonical recurring detail periods.
- Historical flat invoices must continue to hydrate through the same readers without synthesized canonical detail rows.
- Canonical-detail-aware readers must prefer `invoice_charge_details` when detail rows exist and fall back only when the invoice is genuinely historical or financial-only.
- Exit criteria:
  - reader hydration tests pass for both historical flat invoices and canonical detail-backed invoices
  - portal/export/reporting readers have an explicit flattening or omission policy

### Stage B — Writer cutover after reader compatibility

- Persist canonical recurring detail periods on newly generated recurring invoices only after Stage A readers are already safe.
- Keep compatibility summary fields on parent charges and invoice headers during this stage; do not remove them while dual-shape readers are still active.
- Preserve `billing_cycle_alignment` as compatibility storage only; it must not re-enter live recurring execution.
- Exit criteria:
  - new recurring invoices persist canonical detail periods consistently
  - historical invoices remain queryable without migration or rewrite

### Stage C — Scheduler identity cutover after reader and writer stability

- Introduce typed execution-window identity, selector-input payloads, and retry keys only after readers and writers already understand the canonical recurring detail model.
- Client cadence may continue using a `billingCycleId` bridge, but contract-cadence execution must be able to run from `selectorInput` plus execution-window identity without forcing a UUID billing-cycle lookup.
- Scheduler cutover is complete only when background jobs, comparison-mode traces, and retry identity all tolerate execution windows that do not map to `client_billing_cycles`.
- Exit criteria:
  - `billingCycleId` is no longer the only schedulable recurring identity
  - selector-input jobs and retries are deterministic for both client and contract cadence

### Stage D — Grouping and invoice-candidate policy cutover

- Enable explicit grouping and split rules only after scheduler identity is stable enough to select the right due work.
- Group by invoice-window identity first, then apply contract scope, purchase-order scope, currency, tax-source, and export-shape splits.
- Do not let downstream consumers infer grouping from legacy billing-cycle assumptions once mixed cadence is live.
- Exit criteria:
  - candidate groups expose explainable split reasons
  - mixed cadence no longer relies on incidental client-cycle grouping

### Stage E — Contract-cadence tenant enablement

- Make `cadence_owner = contract` tenant-writable only after Stages A through D are already stable on the client-cadence path.
- Unsupported combinations must fail fast instead of falling back to client cadence.
- Keep comparison-mode and rollout validation focused on the enabled path; do not treat dark code as evidence of cutover safety.

## Downstream Consumer Cutover

### Portal and dashboard readers

- Cut portal invoice detail and summary readers first because support workflows will notice header-versus-detail mismatches immediately.
- Keep explicit flattening or omission copy for historical/manual financial rows during coexistence.
- Do not promote portal coverage summaries to the basis for financial-state widgets such as pending-invoice counts.

### Reporting families

- Apply the reporting date-basis policy after reader compatibility is in place, not before.
- Revenue and recurring coverage reporting may pivot to canonical detail periods once the read-model contract exists.
- Expiration, reconciliation, collections, and other financial-state readers stay on their documented invoice or transaction date basis unless a later report family explicitly changes that rule.

### Accounting export readers and adapters

- Cut export repositories and preview selectors before adapter-specific payload transforms.
- Preserve per-line `service_period_source` so stored batches can contain both historical/header-fallback and canonical-detail-backed rows during coexistence.
- QuickBooks, Xero, and CSV flattening rules must be adapter-specific and additive; they must not mutate the stored source-of-truth export payload on replay or reread.

### Ordering rule across downstream consumers

- Portal and reporting readers may cut over before all adapters do, but only after the shared invoice read-model contract is already stable.
- Export adapters are the last downstream step because they depend on both reader correctness and stored export payload provenance.

## Rollback And Coexistence

### Coexistence expectations

- Historical flat invoices and canonical detail-backed invoices will remain queryable together for an extended period.
- Reader rollback means halting forward cutover or re-enabling compatibility read paths, not rewriting persisted canonical detail rows into historical flat shapes.
- Stored export batches, audit logs, and workflow payloads may legitimately contain both legacy fallback semantics and canonical recurring provenance during the coexistence window.

### Rollback posture by layer

- Reader rollback:
  - allowed if canonical-detail-aware readers regress
  - must preserve dual-shape support and must not delete canonical `invoice_charge_details`
- Writer rollback:
  - means stopping new canonical recurring writes or gating the affected path
  - must not backfill or erase already-persisted canonical detail periods
- Scheduler rollback:
  - means disabling the affected execution-window path or returning contract cadence to dark-code status
  - must not force contract-cadence identities back through fake `billingCycleId` bridges
- Downstream rollback:
  - may temporarily revert a portal/report/export consumer to its documented fallback projection
  - must preserve stored provenance fields so replay and reread remain explainable

### Long-lived coexistence guardrails

- Keep dual-shape invoice schema support until product explicitly decides that historical flat readers can be removed.
- Keep canonical recurring detail rows authoritative whenever they exist, even if a temporary rollback makes a consumer flatten them differently.
- Treat historical/header-fallback invoices as compatibility data, not as proof that new invoices may skip canonical detail persistence.
