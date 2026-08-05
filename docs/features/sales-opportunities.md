# Sales Opportunities

The opportunities module tracks MSP sales deals from first sighting through won or lost. A deal carries recurring, one-time, and hardware value in cents, moves through five open stages, and drives a per-user work queue that names the single next thing to do. Scheduled generators propose new deals from data AlgaPSA already holds: contracts nearing renewal, T&M spend that should become a contract, service categories a client doesn't buy, and assets old enough to replace.

Access is gated on the `OPPORTUNITY_MANAGEMENT` tier feature, minimum tier `pro` (`packages/types/src/constants/tierFeatures.ts`). Enterprise adds forecasting, seller rollups, pipeline meeting sessions, commitments, QBR trigger packs, and AI-drafted follow-ups.

## Where the code lives

| Path | Contents |
|------|----------|
| `packages/opportunities/src/models/` | `OpportunityModel`, step, evidence, and settings models |
| `packages/opportunities/src/actions/` | Server actions: opportunities, steps, work queue, suggestions, generators, reports, settings |
| `packages/opportunities/src/lib/` | Stage rules, step planning, work-queue buckets, discipline engine, close gates, win conversion, reporting helpers |
| `packages/opportunities/src/lib/generators/` | The four suggestion generators and the sweep runner |
| `packages/opportunities/src/components/` | Hub, board, pipeline list, queue, detail, dialogs, suggestions, reports |
| `ee/server/src/lib/opportunities/` | Forecast, seller rollups, meeting commitments, QBR, AI drafting, close-gate and handoff providers |
| `packages/ee/src/lib/opportunities/` | Enterprise seams the CE code imports through `@enterprise/lib/opportunities/*` |
| `packages/reporting/src/lib/reports/definitions/opportunities/` | Report definitions |
| `server/src/app/msp/opportunities/` | MSP routes; settings at `server/src/app/msp/settings/opportunities/` |
| `server/src/app/api/v1/opportunities/` | REST API |
| `server/src/lib/jobs/handlers/opportunity*Handler.ts` | Discipline, weekly digest, and generator jobs |
| `ee/mobile/src/features/opportunities/` | Mobile pipeline and deal detail |

## Data model

Core tables are created by `server/migrations/20260712100000_create_opportunities_tables.cjs`, with steps added in `20260804120000_create_opportunity_steps.cjs`.

**`opportunities`** holds one row per deal, keyed on `(tenant, opportunity_id)`:

- `opportunity_number` is tenant-unique and comes from the shared numbering registry (`20260712104000_register_opportunity_next_number.cjs`), so opportunities get their own auto-numbering alongside invoices and quotes.
- Value lives in three bigint columns, `mrr_cents`, `nrr_cents`, and `hardware_cents`, plus a `currency_code`. `values_locked_by_quote` is set once a quote drives the numbers.
- `status` is `open`, `won`, or `lost`. `stage` is one of `identified`, `qualified`, `assessment`, `proposed`, `verbal`, `won`, `lost`. `confidence` is `low`, `medium`, `high`, or `committed`. `opportunity_type` is `new_logo`, `expansion`, `renewal`, or `project`. All four are enforced by check constraints.
- `next_action` and `next_action_due` mirror the deal's current step. `last_activity_at` drives the going-quiet detection.
- Losing a deal records `loss_reason` (`no_response`, `chose_competitor`, `price`, `timing`, `no_budget`, `not_a_fit`, `other`), `loss_notes`, and `lost_to`.
- `generator_key`, `generator_context`, and `suggestion_id` record which generator proposed the deal. `converted_contract_id` and `converted_project_id` record what the win produced.

The remaining core tables:

- **`opportunity_evidence`** stores the checkpoints a deal has reached. It is what the stage is derived from.
- **`opportunity_suggestions`** holds generated proposals with a `dedupe_key` and a status of `pending`, `accepted`, `dismissed`, or `snoozed`.
- **`opportunity_settings`** is one row per tenant holding the discipline and generator thresholds.
- **`opportunity_steps`** and **`opportunity_step_templates`** hold the per-stage plan.

