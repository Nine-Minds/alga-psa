# PRD — Opportunities (Sales Opportunity Module)

- Slug: `2026-07-12-sales-opportunity-module`
- Date: `2026-07-12`
- Status: Draft (pending scope confirmation)

## Summary

An MSP-first sales opportunity module — a growth engine, not a generic CRM. It has three jobs: **find the money** (pipeline generators computed from data AlgaPSA already owns: renewals, T&M conversion candidates, whitespace, aging assets), **force the follow-through** (one next-action-with-date per open opportunity, a staleness nudge/escalation ladder, a work-queue-first UI), and **own what the deal becomes** (opportunity → quote → agreement + onboarding project, using the pre-wired `quotes.opportunity_id` link). CE ships the full solo-owner growth engine; EE adds the management layer (forecast bands, per-seller calibration, pipeline meeting mode, commitments ledger with close gates, QBR program, multi-office rollups, customizable methodology workflows). Light AI tie-ins (follow-up drafting, "write this in my voice" steering) are gated behind the existing AI module seam.

Design research (persona interviews + full codebase integration map) lives in `research/`.

## Problem

Sub-20-seat MSP owners have no sales process; the owner is the process, and deals die by avoidance — threads going stale in an inbox with nothing external forcing the follow-up moment. Larger MSPs have the opposite failure: pipelines that lie (stages reflecting seller optimism, close dates rolling forward monthly, forecasts nobody trusts), sales-to-onboarding handoffs that drop verbal promises, and account managers who run backward-looking QBRs that generate zero expansion pipeline. Generic CRMs fail both: they start empty, demand data-entry ceremony, know nothing about the MSP's tickets/billing/assets, and don't own the objects a won deal must become. AlgaPSA owns the whole downstream — quotes, agreements, projects, invoices — and the billing/asset history that proves where unrealized revenue sits.

Product criterion: the module must literally teach an MSP owner to grow the business — with the owner's own numbers, not methodology content.

## Goals

1. Pipeline that **starts full**: generators surface renewal, T&M-conversion, whitespace, and asset-refresh opportunities from existing tenant data, each with its evidence attached.
2. Follow-through discipline: every open opportunity carries exactly one next action with a due date; staleness triggers a private nudge, then an interrupting escalation. The work queue ("do these today") is the home surface.
3. Evidence-derived stages (6-stage assessment-centric ladder) with separately-declared rep confidence; no stage percentages, no configurable pipelines.
4. Full spine: opportunity ↔ quote (FK the existing `quotes.opportunity_id`), quote → agreement conversion (exists), won → onboarding project from a project template.
5. MRR/NRR/hardware as first-class split values, derived from linked quote lines where present.
6. EE management layer: forecast floor/ceiling bands, per-seller calibration, pipeline meeting mode, commitments ledger with enforced close gates, QBR trigger program for AMs, multi-office rollups.
7. AI (behind AI module seam): in-app follow-up draft generation and a per-user "write this in my voice" steering profile. Drafts are always human-reviewed and human-sent.
8. Workflow-engine integration: OPPORTUNITY_* events in the CRM catalog, `opportunities.*` actions, methodology (nudges/escalation/renewal generation) shipped as default-on system workflows customizable via the (EE) Designer.

## Non-goals

- A separate leads/deals/accounts object taxonomy. Prospects are lightweight `clients` rows with a new lifecycle status.
- Configurable pipeline stages or stage-probability percentages.
- Mailbox integration: email auto-logging, inbox mining, open/click tracking. (Future plan; outbound send via existing tenant email is in scope.)
- Auto-sending anything to a client. Ever. Drafts only.
- Marketing: campaigns, sequences, lead scoring, web forms.
- Peer pricing benchmarks (cloud/EE, separate plan).
- Commission calculation (calibration reports provide the data; payout math is out of scope).
- Client-portal-facing opportunity surfaces.
- Territory management / sales quotas.

## Users and Primary Flows

Personas: **Dana** (solo owner, sales-avoidant, needs an anti-avoidance machine — see `research/persona-dana.md`) and **Sam** (25 techs, 3 offices, 1 seller + 2 AMs, needs an honesty machine — see `research/persona-sam.md`).

Primary flows:

