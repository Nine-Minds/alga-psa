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

- NFR1: All migrations additive; marketing tables tenant-scoped with standard RLS; module is
  drop-safe (FK direction marketing → core only).
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
- Standard tenant RLS on every marketing table.

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
