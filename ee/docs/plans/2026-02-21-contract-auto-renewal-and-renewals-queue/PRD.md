# PRD — Contract Auto-Renewal and Renewals Queue

- Slug: `contract-auto-renewal-and-renewals-queue`
- Date: `2026-02-21`
- Status: Draft

## Summary
Add first-class contract renewal management to Billing Contracts: renewal settings during contract setup, a dedicated actionable Renewals queue, and due-date automation that can create internal tickets. The system must support fixed-term and evergreen contracts, tenant defaults with optional per-contract override, and runtime compatibility for both on-prem (`pg-boss`) and hosted/EE (`Temporal`) automation execution.

## Problem
MSPs currently rely on `end_date` awareness and ad-hoc process to decide whether to renew or terminate contracts. This creates avoidable revenue leakage, missed non-renewal notices, and inconsistent ownership of renewal decisions.

Current contract surfaces support start/end dates and expiration reporting, but they do not support:
- explicit renewal behavior on each contract assignment,
- a single operational queue for upcoming renewal decisions,
- standardized queue actions (`renewing`, `non-renewing`, `create draft`, `snooze`),
- configurable due-date automation (ticket creation) with assignment defaults.

## Goals
1. Capture renewal intent and notice-window behavior at contract creation/edit time.
2. Compute and surface a single operational date (`decision_due_date`) for renewal work.
3. Provide an actionable Renewals queue with 90-day triage buckets and owner/status workflows.
4. Support tenant-level defaults with optional per-contract override.
5. Automatically create internal renewal tickets at due date when configured.
6. Support fixed-term contracts and evergreen annual-review flow in the same queue model.
7. Ship as one cohesive release spanning wizard, queue, actions, and automation.

## Non-goals
1. Sending customer-facing renewal quote emails from queue actions.
2. New billing/invoice pricing engines for renewal uplift or pro forma quoting.
3. Full CLM/legal document lifecycle features.
4. Replacing existing contract status model (`draft`, `active`, `terminated`, `expired`) in this release.
5. New feature-flag infrastructure or rollout orchestration beyond normal release controls.

## Users and Primary Flows
- Billing manager / account manager:
  - sets renewal behavior during contract creation/edit,
  - reviews upcoming decisions in queue,
  - marks contracts renewing or non-renewing,
  - snoozes decisions with explicit date.
- Service manager / coordinator:
  - owns assigned renewal tasks,
  - works queue by due-date buckets,
  - opens renewal draft contracts from queue.

Primary flows:
1. Create fixed-term contract with end date, choose renewal behavior and notice period.
2. Create evergreen contract (no end date) with annual-review configuration.
3. Review queue by `0-30`, `31-60`, `61-90` decision windows.
4. Mark `renewing` and auto-create next-term draft contract.
5. Mark `non-renewing` and close renewal work item.
6. Snooze and assign renewal work item.
7. Due-date automation creates internal ticket when configured.

## UX / UI Notes
1. `Contract Basics` step (`ContractWizard`) gets a conditional `Renewal Settings` card:
- if `end_date` exists: fixed-term renewal settings.
- if `end_date` absent: evergreen annual review settings.

2. Billing gets a new top-level `Renewals` tab/page:
- queue table with filters + action menu,
- default horizon 90 days,
- bucket presets and owner filters.

3. `Client Contracts` tab gets an `Upcoming Renewals` summary widget:
- count by 0-30 / 31-60 / 61-90,
- quick entry into Renewals queue.

4. Queue actions in v1:
- `Mark renewing` (auto-create renewal draft and open editor),
- `Mark non-renewing`,
- `Create renewal draft`,
- `Snooze`.

5. Queue primary sort key is `decision_due_date` (not raw contract end date).

## Requirements

### Functional Requirements

#### FR1 — Contract Setup and Renewal Configuration
1. Capture renewal settings on client contract assignments in the contract wizard and edit flows.
2. Support renewal modes: `none`, `manual`, `auto`.
3. If fixed-term (`end_date` set), capture notice period and renewal term behavior.
4. If evergreen (`end_date` null), capture annual-review cadence and notice period.
5. Validate incompatible states in UI and server (e.g., auto-renew with missing term strategy when required).

#### FR2 — Tenant Defaults and Contract-Level Overrides
1. Add tenant defaults for renewal behavior and due-date automation target.
2. Support per-contract override toggle (`use tenant defaults` vs explicit override values).
3. Preserve deterministic fallback behavior when override values are partially unset.

#### FR3 — Renewal Decision Date Engine
1. Compute `decision_due_date` for each active client contract.
2. Fixed-term formula: `decision_due_date = end_date - notice_period_days`.
3. Evergreen formula: derive next anniversary window and subtract notice period days.
4. Recompute decision dates when contract dates/settings change.
5. Prevent duplicate active work items for the same contract renewal cycle.

#### FR4 — Renewals Queue and Dashboard Entry Points
1. Add `Renewals` Billing tab and queue page.
2. Add `Upcoming Renewals` widget in `Client Contracts` tab.
3. Queue must support filters: horizon, bucket, owner, status, renewal mode, fixed/evergreen.
4. Queue must show due-date centric columns and actions.

#### FR5 — Queue Actions and Renewal Workflow
1. Add queue statuses: `pending`, `renewing`, `non_renewing`, `snoozed`, `completed`.
2. Implement action transitions with actor + timestamp + optional note.
3. `Mark renewing` must auto-create draft renewal contract (per chosen product decision).
4. `Create renewal draft` must be available as explicit independent action.
5. `Snooze` must require a future target date.

