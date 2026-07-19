# PRD — Marketing Module (Social Scheduler + Email Nurture + Opportunity Handoff)

- Slug: `2026-07-19-marketing-module`
- Date: 2026-07-19
- Status: Draft
- Branch: `feature/marketing-module`

## Summary

A marketing module for Alga PSA, built internal-first: Nine Minds dogfoods it for its own
marketing motion (LinkedIn war stories, YouTube/AlgaBob, open-source → Pro conversion), then
it ships as a tenant-facing module so MSPs early in operational maturity can run a disciplined
marketing motion instead of inventing one through trial and error.

Scope of this plan: **social content calendar + scheduling (manual publish), capture
endpoints, opportunity handoff, and email nurture (linear drip sequences)**.

Publishing is **manual everywhere**: at due time a post enters `awaiting-manual-publish` and
the user publishes it on the platform themselves. **Automation is delegated to MCP**: the
module exposes its publish loop through the existing AlgaPSA API/MCP surface, so a user who
wants automation points an MCP client (e.g. Claude Desktop with the `@alga-psa/mcp-connector`,
plus whatever platform tooling they choose) at the queue — the agent pulls due posts, publishes
externally, and marks them published. Alga never holds platform OAuth credentials and never
couples to a platform API.

## Problem

1. Nine Minds' own marketing is manual and undisciplined; weak marketing/positioning is a
   known traction constraint. The motion runs on social (LinkedIn, YouTube) with no scheduling,
   no capture-to-pipeline plumbing, and no attribution from content to opportunity.
2. The target customer — MSPs early in operational maturity — has the same problem. The focus
   anchor promises they "operate like a seasoned shop from day one"; today Alga PSA gives them
   nothing for marketing, so they invent it through trial and error.
3. Under the axioms (building cost → 0), a thin, reversible marketing module is cheap to build;
   the defensible asset is not the code but the MSP-specific motion it encodes. Platform API
   integrations would be the *least* reversible, highest-maintenance part (OAuth app reviews,
   API churn, per-platform compliance) — so they're excluded in favor of MCP delegation.

## Goals

- G1: Nine Minds can run its entire weekly marketing motion inside Alga PSA: plan content,
  schedule social posts, capture inbound interest, review it as opportunity suggestions, and
  nurture contacts via email drips.
- G2: Every marketing touchpoint (post published, email sent/opened/clicked, form submitted)
  lands in `interactions` and is visible on contact and opportunity timelines.
- G3: Inbound interest becomes an `opportunity_suggestions` record (generator_key
  `inbound-lead`); a human accepts it into an opportunity with source attribution preserved.
- G4: The publish loop is fully drivable by an agent over MCP: list due posts → get rendered
  content → mark published with permalink. No platform credentials in Alga.
- G5: The module is droppable — all marketing tables reference core tables, core never
  references marketing — and ships feature-flagged, enabled for the Nine Minds tenant first.

## Non-goals

- **Platform API integrations of any kind** — no LinkedIn/YouTube/Meta/X OAuth or
  auto-publish. Automation happens via MCP clients outside Alga.
- Social listening, unified social inbox, AI auto-reply, competitor/audience analytics.
- Visual drag-drop email designer (markdown/plain-text templates with merge fields only).
- Landing-page or site builder; A/B or multivariate testing.
- Branching automation builder (defer to the workflow engine if ever needed).
- Attribution modeling beyond first-touch source.
- MSP-specific content/template library (paid playbooks) — a later phase, not this plan.
- YouTube *video production* features (editing, thumbnails, studio tooling).

## Users and Primary Flows

**Persona A — Nine Minds marketer (dogfood, primary).**
Weekly: plan the week's content in the calendar → write/attach content pieces → schedule
posts to channels → at publish time either (a) publish manually from the queue (copy rendered
text, post, paste permalink), or (b) let Claude handle it via MCP: "publish my due Alga posts"
→ agent pulls due posts, publishes on the platforms, marks each published with permalink →
a demo-request form submission creates a marketing contact and an `inbound-lead` suggestion →
accept the suggestion in the Opportunities UI (opportunity created with source attribution) →
enroll the contact in the welcome drip → watch touchpoints accumulate on the opportunity
timeline.

