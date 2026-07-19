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

## Implementation log (2026-07-19)

### Landed (commit: schema+core checkpoint on feature/marketing-module)
- 4 migrations: 12 marketing tables (`20260719100000`), `inbound-lead` generator key
  (`...101000`), permissions (`...102000`), interaction types (`...103000`). All tables
  Citus-distributed before composite FKs; tenant metadata registered in BOTH
  `packages/db/src/lib/tenantTableMetadata.ts` and `server/migrations/utils/tenantDb.cjs`.
  NO RLS — current post-Citus convention is app-layer tenantDb (opportunities precedent);
  PRD's "standard RLS" line reconciled to this.
- `packages/types`: marketing.interfaces.ts (12 entities + view models ISocialPostQueueItem,
  IMarketingCampaignFunnel, IMarketingSequenceStepStats, IMarketingEnrollmentWithContact).
- Opportunities package: `inbound-lead` threaded through every exhaustiveness point
  (type union, zod enum, opportunityTypeByGenerator='new_logo', nextActionByGenerator,
  WhyFacts union + composer case, workQueue suggestionCopy). `SweepGeneratorKey =
  Exclude<OpportunityGeneratorKey,'inbound-lead'>` — sweep generators can't run it;
  `runGeneratorNow` throws for it. Package typechecks clean.
- `packages/marketing` (@alga-psa/marketing) — full package core, tsc clean:
  schemas (zod), guards (guardMarketing = flag + permission + actorId), interactionTypes
  (cached type_id resolution), engagements (interactions + marketing_engagements in caller's
  trx), render (merge fields, channel-variant resolution, escape-first markdown→HTML),
  suppression (email-normalized, stops enrollments by contact AND email join — survives
  contact delete/re-import), campaigns/content/channels/forms CRUD, capture (single-trx
  contact+prospect-client find-or-create → engagement → persistGeneratedSuggestions OUTSIDE
  trx with dedupe_key `inbound-lead:{formId}:{email}`), posts state machine
  (create/reschedule/flip/expire/mark-published/skip + rollup), sequences (CRUD, enroll,
  sendDueSequenceStepsInternal via TenantEmailService + inline ITemplateProcessor, tracking
  pixel/click-rewrite/unsubscribe footer injected at render, optimistic current_step_order
  guard against double-send, 30-min backoff on failure), tracking (open/click recorders),
  contactState (contact-record profile). 7 action files with 'use server' + withAuth.
- Nav: Marketing section (7 subitems) behind `marketing-module` PostHog flag;
  en/msp/core.json strings.
- Public tracking/unsubscribe URLs carry tenant in path (no session to derive it):
  /api/marketing/{track/open,track/click,unsubscribe,capture}/{tenant}/...
- Automation recipe doc: docs/marketing/automation-recipe.md (F063 docs half).

### Discoveries while implementing
- `@alga-psa/opportunities` was NOT linked in node_modules (workspace added after last
  npm install on this machine) — root `npm install` fixed linking for both opportunities
  and marketing. If tsc reports "Cannot find module '@alga-psa/...'", run npm install first.
- interactions.user_id is NOT NULL — engagement recording always needs an owning user
  (enrollment.enrolled_by, falling back to sequence.created_by; form.created_by for captures).
- Test env: no local Postgres, no Docker daemon — DB integration tests authored but executed
  only in CI; unit tests (pure render/suppression logic) run locally.
- Send-loop claim pattern: prepare in trx with forUpdate (render + stop/complete decisions),
  send OUTSIDE trx (SMTP latency), advance with optimistic `where current_step_order = n`
  guard — overlapping runners can't double-send.

### Parallel build-out (2026-07-19, four workstreams)
- **UI**: packages/marketing/src/components (calendar w/ Needs-publishing rail, posts queue,
  content library, campaigns+funnel strip, sequences journey cards + progress-bar enrollment
  table, forms, channels, ContactMarketingSection) + 7 pages under server/src/app/msp/marketing/.
  Contact integration = flag-gated card below ContactBentoLayout (bento has no extension slot).
  Intentional mockup gaps: no "Sequence sends due" rail card (no backend query), agenda-only
  calendar, sequences switcher is a top CustomSelect.
- **API**: 24 v1 endpoints (ApiMarketingController extends ApiBaseController, flag→404,
  marketing:read/manage→403, tenant stripped from DTOs); OpenAPI + MCP chat registries
  regenerated. Agent fixed a PRE-EXISTING generator breakage (since 2026-07-13): tsx resolves
  package exports to dist/, needing "type":"module" + tsup addJsExtensions on
  opportunities+marketing package.json/tsup.config.ts.
- **Jobs/endpoints**: 3 per-tenant recurring jobs (flip */5m, send */5m, expire hourly :11
  48h grace); public routes capture (honeypot pre-zod silent-drop, 10/min ip:tenant, uniform
  {ok:true}), track/open gif, track/click 302 (PostHog gets destination HOST only), unsubscribe
  HTML page; fetchMarketingActivities in collectProcessedActivities (flag + marketing:manage,
  never throws). Base URL: NEXTAUTH_URL (notificationLinkResolver precedent).
- **Tests**: render.test.ts 27/27 passing; T001–T008 DB suites authored (describeWithDb guard,
  REQUIRE_DB=1 to hard-fail), load-verified, unexecutable locally (no PG/Docker).

### Design corrections during test/implementation review
- **Sequence completion bug (found by test agent)**: after the final step sent, enrollment
  stayed active with next_send_at=null — 'completed' branch unreachable. Fixed: advance now
  sets state='completed' when no following step exists.
- **Interaction types moved to system_interaction_types**: per-tenant seeding leaves tenants
  created post-deploy without the types (nothing re-seeds; opportunities' permission seed has
  the same known gap). Marketing follows the opportunities 'Note' precedent — interactions
  reference system_interaction_types.type_id directly. Seed migration rewritten (global,
  idempotent); interactionTypes.ts resolver + 3 stats joins switched; tests updated.
- package.json "type": "module" on marketing+opportunities is load-bearing for the OpenAPI
  generator — do not remove.