Enterprise adds four tables in `ee/server/migrations/20260712110000_create_opportunity_management_tables.cjs`: `opportunity_meeting_sessions`, `opportunity_meeting_reviews`, `opportunity_commitments`, and `opportunity_qbr_triggers`.

## Value arithmetic

One-time value is always NRR plus hardware. Every surface that shows a non-recurring number goes through `oneTimeCents()` in `lib/pipelineReporting.ts` so the dashboard, the pipeline table, and the board cannot disagree by a hardware line. Amounts are never summed across currencies: stage breakdowns, forecasts, and seller rollups group by `currency_code` and report each currency separately.

`PIPELINE_STAGE_ORDER` in the same file is the canonical order every stage breakdown renders in, because `GROUP BY` returns rows in whatever order it likes.

Once a quote is accepted the deal takes its numbers from that quote. `deriveAcceptedQuoteValues()` in `lib/quoteLifecycleHooks.ts` splits the selected quote items: recurring items become MRR, items of kind `product` become hardware, and everything else becomes NRR. `recomputeAcceptedQuoteValues()` re-runs the split across every accepted or converted quote on the deal and sets `values_locked_by_quote` while at least one such quote exists. While the flag is set, `updateOpportunity` rejects any edit to the value or currency fields and the detail view hides the edit control. Accepted quotes on one deal must share a currency, and the recompute throws if they don't.

## How a deal advances

Stage is derived, not set. `lib/stageEngine.ts` records evidence against a checkpoint (`qualified`, `assessment`, `proposed`, `verbal`, `won`), then recomputes the stage as the furthest checkpoint with active evidence. `deriveOpportunityStage()` ignores any evidence that has been corrected, and a won or lost status always wins over the evidence chain.

Evidence arrives from the system or from a person. The quote hooks in `lib/quoteLifecycleHooks.ts` supply most of the system evidence: sending a quote records `proposed`, and accepting one that carries a service listed in `assessment_service_ids` records `assessment`. Setting a stage by hand goes through `buildStageDeclarationPlan()`, which records `user_declared` evidence for the target stage and marks every piece of evidence above that stage as corrected. That is how a deal moves backwards: you cannot drop to Qualified while proposal evidence still stands, so the declaration retires it.

Each recomputation that changes the stage publishes `OPPORTUNITY_STAGE_CHANGED` after commit, keyed so the same transition cannot be published twice.

## Step plans

Each open stage can hold a plan of steps, stored in `opportunity_steps`. `lib/opportunityStepPlan.ts` holds the rules:

- A step's status is `planned`, `current`, `done`, or `skipped`. Exactly one step per deal may be `current`, enforced in the application and backstopped by a partial unique index (`idx_opportunity_steps_single_current`).
- `mirrorOfCurrentStep()` writes the current step's title and due date back to `opportunities.next_action` and `next_action_due`. The work queue, the weekly digest, and the discipline job all read those two columns, so they cannot disagree about what a deal is waiting on.
- A step with an untagged `stage` belongs to the stage the deal is on, so no step is orphaned when the deal advances.
- `unplannedRemainingStages()` returns the stages from the current one onward that have templates but no steps yet. That is what "plan the rest" adds.
- Completing a step promotes the next `planned` step by `sort_order`, then `created_at` (`nextPlannedStep()`), and records an interaction against the deal (`lib/completedActionInteraction.ts`).

Steps carry a `checkpoint` (`qualified`, `assessment`, `proposed`, `verbal`, `won`) linking plan progress to stage evidence, and can link to a ticket, a project task, an interaction, or a schedule entry.

A step with a time on it occupies a calendar slot. `scheduleWindow()` builds the window from `due_at` and `duration_minutes` with a 15-minute floor, and `lib/opportunitySteps.ts` writes the schedule entry inside the step transaction while queueing `SCHEDULE_ENTRY_*` events on the commit hook. Calendar-sync, search-index, and notification subscribers cannot tell a step-written entry from a hand-written one.