**Persona B — MSP owner/operator (tenant-facing, later GA).**
Same motion aimed at *their* prospects and clients: announcements, referral asks, cross-sell
campaigns, nurture of inbound leads into their own opportunities pipeline. MSPs who want
automation connect their own MCP client; Alga's answer to "do you integrate with LinkedIn?"
is "your agent does."

## UX / UI Notes

New top-level "Marketing" nav section (behind feature flag), using standard Alga components.
**Chosen design direction: Concept B (queue-forward)** — mockups selected 2026-07-19 and
stored in `./ux/calendar.html` and `./ux/sequences.html` (open in a browser; classes use
production token names). Calendar treats the publish loop as the page's primary job; sequences
uses journey cards for the linear drip. Month-grid (Concept A) and status-board (Concept C)
alternatives were considered and rejected — see SCRATCHPAD.

- **Calendar** — agenda-forward: "Today" card with inline copy/mark-published, day groups for
  upcoming posts, "Published this week" log; month grid available as a secondary toggle.
  Amber "Needs publishing" rail highlights overdue/due targets (and nods to the MCP publish
  path).
- **Posts queue** — the full-list companion to the calendar: filter by state/channel/date,
  copy rendered per-channel text, mark published with permalink, skip.
- **Content** — library of reusable content pieces (title, markdown body, channel variants).
- **Campaigns** — campaign list/detail; detail shows posts, sequences, forms, and the funnel
  (sent → opened → clicked → captured → suggested → accepted).
- **Sequences** — horizontal journey cards (step card + delay arrow connectors) with
  per-card sent/opened stats; enrollment table below with per-contact progress bars;
  sending config (from-address, provider, unsubscribe, PostHog) as a side tile.
