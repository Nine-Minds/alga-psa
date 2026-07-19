# SCRATCHPAD — Marketing Module

Rolling notes: decisions, discoveries, links, commands, gotchas.

## Decisions (2026-07-19, design brainstorm)

- **Internal-first / dogfood**: build the tenant-facing module but enable it for the Nine
  Minds tenant first. Nine Minds' own funnel (LinkedIn war stories, YouTube/AlgaBob,
  open-source → Pro nurture) is the validation harness. Rationale: most reversible way to
  build (axiom 4); no customer depends on v1.
- **Scope = Phase 0 + email nurture**: social calendar/scheduling, capture endpoints,
  opportunity handoff, linear drip sequences. MSP playbook/template library deferred.
- **Publishing: manual everywhere; automation delegated to MCP** (pivot, 2026-07-19).
  Originally scoped as EE platform API integrations (LinkedIn/YouTube/Meta/X OAuth +
  auto-publish) with CE manual-only; user pivoted: remove ALL platform integrations. The
  publish loop is exposed as well-described API endpoints, which the existing MCP surface
  (`search_api_registry` / `call_api_endpoint`, docs/mcp-server.md) makes agent-drivable —
  users who want automation point Claude (or any MCP client) at the queue with whatever
  platform tooling they choose. Rationale: platform API coupling was the least-reversible,
  highest-maintenance part of the design (OAuth app reviews, API churn, per-platform
  compliance); MCP delegation moves that coupling outside Alga entirely, and Nine Minds
  dogfoods with Claude + `@alga-psa/mcp-connector` — a workflow Robert already lives in.
  Eliminates all platform app-review lead times and the EE/CE publishing split.
- **Handoff = suggestion generator**, not direct opportunity creation. Marketing registers as
  an `opportunity_suggestions` generator (`generator_key: 'inbound-lead'`); human accepts in
  the existing Opportunities UI; attribution carried. Matches the opportunities module's
  designed discipline and keeps a human gate on inbound noise.
- **FK direction: marketing → core only.** Core tables never reference marketing tables, so
  the module is droppable. Engagement-to-marketing linkage lives in marketing-owned
  `marketing_engagements` join table. (Contrast: `20260712102000_add_interactions_opportunity_id.cjs`
  added `opportunity_id` onto `interactions` — fine because opportunities are core; doing
  that for an optional module would couple core to it.)
- **Interactions = the log; marketing tables = the machine.** Published posts, sends, opens,
  clicks, form submissions recorded as interactions (new tenant interaction types) so they
  appear on contact/opportunity timelines; scheduling/sending machinery stays in marketing
  tables.
- **Module shape: core module, feature-flagged** (`marketing_module`), not an extension —
  extensions (ee/server/src/lib/extensions) are bundle/service-proxy based and can't own
  tenant schema/migrations.
- **Reuse, don't rebuild**: outbound email abstraction for sending; PostHog for open/click
  analytics; secrets management for OAuth tokens; workflow engine NOT used this phase
  (linear sequences = tables + scheduled jobs).
- **UX direction: Concept B (queue-forward) for both calendar and sequences** (2026-07-19,
  user picked from three mockup pairs). Calendar is agenda-forward (Today card with inline
  publish actions, day groups, amber "Needs publishing" rail); month grid demoted to a
  toggle. Sequences = horizontal journey cards + enrollment table with progress bars.
  Rationale: the publish loop is the daily job (per PRD analysis that the queue is the daily
  driver); B is the only concept that makes it the hero, and it surfaces the MCP path
  ("ask Claude: publish my due Alga posts") in-product. Rejected: A (bento month grid +
  stepper — most canonical per docs/ui/design_guidelines.md but treats viewing the month as
  the job), C (status kanban — duplicates queue's state filter; dense tables overkill for
  4-step linear drips). Mockups live in `./ux/` (calendar.html, sequences.html); concept
  A/C mockups remain in /tmp (alga-mkt-{A,B,C}-*.html) if needed before /tmp clears.
- **Anti-features** (explicit non-goals): social listening/unified inbox (irreversible
  commitment — missed-message failure is silent), AI auto-reply, drag-drop email designer,
  landing-page builder, A/B testing, branching automation builder, attribution beyond
  first-touch source.
- **Due-post surfacing = User Activities aggregation, not notifications** (2026-07-19, user's
  suggestion). The opportunities module already established the pattern:
  `fetchOpportunityActivities` in `packages/user-activities/src/actions/
  activityAggregationActions.ts` maps live rows to generic activities with a `link` — no new
  ActivityType, no stored notification rows. Marketing's `fetchMarketingActivities` derives
  items from live `awaiting-manual-publish` targets, so publishing (by user or MCP agent)
  clears the dashboard automatically — derived state, no sync problem. v1 shows due targets
  to all `marketing:manage` holders (team queue; posts have no owner field yet).

## Discoveries

- Opportunities module is brand new (migrations 2026-07-12/13): `opportunities`,
  `opportunity_evidence`, `opportunity_suggestions` with `generator_key` — a designed
  generator/suggestion mechanism that marketing slots into. See
  `server/migrations/20260712100000_create_opportunities_tables.cjs`.
- `interactions` already links contact/company/user/ticket/**opportunity** and has extensible
  `interaction_types` (system + tenant types). Initial shape:
  `server/migrations/202409071803_initial_schema.cjs` (~line 380); opportunity FK:
  `server/migrations/20260712102000_add_interactions_opportunity_id.cjs`.
- Extension system lives at `ee/server/src/lib/extensions` (bundles, endpoints, service
  proxy) — UI/service extensions, not schema-owning modules.
- Tier gating documented in `docs/tier-gating-guide.md` — use for EE publisher gating.
- Outbound email abstraction: `docs/outbound-email-abstraction/`.
- MCP server (`docs/mcp-server.md`) exposes a constant 3-tool surface
  (`search_api_registry`, `search_business_data`, `call_api_endpoint`) over the API registry —
  so any well-described marketing API endpoint is MCP-drivable with **zero MCP-specific
  work**. CE local connector = user's own API token (RBAC-inheriting); EE remote server =
  governed agent identity + audit. The automation story is an endpoint-design story.

## Strategic context (why this shape)

- Scores well under the Axioms of Software Business: building is cheap (axiom 3); internal-
  first + droppable schema = maximally reversible (axiom 4); social scheduling failure mode is
  a missed post, not customer downtime (unlike RMM); defensible asset is the MSP-specific
  motion/templates, not the code. Full analysis lives in Robert's vault wiki
  (`_wiki/concepts/Axioms of Software Business.md` and the marketing-module discussion,
  2026-07-18/19) — internal strategy material, keep out of external copy.

## Gotchas / lead times

- ~~Platform app reviews have real lead time~~ **Eliminated by the MCP pivot** — no LinkedIn/
  Meta/Google/X app review or OAuth verification pipelines needed. No third-party credentials
  stored in the module at all (`marketing_channels` holds platform label + handle/URL only).
- Email deliverability: sequence sending needs proper SPF/DKIM on the Nine Minds tenant's
  outbound provider before dogfooding at volume.
- Idempotency: publish/send jobs must be safe to re-run (platform_post_id / sent-message
  dedupe) — at-least-once schedulers will eventually double-fire.

## Commands / runbook

- Branch: `feature/marketing-module` (off main @ 4b8bd96a68, created 2026-07-19).
- Plan folder: `ee/docs/plans/2026-07-19-marketing-module/`.