#### FR6 — Automation and Ticket Creation
1. At `decision_due_date`, create/update queue work item if unresolved.
2. When tenant/contract policy says `create internal ticket`, create one ticket idempotently.
3. Store linkage from renewal work item to created ticket.
4. Ticket defaults (board/status/priority/assignee) must come from renewal automation settings.

#### FR7 — Evergreen Annual Review Flow
1. Include evergreen contracts in queue using annual review cycle date.
2. Support the same status/actions as fixed-term contracts.
3. After a cycle is completed, prepare next evergreen cycle work item.

#### FR8 — Reporting and Existing Surface Alignment
1. Align existing contract expiration reporting with renewal decision model.
2. Preserve existing expiration semantics while adding decision-due visibility.
3. Avoid regressions in existing `Contract Expiration Report` consumers.

#### FR9 — Runtime Compatibility (On-prem PG Boss vs Hosted/EE Temporal)
1. Renewal automation job path must support on-prem `pg-boss` runtime.
2. Renewal automation job path must support hosted/EE `Temporal` runtime.
3. Ensure behavior parity regardless of runtime (idempotency, ticket creation, retry semantics).
4. Respect existing runtime selection and fallback patterns (`JobRunnerFactory`).

#### FR10 — Permissions, Security, and Auditability
1. Restrict queue mutations to authorized billing users.
2. Ensure tenant isolation in all queue queries and actions.
3. Record auditable state transitions and key actor metadata.

### Non-functional Requirements
1. Queue list queries for default 90-day horizon should complete within existing Billing table UX expectations.
2. Renewal work-item creation and ticket automation must be idempotent across retries.
3. Runtime-independent behavior parity must be verified between `pg-boss` and `Temporal` paths.
4. All date handling must use existing date-only conventions for contract dates to avoid timezone drift.

## Data / API / Integrations

### Data model additions
1. `client_contracts` additions (assignment-level settings):
- `renewal_mode` (`none|manual|auto`)
- `notice_period_days` (int)
- `renewal_term_months` (nullable int)
- `use_tenant_renewal_defaults` (bool)
- evergreen cycle metadata (as needed for annual review computation)

2. `default_billing_settings` additions (tenant defaults):
- default renewal mode
- default notice period
- due-date action policy (`queue_only` or `create_ticket`)
- default ticket routing fields (board/status/priority/assignee)

3. New queue table (recommended): `client_contract_renewal_work_items`:
- work item identity + tenant + client_contract_id
- `decision_due_date`, `cycle_start`, `cycle_end`
- `status`, `assigned_to`, `snoozed_until`
- `created_ticket_id`, `created_draft_contract_id`
- `last_action`, `last_action_by`, `last_action_at`, note/reason fields

### API / action surfaces
1. Extend `ClientContractWizardSubmission` and related actions to include renewal settings.
2. New renewal queue actions:
- list/query queue
- mark renewing
- mark non-renewing
- create renewal draft
- snooze
- assign owner

3. Integrate with existing ticket creation action path (`tickets.create`) for automation side effects.

### Integrations
- Billing dashboard/tab composition.
- Contract wizard basics step.
- Existing event bus + workflow runtime event model.
- On-prem scheduled jobs via `pg-boss`.
- Hosted/EE automation via `Temporal`.

## Security / Permissions
1. Read queue: billing read permission.
2. Mutate queue actions: billing update permission.
3. Tenant defaults changes: billing settings update permission.
4. Ticket automation execution: system/service actor with tenant-scoped permission enforcement.

## Observability
No net-new observability framework is required for v1. Reuse existing audit/event patterns and existing job/runtime failure reporting surfaces. Track enough state in renewal work items to diagnose retries and failures without adding a separate telemetry subsystem.

## Rollout / Migration
1. Add schema migrations for new contract renewal columns, default settings fields, and queue table.
2. Backfill existing active fixed-term contracts with deterministic defaults (`manual`, default notice period, tenant default usage).
3. Do not auto-create queue/tickets for historical expired/terminated contracts.
4. Stage rollout sequence:
- deploy schema + read-compatible code,
- deploy write paths and queue UI,
- enable scheduled automation processing.

## Open Questions
1. Should renewal automation ticket defaults be separate from inbound-ticket defaults, or reuse them where unspecified?
2. What is the canonical evergreen anniversary anchor for contracts with manually edited start dates over time?
3. Do we require a hard block against activating renewal drafts until the original contract is marked renewing/non-renewing, or allow parallel status transitions?

## Acceptance Criteria (Definition of Done)
1. Contract wizard supports fixed-term and evergreen renewal settings and persists them per client contract assignment.
2. Billing has a functional Renewals queue tab with 90-day buckets and required actions.
3. `Client Contracts` includes upcoming-renewals summary widget linked to queue.
4. `Mark renewing` auto-creates and links a renewal draft contract.
5. Due-date automation creates at most one ticket per renewal cycle when policy is enabled.
6. On-prem (`pg-boss`) and hosted/EE (`Temporal`) execute equivalent renewal automation behavior.
7. Existing contract expiration report remains functional and reflects decision-date semantics where applicable.
8. Features/tests checklists are populated and traceable to this PRD.