- **Channels** — named publishing destinations (e.g. "Robert's LinkedIn", "Nine Minds
  YouTube") with platform + handle/URL only; **no credentials, no connection flows**.
- **Forms** — hosted capture endpoint definitions and their embeddable URLs.
- Opportunity suggestions surface in the **existing Opportunities UI** (no new review surface).
- Due posts surface in the **existing User Activities dashboard** as an aggregation-only
  source (same pattern as opportunity next actions): awaiting-manual-publish targets appear
  with due date, overdue→HIGH priority escalation, and a link to the posts queue. Derived
  from live target state — publishing removes the item automatically; no notification rows.

## Requirements

### Functional Requirements

- FR1: CRUD for campaigns, content pieces, channels, and posts; a post targets one or more
  channels with a scheduled time and per-channel state.
- FR2: Manual-publish flow: at due time the post target enters `awaiting-manual-publish`; the
  user copies the rendered text, publishes on the platform, and marks it published (optionally
  pasting the permalink). Targets left unpublished past a configurable grace period flip to
  `expired`.
- FR3: The full publish loop is available as API endpoints designed for agent discoverability
  (clear registry descriptions), hence MCP-drivable via the existing connector/server:
  list due/awaiting posts, get rendered post content per channel, mark published (with
  permalink), mark skipped/expired. Same for reading campaigns, content, and funnel stats.
- FR4: Hosted capture endpoints (e.g. newsletter, demo-request) that create/update a marketing
  contact (linked to `contacts`) and record a form-submitted interaction.
- FR5: Marketing module registers as an `opportunity_suggestions` generator
  (`generator_key: 'inbound-lead'`); capture/reply events create suggestions carrying source
  attribution (campaign, content piece, form). Accepting a suggestion creates the opportunity
  with attribution intact (existing Opportunities flow).
- FR6: Linear email sequences: ordered steps (markdown template + delay), enrollment per
  contact, send via the existing outbound email abstraction, stop-on-unsubscribe and
  stop-on-manual-remove.
- FR7: Suppression handling: unsubscribe link in every sequence email; suppression list
  honored by all sends; per-contact marketing state (consent, source, unsubscribed).
- FR8: Engagement logging: post published, email sent/opened/clicked, form submitted recorded
  as `interactions` via new tenant interaction types; linked to contact, campaign, and (once
  accepted) opportunity through a marketing-owned join table.
- FR9: Email open/click tracking via the existing PostHog integration (tracking pixel +
  redirect links); no home-grown analytics store.
- FR10: Feature flag `marketing_module` gates the nav section and all surfaces.
- FR11: User Activities integration: a `fetchMarketingActivities` aggregation source (pattern:
  `fetchOpportunityActivities` in packages/user-activities) maps awaiting-manual-publish
  targets to generic activities (title, due date, overdue→HIGH priority, link to posts queue).
  Visible to all users with `marketing:manage` (team queue; no per-post assignment in v1).
  Flag-gated: returns nothing when `marketing_module` is off.

### Non-functional Requirements

- NFR1: All migrations additive; marketing tables tenant-scoped via the platform's standard
  app-layer isolation — `tenantDb` query scoping, composite `(tenant, id)` PKs, tenant-inclusive
  FKs and unique indexes (the codebase does not use RLS); module is drop-safe (FK direction
  marketing → core only). Verified by the T002 schema guard test.
- NFR2: Scheduled transitions (post due, sequence step due) run as scheduled jobs with
  at-least-once semantics and idempotent effects (no double-sends, no duplicate interactions).
- NFR3: Standard Alga permissions: `marketing:read`, `marketing:manage` (new), enforced in
  server actions, API endpoints (hence MCP), and UI.
- NFR4: Compliance floor: unsubscribe honored immediately; suppression survives contact
  deletion/re-import.

## Data / API / Integrations

New marketing-owned tables (droppable set):

- `marketing_campaigns` — name, goal, source_channel, status, date range.
- `marketing_content` — reusable piece: title, markdown body, channel variants (jsonb).
- `marketing_channels` — named destination: platform label, handle/URL. **No tokens.**
- `social_posts` — content ref, campaign ref, status
  (draft/scheduled/awaiting-manual-publish/published/expired), scheduled_at.
- `social_post_targets` — post × channel: permalink, published_at, published_by
  (user id or agent id via API token).
- `marketing_sequences` / `marketing_sequence_steps` (step order, delay, template) /
  `marketing_sequence_enrollments` (contact, sequence, current step, state, next_send_at).
- `marketing_contact_state` — contact ref, consent, source, unsubscribed_at.
- `marketing_suppressions` — email/contact, reason, source; honored globally.
- `marketing_engagements` — join: interaction_id ↔ campaign/content/post/sequence-step ids.

Reused core infrastructure (build nothing new here):

- `interactions` + `interaction_types` — engagement log (new marketing types).
- `contacts` — identity; marketing state hangs off it, never modifies it.
- `opportunities` / `opportunity_suggestions` — handoff target (generator pattern, see
  `20260712100000_create_opportunities_tables.cjs`).
- Outbound email abstraction (`docs/outbound-email-abstraction/`) — all sending.
- PostHog (`docs/posthog-api-key-guide.md`) — open/click analytics.
- **MCP server (`docs/mcp-server.md`)** — automation surface. The MCP tools
  (`search_api_registry`, `search_business_data`, `call_api_endpoint`) expose any API endpoint
  by progressive disclosure; marketing's job is well-described endpoints, not MCP-specific
  tooling. Works in both delivery forms: CE local connector (user's own API token) and EE
  remote governed server (agent identity + audit).
- Workflow engine — *not used in this phase*; linear sequences are simple tables + jobs.

## Security / Permissions

- New `marketing:read` / `marketing:manage` permissions, seeded for existing roles per
  standard permission migration pattern; enforced on API endpoints so MCP-driven agents are
  ACL-scoped like any other caller.
- No third-party credentials stored anywhere in the module (no platform OAuth).
- Capture endpoints are unauthenticated by nature: rate-limit, validate, and treat all input
  as hostile; suppression list can never be enumerated via the endpoint.
- Standard tenant isolation on every marketing table: `tenantDb` app-layer scoping with
  composite tenant PKs/FKs and tenant-inclusive unique indexes (no RLS — not used in this
  codebase; the T002 guard test verifies coverage).

## Observability

- Sequence send outcomes and job runs logged; failed sends surface in-module (enrollment
  state) — no new metrics stack.

## Rollout / Migration

- Purely additive migrations; no changes to existing table shapes.
- Feature flag `marketing_module` (off by default); enable for the Nine Minds tenant first.
- No external app reviews or OAuth verification pipelines — the previous lead-time risks
  (LinkedIn/Meta/Google/X app review) are eliminated by the MCP-delegation design.

## Open Questions

- Do sequence sends need per-tenant send windows/timezone handling in this phase, or is
  "send at step delay from enrollment" sufficient for dogfooding?
- Capture endpoint hosting: same Next.js app routes, or the extensions endpoint runner?
- Should `marketing_engagements` backfill an interaction for *historical* Nine Minds posts
  (import), or start clean from module launch?
- Should the plan include a documented **automation recipe** (example Claude Desktop config +
  prompt playbook for the publish loop) as a docs deliverable, or leave that for dogfooding
  to produce organically?
- Grace period before an `awaiting-manual-publish` target flips to `expired` — fixed default
  (e.g. 48h) or per-post configurable?
- The opportunity aggregation source reuses `ActivityType.SCHEDULE` as its type rather than
  adding an enum member; follow suit for marketing, or is it time for a generic `actionItem`
  type? (Note at implementation with a LEVERAGE marker if the enum wants generalizing.)

## Code Review Findings — Pre-Smoke Fix List (2026-07-19)

Four-area review of the implementation commits (`7e17ec6a14..c9e2ad548d`): data layer,
business logic/jobs, API/public endpoints, UI/integrations. Both blockers were independently
verified (B1 by compiling the query against the project's knex; B2 by inspecting the claim
transaction and confirming the `skipLocked` comment has no implementation). **All findings
below are in scope to fix before smoke testing begins.** Clean areas verified by the review:
tenant scoping on every query path, permission/flag pipeline on all 28 v1 endpoints,
suppression semantics (modulo B1), attribution handoff to opportunities, OpenAPI/MCP registry
sync, capture enumeration-oracle closure, house UI component usage, nav gating.

### Blockers

- **B1 — every suppression write throws at runtime.** `packages/marketing/src/lib/suppression.ts:67-73`
  stops email-matched enrollments with a knex update-with-join; the pg dialect silently drops
  the join, leaving an illegally qualified `SET "e"."state"` and a dangling `c.email` — Postgres
  rejects it at parse time, rolling back the whole suppression transaction (unsubscribe endpoint,
  manual suppression, T006/T007 flows). Slipped through because DB-gated tests auto-skip without
  a reachable database. **Fix:** select matching `enrollment_id`s via the join first, then
  `whereIn(...).update(...)`.
- **B2 — sequence send loop can double-send emails.** `packages/marketing/src/lib/sequences.ts:251-390`:
  the claim transaction (`forUpdate`) commits before the SMTP send having persisted nothing, so
  overlapping job runs (pg-boss is at-least-once), a crash between send and advance, or a failed
  post-send advance (caught and retried in 30 min) all re-send the same step. The doc comment
  claims `skipLocked` protection that does not exist. **Fix:** persist the claim inside the claim
  transaction — insert into a new idempotent send-log table (e.g. `marketing_sequence_sends`,
  unique `(tenant, enrollment_id, step_id)`) and advance `next_send_at` before releasing the
  lock; skip when the key already exists; record the interaction after a successful send.

### Majors

- **M1 — capture silently drops submissions for contacts without a client.**
  `packages/marketing/src/lib/capture.ts:68`: `String(contact.client_id)` turns null into the
  string `"null"` (invalid uuid) → engagement insert throws → route swallows it as a generic
  200; no consent update, no interaction, no inbound-lead suggestion. **Fix:** branch on null —
  create/attach a prospect client as the new-contact path does, or carry null through.
- **M2 — sibling post targets get permanently wedged in `scheduled`.**
  `packages/marketing/src/lib/posts.ts:113-135` + `rollupPostStatus`: publishing one target
  directly from `scheduled` rolls the post up to `published`, hiding sibling targets from both
  the flip job (selects posts by `status='scheduled'`) and the expiry job. **Fix:** drive the
  flip off target state joined to `posts.scheduled_at <= now`, not the rolled-up post status.
- **M3 — sequence edits destroy step identity.** `packages/marketing/src/lib/sequences.ts:54-72`
  deletes and re-inserts all steps; `marketing_engagements.step_id` is `ON DELETE SET NULL`, so
  historical per-step stats zero out, and tracking URLs already delivered in emails carry dead
  `step_id`s whose open/click recording then fails on FK. **Fix:** diff/update steps in place by
  `step_order` so `step_id`s survive edits.
- **M4 — mark-published race double-records engagements.**
  `packages/marketing/src/lib/posts.ts:165-214` is read-then-write with no status predicate on
  the UPDATE; concurrent UI + MCP-agent publishes both pass the guard (duplicate "Post
  Published" interactions, double-counted funnel), and a publish can overwrite a
  just-expired target. **Fix:** move the state check into the UPDATE's WHERE, branch on row
  count, record the engagement only when a row actually transitioned.
- **M5 — open redirect in click tracking.**
  `server/src/app/api/marketing/track/click/.../route.ts:21-65`: the `u` destination is only
  protocol-checked and the 302 fires even for unknown enrollments — anyone can mint
  phishing links on the MSP's domain. **Fix:** HMAC-sign the destination (or full tracking
  path) at send time in `trackableLinks()`; verify before redirecting.
- **M6 — unsubscribe is a state-mutating GET.**
  `server/src/app/api/marketing/unsubscribe/.../route.ts:47-81`: mail scanners/link-prefetchers
  fetch every URL in an email and will silently unsubscribe recipients; also not RFC 8058
  one-click compliant. **Fix:** GET renders a confirmation page; POST performs the mutation;
  emit `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers from
  the send path.
- **M7 — capture rate-limit key is client-controlled.**
  `server/src/lib/marketing/publicEndpoints.ts:43-53` trusts the first `x-forwarded-for`/
  `x-real-ip`/`cf-connecting-ip` header, so an attacker rotates headers for unlimited buckets;
  each accepted submission creates a prospect client + contact + suggestion (pipeline junk).
  **Fix:** derive the client IP only from the trusted proxy hop; add a per-form global rate
  cap as a backstop.
- **M8 — Reschedule button always errors for awaiting-publish posts.**
  `packages/marketing/src/components/PostsQueue.tsx:151` + `posts.ts:100-104`: the exact
  "I'll publish this tomorrow" flow is a dead button (`reschedulePostInternal` only accepts
  draft/scheduled, but the rollup puts the post in `awaiting-manual-publish`). **Fix:** allow
  reschedule from awaiting — flip targets back to `scheduled` and re-rollup.
- **M9 — sequence journey day-chips are off by one step.**
  `packages/marketing/src/components/SequencesView.tsx:170-177`: the label uses the cumulative
  delay *before* adding the step's own `delay_minutes`, so every card shows the previous card's
  send day; `journeyDayLabel` (`format.ts:68-72`) additionally disagrees with the mockup's day
  indexing. **Fix:** accumulate the step's own delay before labeling; align with
  `ux/sequences.html` numbering.
- **M10 — marketing pages render a fake-working module when the guard fails.**
  All 7 `server/src/app/msp/marketing/*/page.tsx` catch the `guardMarketing` error (flag off /
  no permission) and render the full UI with empty arrays; every action then fails with raw
  toasts. **Fix:** distinguish guard failure from empty data — render a not-enabled/permission
  boundary (or redirect) instead.
- **M11 — campaign date-only values drift a day across timezones.**
  `packages/marketing/src/components/CampaignDialog.tsx:17-25` (+ `format.ts:3-8` display):
  `new Date('YYYY-MM-DD')` parses as UTC midnight and `toISOString().slice(0,10)` serializes
  to the previous UTC day. **Fix:** handle date-only values timezone-neutrally (string split /
  house date-only helper).
- **M12 — deleting a once-enrolled contact fails on FK.**
  `server/migrations/20260719100000_create_marketing_tables.cjs:336`: the enrollments→contacts
  FK has no ON DELETE behavior; `ContactService.delete` does a bare delete and core cannot know
  about marketing tables — blocking the PRD's "suppression survives contact deletion" flow (the
  T007 test hand-deletes the enrollment to work around it). **Fix:** new migration altering the
  FK to `ON DELETE CASCADE` (the durable record is the email-keyed suppression row).

### Minors

- **N1** — public endpoints (capture/track/unsubscribe) never check the `marketing-module`
  flag (`publicEndpoints.ts:21-37`); FR10 says the flag gates everything. Fix: evaluate the
  flag in `resolvePublicMarketingTenant`, 404 when off.
- **N2** — `markPublishedSchema` permalink accepts `javascript:` URLs (stored-XSS risk when
  rendered as href). Fix: restrict to http/https (`marketingSchemas.ts:57`).
- **N3** — `createPost` inserts `campaign_id` without verifying it belongs to the tenant
  (`posts.ts:41-78`). Fix: in-tenant existence check like content/channels get.
- **N4** — duplicate active enrollments possible: check-then-insert with no partial unique
  index. Fix: migration adding `UNIQUE (tenant, sequence_id, contact_id) WHERE state='active'`
  and conflict handling in `enrollContactInternal`.
- **N5** — suppression uniqueness is plain `(tenant, email)`; nothing structural enforces
  lowercasing, so a future direct insert could bypass `isSuppressed`. Fix: functional unique
  index on `(tenant, lower(email))` or `CHECK (email = lower(email))`.
- **N6** — missing index for the sequence step-stats query. Fix: add
  `marketing_engagements (tenant, step_id)`.
- **N7** — campaign funnel email metrics are structurally always zero: sequence engagements
  never carry `campaign_id` (sequences have no campaign link). Fix: additive `campaign_id` on
  `marketing_sequences`, stamp it on sequence engagements, surface in the funnel.
- **N8** — repeat form submission doesn't restore consent (`capture.ts:109-117` merges only
  source/updated_at). Fix: merge `consent: true` on resubmission; the suppression table stays
  authoritative for sends.
- **N9** — stale comment: `marketing.interfaces.ts:33` claims interaction type_names are
  per-tenant; they're seeded globally into `system_interaction_types`. Fix wording.
- **N10** — user-activities deep-link goes to `/msp/marketing/calendar`; FR11 and UX notes say
  the posts queue. Fix: link to `/msp/marketing/posts` and update the T013 unit test.
- **N11** — `fetchMarketingActivities` silently skips the `marketing:manage` check when the
  optional `user` param is omitted (fail-open export). Fix: make `user` required.
- **N12** — calendar "This week" stats have no lower bound, counting last week's published
  posts under a "Week of X" header (`MarketingCalendar.tsx:97-109`). Fix: bound to the labeled
  week.
- **N13** — `rangeLabel` hardcodes `'en-US'` and untranslated "Week of"
  (`calendar/page.tsx:35`). Fix: build client-side via i18n.
- **N14** — posts queue lacks the date filter the PRD lists (state/channel/date). Fix: add it.
- **N15** — month-grid secondary toggle from the PRD/mockup is absent (agenda-only calendar).
  Fix: add the toggle per `ux/calendar.html`.
- **N16** — sequences "Sending" config side tile (from-address, provider, unsubscribe, PostHog)
  from the PRD/mockup is missing. Fix: add per `ux/sequences.html`.
- **N17** — campaign detail shows only the funnel; PRD says posts, sequences, forms + funnel.
  Fix: add the three lists.
- **N18** — `?create=1` deep link never cleared after the dialog closes
  (`PostsQueue.tsx:59-63`); refresh/back reopens it. Fix: strip the param on close.
- **N19** — T012's "core flows complete without errors" half has no automated coverage (only
  nav gating is tested). Resolution: covered by the Phase 1 agent-driven smoke test in
  `docs/plans/2026-07-19-marketing-smoke-test-plan.md`; no separate code change.

### Process note

The DB-backed marketing integration suite auto-skips when no database is reachable — the
mechanism by which B1 shipped green. The fix phase must run it against a real database and
fail if the suite skips (assert executed-test count > 0).

## Acceptance Criteria (Definition of Done)

1. Nine Minds tenant runs a real week of marketing entirely in-module: content planned on the
   calendar, posts scheduled to at least two channels, all published (manually and/or via an
   MCP-driven agent) with permalinks recorded.
2. An MCP client (Claude Desktop + `@alga-psa/mcp-connector`) can execute the publish loop
   end-to-end with no UI involvement: discover the endpoints, list due posts, and mark a post
   published with a permalink.
3. A demo-request form submission creates a marketing contact, a form-submitted interaction,
   and an `inbound-lead` suggestion; accepting it creates an opportunity carrying campaign/
   content source attribution.
4. A contact enrolled in the welcome sequence receives step emails at the configured delays;
   opens/clicks appear in PostHog and as interactions; unsubscribing stops all further sends
   and suppresses the address globally.
5. Dropping the marketing tables requires no changes to core tables (FK-direction check);
   feature flag off leaves zero reachable surfaces.
6. `features.json` and `tests.json` in this folder are fully checked, including the DB-backed
   integration suite (happy path + guard cases) against the migrated schema.