Templates in `opportunity_step_templates` are per stage, ordered by `sort_order`, and each carries a `due_offset_days` that `templateDueDate()` turns into a 9am due date. `lib/suggestedNextActions.ts` supplies the per-stage suggestions offered when someone writes a step by hand.

## The work queue

`lib/workQueueBuckets.ts` builds a user's daily queue from three item kinds:

- `action_due` — the deal's current step is due or overdue.
- `going_quiet` — nothing has happened on the deal for long enough to matter.
- `suggestion` — a pending generator proposal, carried as `IQueueSuggestionItem`.

Every item carries a `why` sentence composed by `lib/whyComposer.ts` from the facts behind it, and exactly one item on screen carries `is_screen_primary` so there is a single primary action. `lib/lessons.ts` adds insight strips from closed-deal history, such as assessment conversion rate and quote velocity. Day arithmetic uses `Temporal` against the user's timezone, not UTC subtraction.

## Suggestion generators

Four generators run on the scheduled sweep (`lib/generators/runGenerators.ts`):

| Key | Proposes | Threshold |
|-----|----------|-----------|
| `renewal` | Contracts approaching their end date | `renewal_lead_days`, default 120 |
| `tm_conversion` | Clients whose T&M spend justifies a contract | `tm_threshold_cents`, default 120000 |
| `whitespace` | Service categories a client doesn't buy | None, it reads the coverage grid |
| `asset_aging` | Assets old enough to replace | `asset_age_years`, default 6 |

`inbound-lead` is deliberately not on the sweep. Marketing creates those suggestions synchronously at capture time through `persistGeneratedSuggestions()`.

Each generated suggestion carries a `dedupe_key`. On every run, `classifyExistingSuggestion()` decides what happens to a key that already exists: a `pending` row is refreshed, a `snoozed` row whose snooze has expired is reopened, and anything else is deduped. Accepting a suggestion builds the opportunity through `lib/suggestions.ts`, which maps the generator to an opportunity type and a first next action:

| Generator | Type | First next action |
|-----------|------|-------------------|
| `renewal` | `renewal` | Start the renewal conversation |
| `tm_conversion` | `expansion` | Review the T&M comparison with the client |
| `whitespace` | `expansion` | Discuss the missing service category |
| `asset_aging` | `project` | Scope the asset refresh |
| `inbound-lead` | `new_logo` | Follow up on the inbound enquiry |

## Scheduled jobs

Three recurring jobs are registered in `server/src/lib/jobs/index.ts`, each with a per-tenant singleton key:

| Job | Default cron | Handler |
|-----|--------------|---------|
| `opportunity-generators` | `0 6 * * *` | Runs the sweep generators |
| `opportunity-discipline` | `0 7 * * *` | Nudges, escalates, and flags overdue actions |
| `opportunity-weekly-digest` | `0 8 * * 1` | Sends the weekly digest |

`lib/disciplineEngine.ts` decides per deal whether to nudge, escalate, or mark the next action overdue, using `nudge_days` (default 14) and `interrupt_days` (default 21). `escalation_mode` is `solo` or `team`: in team mode the owner's `reports_to` manager is notified. The engine writes calendar entries and manager notifications, and reports counts back through `OpportunityDisciplineResult`.

## Events

The event catalog seeds `OPPORTUNITY_CREATED`, `OPPORTUNITY_STAGE_CHANGED`, `OPPORTUNITY_STATUS_CHANGED`, `OPPORTUNITY_STALLED`, `OPPORTUNITY_NEXT_ACTION_OVERDUE`, `OPPORTUNITY_ESCALATED`, and `OPPORTUNITY_SUGGESTION_CREATED` (`20260712105100_seed_opportunity_event_catalog.cjs`). Payload builders come from `@alga-psa/workflow-streams` and are re-exported by `lib/opportunityEventBuilders.ts`. Everything publishes through `publishOpportunityEventAfterCommit()`, so no subscriber sees a deal state that a rollback would erase.