1. **Work the queue (daily, CE)**: open Opportunities → work queue lists overdue/due next actions, stalled deals, and pending generator suggestions. Complete an action → immediately prompted for the next action + date (the chain never breaks). One-click: log interaction, open draft (AI), snooze, mark lost.
2. **Accept a suggestion (CE)**: generator fires ("3 clients on T&M spent more than an agreement would cost") → review evidence one-pager → accept (creates opportunity pre-filled with values + provenance) / dismiss (won't refire) / snooze.
3. **Run a deal (CE)**: opportunity detail shows evidence ladder, declared confidence, MRR/NRR/hardware, timeline (interactions), linked quotes. Create/link quote from the opportunity; quote send/accept advances the stage automatically.
4. **Close a deal (CE)**: won → guided conversion: quote → agreement (existing conversion), spawn onboarding project from a chosen project template, client lifecycle prospect → active. Lost → required loss reason (+ optional lost-to).
5. **Monday pipeline meeting (EE)**: meeting mode walks the open pipeline deal-by-deal: evidence vs declared confidence gap, days silent, next action; mark reviewed; end with forecast band.
6. **QBR prep (EE)**: AM opens account's trigger pack (renewal at T-120, aging assets, EOL OS, ticket trend, whitespace rows) → "Create opportunities?" → tracked from QBR to created pipeline.
7. **Draft a follow-up (AI, EE)**: from a stale deal, generate a draft using opportunity context + the user's voice profile; edit; send via tenant email; send is logged as an interaction.

## UX / UI Notes

### Design language (decided 2026-07-12 — the "Docket + Advisor" hybrid)

Reference mockups: `mockups/work-queue-hybrid.html` (canonical), `mockups/work-queue-directions.html` (the A/B/C exploration it was chosen from). Every module surface follows these rules:

1. **Finishable, never infinite.** The queue is a single centered column with a beginning, sections (Do today → Going quiet → Money found), and an explicit bottom ("That's everything. Nothing else needs you today."). No surface is an open-ended dashboard the user "owes" attention to.
2. **Why-sentences everywhere.** Every queue row, suggestion, and nudge carries a one-sentence explanation assembled from evidence facts — day counts, quote refs, checkpoint states, historical ratios ("Day 9 since the proposal and Marisol has emailed twice. The answer is drafted from quote Q-2041."). Sentences are template-composed from structured facts so they are always true, fully functional in CE without AI; the AI seam later upgrades fluency, never honesty. One bold clause per sentence — the fact that matters most.
3. **One primary button per screen.** Only the single most urgent item gets the primary (purple gradient) action; everything else is soft or ghost. The screen itself says where to start.
4. **Dollar-forward found money.** Generator suggestions lead with the computed value in large type, then what it is, then how to act. The section is subtitled with its provenance ("from billing, contracts, and assets — nothing typed in").
5. **Teach with the tenant's own numbers.** The queue closes with a lesson strip — one computed insight from their history ("You close 4 of every 5 assessments you propose. You haven't proposed one since March.") with a single follow-up action. Never generic methodology content.
6. **Greeting carries the stakes.** The queue header addresses the user by name and totals the found money ("…and $4,650/mo is sitting in your own data").

### Surfaces

- Top-level nav item **Opportunities** (`/msp/opportunities`), tabs: **Queue** (default), **Pipeline** (list), **Board**, **Suggestions**, plus EE: **Meeting**, **Forecast**. Settings under `/msp/settings` (thresholds, generator config, assessment service mapping).
- The work queue is the home surface — never an empty funnel chart. Empty states celebrate ("no actions due") rather than shame.
- Board: stage columns Identified → Verbal (+ recently Won/Lost rail). Cards move by evidence; forward drag is only allowed onto declared-type checkpoints (Qualified); drag to Lost prompts loss reason. Cards show MRR/NRR, staleness badge, next-action due.
- Opportunity detail: evidence ladder rendered as checkpoints with their source facts (linked quote/project/contract refs); confidence dropdown (low/medium/high/committed); commitments section (EE); timeline reuses interactions UI.
- Client detail gets an Opportunities tab; prospect clients are visually distinct and filtered out of operational client lists by default.
- Solo-mode escalation = interruption: an auto-created ad_hoc schedule entry ("Follow up: {opportunity}") on the owner's calendar; team mode notifies the owner privately first, manager second. Never a public wall of shame.
- Weekly digest notification (existing notification/email templates): actions due, stalled deals, new suggestions, wins.
- No raw IDs anywhere; currency via the standard currency components (values entered/displayed per tenant currency config).

## Requirements

### Functional Requirements

**FR1 — Data model (CE).** `opportunities` table (tenant-scoped): number (`OPP-` via next_number), client_id (required), contact_id, title, type (new_logo | expansion | renewal | project), owner (defaults to client account manager, else creator), status (open | won | lost), derived stage, declared confidence (low/medium/high/committed), mrr_cents / nrr_cents / hardware_cents + currency, expected_close_date, next_action + next_action_due (required while open), last_activity_at, loss_reason/lost_to, provenance (generator key + context), converted refs (contract, project). `opportunity_evidence` records checkpoint facts (checkpoint, source system|declared, ref). `opportunity_suggestions` holds generator output (status pending|accepted|dismissed|snoozed, dedupe key). `clients.lifecycle_status` (prospect | active | former; backfill active). FK `quotes.opportunity_id` → opportunities. `interactions.opportunity_id`. Tag support (`opportunity` entity type).

**FR2 — Stage engine (CE).** Stage = furthest evidence checkpoint reached: Identified (exists) → Qualified (declared: decision-maker + budget conversation) → Assessment (assessment quote accepted / assessment project created) → Proposed (linked quote sent) → Verbal (quote accepted / contract sent for signature) → Won/Lost (status). System evidence is recorded automatically from quote/contract/project events; deals may skip checkpoints (renewals enter at Proposed). Evidence can't be deleted, only corrected with an audit note. Declared confidence is separate and never alters stage.

**FR3 — Discipline engine (CE).** Next action + due date required to keep an opportunity open (create and complete-action flows both enforce it). Staleness ladder from `last_activity_at`: nudge notification at 14 days (tenant-configurable), interrupt at 21 (solo: calendar block; team: escalate to owner/manager chain). Work queue aggregates due/overdue actions, stalled deals, pending suggestions; opportunity next actions also appear in the User Activities dashboard via a new activity source. Weekly digest email. Queue rows and nudges render **why-sentences** composed by a fact-templating engine from structured evidence (day counts, linked-artifact refs, checkpoint states, historical ratios) — no AI dependency; the digest and notifications reuse the same composer.

**FR4 — Generators (CE).** Each produces suggestions (never opportunities directly), with evidence payload and dedupe: (a) **Renewal** at T-120 from client_contract end dates/renewal work items, linked 1:1 to the renewal work item, MRR prefilled from contract monthly value; (b) **T&M conversion**: trailing-12 hourly/T&M billing per client vs threshold, with a printable spend-vs-agreement one-pager; (c) **Whitespace**: service-category × client grid from active contract lines, cell-click creates suggestion; (d) **Asset aging**: assets past warranty/age or EOL OS per client. Generators run on schedule (job system) and on demand.

**FR5 — Spine (CE).** Create/link quote from opportunity (populating `quotes.opportunity_id`); quote lifecycle events advance evidence; opportunity values recompute from linked accepted quote lines (is_recurring → MRR; product kind → hardware; else NRR) with manual override before a quote exists. Won flow: convert accepted quote → draft agreement (existing conversion), optional project-from-template spawn, prospect → active lifecycle transition (emits CLIENT_STATUS_CHANGED). Won without a quote is allowed (manual values, reduced evidence).

**FR6 — Workflow integration (CE events/actions; EE customization).** Emit OPPORTUNITY_CREATED / STAGE_CHANGED / STATUS_CHANGED / STALLED / ESCALATED / NEXT_ACTION_OVERDUE / SUGGESTION_CREATED + CLIENT_STATUS_CHANGED via domain event builders; catalog migration. Register `opportunities.create/find/update/set_next_action` actions with Zod schemas. Nudge/escalation/renewal-generation methodology ships as default-on system workflows; editing them requires the EE Designer as today.

**FR7 — Reports (CE).** Registry definitions: pipeline by stage (count/MRR/NRR), win/loss with reasons, assessment→agreement conversion, generator yield (suggestions → accepted → won, by generator). Dashboard widget: pipeline snapshot + queue summary. **Lesson strip** on the queue: one computed own-numbers insight per visit (e.g. assessment close rate vs. assessments proposed this quarter) with a single follow-up action, drawn from a small library of insight computations that degrade gracefully when history is thin.

**FR8 — Management layer (EE, tier-gated).** (a) Forecast bands: floor (verbal + won this period) and ceiling (evidence-weighted; per-seller calibrated once history exists), always shown as a band with composition; (b) per-seller calibration: declared confidence vs actual close rate, attach rate (new logos closing with an agreement), realized effective rate vs quoted; (c) pipeline meeting mode: full-screen deal-by-deal review with evidence-vs-declared gap, days silent, reviewed markers; (d) commitments ledger: promises recorded on the opportunity, each must resolve to a quote line / agreement line / project task or be explicitly declined before close-won is allowed; (e) QBR program: per-account trigger packs for AMs, one-click opportunity creation, QBR→pipeline tracking; (f) rollups by office (attribution rule: open question) and by seller.

**FR9 — AI tie-ins (EE, behind the AI module seam).** (a) Follow-up draft generation from opportunity context (timeline, stage, quote state, staleness) in the opportunity detail and queue; drafts open in an editor and send through existing tenant outbound email; sends log as interactions. (b) "Write this in my voice": per-user voice profile (pasted sample emails and/or steering instructions, e.g. "plain, terse, no exclamation points") stored and applied to every draft; editable; per-draft tone adjustment. No auto-send; no background generation against client data beyond the deal's own context.

**FR10 — Permissions & product gating.** New permission resource `opportunities` (create/read/update/delete) seeded via migration, MSP portal only; suggestions/generators governed by the same resource. Routes registered in productSurfaceRegistry: PSA allowed; AlgaDesk `upgrade_boundary` (the module is the AlgaDesk→PSA upgrade trigger). EE features behind tier gating; AI behind the AI module seam; PostHog flag for soft launch.

### Non-functional Requirements

- Queue and pipeline views stay fast at thousands of open opportunities (server-side pagination/filtering; no N+1 on value rollups). "Screens so slow reps refuse" is a named adoption killer.
- Updating a deal (complete action + set next) is a sub-30-second interaction.
- All mutations tenant-scoped through the standard CitusDB patterns; migrations additive and reversible.

## Data / API / Integrations

- Migrations: `opportunities`, `opportunity_evidence`, `opportunity_suggestions`, `clients.lifecycle_status`, `interactions.opportunity_id`, FK on `quotes.opportunity_id`, permission seed, event-catalog seed, notification/email templates, next_number entity `OPPORTUNITY`.
- Package: `packages/opportunities/` (models/actions/schemas/components per house pattern) + msp-composition provider; EE surfaces under `ee/`.
- REST API v1: `/api/v1/opportunities` CRUD + `/suggestions` accept/dismiss/snooze + `/evidence`, following the quotes controller/service/OpenAPI pattern.
- Consumes: quote lifecycle events (Proposed/Verbal/Won evidence), contract conversion (existing), project templates (won spawn), renewal work items (renewal generator), invoices/time entries (T&M generator), contract lines + service catalog (whitespace), assets (aging generator), interactions (timeline + last_activity), schedule ad_hoc entries (solo interrupts), notifications/email (nudges, digest), user-activities aggregator (queue source), reporting registry, job scheduler (generator runs), tags.

## Security / Permissions

- RBAC rows for `opportunities` resource; EE record-level scoping (own vs all) can ride the ABAC kernel later — v1 is tenant-wide with role gates.
- Prospect client rows respect existing client permissions; no client-portal exposure.
- AI drafting operates only on the tenant's own opportunity context; voice profiles are per-user data.

## Observability

- Standard action logging only; generator runs log summary counts (fired/deduped) for supportability. Nothing bespoke in v1.

## Rollout / Migration

- All schema changes additive. `lifecycle_status` backfills to `active` for every existing client (no behavior change); prospect is opt-in going forward. `quotes.opportunity_id` FK added after verifying all values NULL (column was never populated).
- PostHog feature flag gates the nav item for soft launch; module is inert until visited.
- Phases: **P1** data model + spine + CRUD/detail/board/list, **P2** discipline engine (queue, ladder, digest, activities integration), **P3** generators + suggestions, **P4** reports + dashboard widget, **P5** EE management layer, **P6** AI tie-ins.

## Open Questions

- Office attribution for EE rollups: derive from opportunity owner's assigned location vs an explicit field on the opportunity.
- Qualified checkpoint: bare declaration toggle vs requiring a linked decision-maker contact.
- Assessment detection: convention for marking a quote/service as an assessment (service category flag vs per-tenant mapping in settings).
- Suggestion snooze semantics (fixed durations vs until-date) and whether dismissals expire (e.g. T&M candidate re-fires after 12 months of continued overspend).
- Confidence enum final labels; whether "committed" implies a required expected_close_date within the period.
- Whether the weekly digest is on by default for all users with opportunity ownership or opt-in.

## Acceptance Criteria (Definition of Done)

1. A tenant with existing contracts, T&M billing history, and assets sees populated suggestions on first visit — the module starts full with zero manual entry.
2. An opportunity cannot be open without a next action + due date; completing an action forces setting the next one; a silent deal produces a nudge at the configured threshold and an interrupting escalation after it.
3. Sending a linked quote moves the deal to Proposed with a visible evidence ref; accepting it reaches Verbal; converting to an agreement + spawning a project closes it Won and flips a prospect client to active, emitting catalogued events throughout.
4. MRR/NRR/hardware values derive from linked quote lines and roll up correctly in pipeline reports.
5. EE tenants get forecast bands, calibration, meeting mode, commitments close-gates, and QBR trigger packs; CE tenants see none of them and lose nothing from the CE loop.
6. AI drafting works only when the AI module is enabled, always produces an editable draft (never sends), and honors the user's voice profile.
7. AlgaDesk users hitting `/msp/opportunities` get the upgrade boundary; PSA CE users get the full CE module.
8. DB-backed integration tests cover the stage-evidence engine, generator suggestion creation/dedupe, and the won-conversion flow against migrated schema.
9. The queue renders the decided design language: why-sentences composed from evidence facts (true without AI), exactly one primary action on the screen, dollar-forward suggestion cards, greeting with found-money total, lesson strip, and an explicit bottom.
