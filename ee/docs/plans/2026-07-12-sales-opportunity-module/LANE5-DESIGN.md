# Lane 5: Generators and reports backend

## Architecture

Generators are tenant-scoped data readers. Each generator returns facts without mutating the database. `runGenerators` owns suggestion persistence, dedupe, snooze reopening, event publication, and run summaries. This keeps generator queries independently testable and gives scheduled and on-demand runs identical lifecycle behavior.

Suggestion lifecycle mutations share transaction-level helpers between server actions and REST. Accepting a suggestion locks the suggestion row, creates one opportunity with generator provenance, and changes the suggestion to `accepted` in the same transaction. Dismiss and snooze update the same row that the work queue reads.

Reports use the existing reporting registry and definition engine. The dashboard snapshot remains an Opportunities server action because it combines tenant-wide pipeline totals with the authenticated user's queue.

## Billing facts

Renewal monthly value uses the same contract-line `custom_rate` rollup as the contract expiration report. The rollup is extracted into a shared billing helper so the report and renewal generator cannot drift.

T&M spend comes from non-draft, non-cancelled invoices joined to `invoice_charges` through `invoice_time_entries.item_id`. This is the strongest persisted proof that an invoiced charge came from an actual time entry. Grouping uses invoice date and `invoice_charges.net_amount`. A client with more than one invoice currency in the trailing window is omitted because those amounts cannot be added honestly without an exchange-rate policy.

## Generator decisions

- Renewal considers active assignments whose fixed-term end date or evergreen decision date falls between today and the configured lead horizon. The contract assignment is the existing renewal work item, so evidence uses its `client_contract_id` as `renewal_work_item_id`.
- T&M uses 12 UTC calendar buckets, including the current month, and a UTC calendar-quarter dedupe key.
- Whitespace includes clients with an active contract today. Category presence comes from active contract lines and their active catalog services. A category becomes comparable when at least 50% of active-contract clients buy it. Adoption is computed against all active-contract clients, including clients whose current lines have no categorized services.
- Asset aging uses `purchase_date` when present. When purchase date is absent, `warranty_end_date` is the fallback age anchor. This avoids inventing hardware values or lifecycle dates.

## Lifecycle defaults

Accepted renewal suggestions create renewal opportunities. T&M conversion and whitespace create expansion opportunities. Asset aging creates project opportunities. Every accepted opportunity receives a generator-specific next action due seven days after acceptance unless the caller supplies an override.

## Failure handling

Each generator persistence pass is transactional. A failed run publishes no suggestion-created events. Scheduled runs may safely retry because dedupe keys are unique per tenant and generator. Accepted and dismissed keys remain terminal. Pending keys refresh their facts, future snoozes remain closed, and expired snoozes return to pending.

## Verification

Behavioral tests cover dedupe and snooze transitions, generator fact calculations, accept prefill/provenance, and report registration. Typechecks cover Types, Opportunities, Reporting, and Server. No UI-owned components or the why-sentence composer change in this lane.