Three workflows ship seeded against those events: Opportunity stale nudge, Opportunity escalation, and Renewal suggestion generation (`20260713090000_seed_opportunity_workflows.cjs`).

## Closing a deal

Closing runs through a gate registry in `lib/closeGates.ts`. Gates register by id, `runOpportunityCloseGates()` runs all of them inside the closing transaction, and the first failure throws with the gate's reason. `ensureEnterpriseOpportunityCloseGatesRegistered()` lazily loads the Enterprise gates from `@enterprise/lib/opportunities/closeGateProvider`, which asserts tier access before contributing any.

Winning a deal (`lib/opportunityWin.ts`) can do two conversions in the same transaction: turn a linked accepted quote into a draft contract, and create a project from a template. Both are injected as dependencies rather than imported, which keeps the billing and project packages out of the opportunities package.

Two things follow a win:

- `promoteProspectClientAfterWin()` flips a client whose `lifecycle_status` is `prospect` to `active` and publishes `CLIENT_STATUS_CHANGED`. Clients in any other state are left alone.
- `getOpportunityHandoffData()` assembles what the delivery team needs on the created project, including Enterprise commitments recorded during the sale.

## Reporting

Four report definitions live in `packages/reporting/src/lib/reports/definitions/opportunities/`: `pipeline-by-stage`, `win-loss`, `assessment-conversion`, and `generator-yield`. They read through the helpers in `lib/pipelineReporting.ts` so a report and the dashboard snapshot always agree.

## Enterprise additions

- **Forecast** (`forecast.ts`). Stage base rates are `identified` 0.05, `qualified` 0.15, `assessment` 0.35, `proposed` 0.5, and `verbal` 0.8. A seller's own history replaces the base rates once they have `FORECAST_CALIBRATION_MIN_CLOSED_DEALS` (20) closed deals. Bands are produced per currency.
- **Seller rollups** (`rollups.ts`). Open and closed value per owner over a period, split by currency.
- **Meeting mode** (`meetingCommitments.ts`). Meeting sessions, per-deal reviews, and commitments with a resolution status, so what someone promised in a pipeline meeting survives the meeting.
- **QBR packs** (`qbr.ts`). Reuses the renewal, asset-aging, and whitespace generators to build a per-client trigger pack, alongside ticket-trend counts.
- **AI follow-up drafting** (`drafting.ts`). Drafts follow-up emails from the deal, its evidence, quotes, and recent interactions. The tenant's `opportunity_voice_profile` setting holds sample emails and steering instructions so drafts match the sender's voice. Credit and provider errors resolve through the AI gateway.

## Settings

`opportunity_settings` is created on first read with these defaults (`models/opportunitySettingsModel.ts`):

| Setting | Default | Drives |
|---------|---------|--------|
| `nudge_days` | 14 | Discipline nudge |
| `interrupt_days` | 21 | Escalation and going-quiet |
| `escalation_mode` | `solo` | Whether the manager is notified |
| `renewal_lead_days` | 120 | Renewal generator lookahead |
| `tm_threshold_cents` | 120000 | T&M conversion generator |
| `asset_age_years` | 6 | Asset aging generator |
| `assessment_service_ids` | `[]` | Which services count as an assessment on an accepted quote |

Edit them under Settings > Opportunities.

## Tier enforcement

`TIER_FEATURES.OPPORTUNITY_MANAGEMENT` maps to minimum tier `pro`. Server actions assert with `assertTierAccess()` (`ee/server/src/lib/opportunities/actions.ts`), API handlers with `assertTenantTierAccess()` (`apiHandlers.ts`), and the generated OpenAPI marks Enterprise routes with `x-tier-feature: OPPORTUNITY_MANAGEMENT`. On Community Edition `assertTierAccess()` returns without checking, so CE builds are not gated.

## Related topics

- [Tier gating guide](../tier-gating-guide.md) — how `TIER_FEATURES` and the gate components work
- [Quoting system](../billing/quoting-system.md) — quotes link to an opportunity through `opportunity_id`
