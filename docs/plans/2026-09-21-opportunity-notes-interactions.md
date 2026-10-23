# Opportunity notes / interactions timeline & schedule-from-opportunity

Design plan for AlgaPSA cards **alga-2026-0002382** and **alga-2026-0002490** (Ryan Hoffmann, FTS Technology).
Branch: `feature/opportunities-notes-interactions-timeline-and-sc`. Author: robert@nineminds.com. Date: 2026-09-21.

## Goal

Give an opportunity a place to record free-form sales context (referral source, requirements, competitive
situation, preliminary scope, partner/vendor conversations) and to log calls/meetings/emails and schedule a
meeting — without spinning up a ticket. Reuse the existing **Interactions** substrate; do not add a notes table.

## Key finding: most of the data layer already exists

The interactions ↔ opportunity association was already built by prior opportunity work and is on `main`:

- `interactions.opportunity_id` column + FK `fk_interactions_opportunity` + index — `server/migrations/20260712102000_add_interactions_opportunity_id.cjs`.
- `IInteraction.opportunity_id?: string | null` — `packages/types/src/interfaces/interaction.interfaces.ts:16`.
- **Create path already opportunity-aware** — `packages/clients/src/actions/interactionCreateHelper.ts`:
  - `createInteractionRecord` (`:107`) resolves `client_id` from the contact when absent (`:122-129`).
  - Validates `opportunity_id` belongs to the resolved client (`:137-145`).
  - Bumps the opportunity's `last_activity_at` on write (`:155-162`).
  - `createInteractionScheduleEntry` (`:281`) books a `schedule_entries` row with `work_item_type='interaction'`.
- **REST API already accepts/returns `opportunity_id`** — `server/src/lib/api/schemas/interactionSchemas.ts:17,59,101`; `server/src/lib/api/services/InteractionService.ts:27,62,219`. (No API change needed; confirm with the existing T012/T013 tests below.)
- Opportunities already write interactions on step completion — `packages/opportunities/src/lib/completedActionInteraction.ts:13` (system `Note` type, `category:'opportunity_action'`), and already read them back into a small read-only timeline — `packages/opportunities/src/lib/opportunityTimelineCore.ts:16` (filters `i.opportunity_id`), surfaced in the plan panel via `OpportunityStepTimeline.tsx`.

**What is missing is the read path for the `opportunity` entity and the UI to add/log/schedule from the deal.**
The web has no affordance to add an ad-hoc note or log a call/meeting/email against an opportunity; the only
interactions written today are step-completion side-effects. (Mobile already has this via
`ee/mobile/.../LogInteractionModal.tsx`, which accepts `opportunityId`; web is the gap.)

## Scheduling decision

Card `ca8ff5d6` / PR #3423 "unified scheduling" is **not merged and does not exist as a scheduling change** here
(PR #3423 is a telephony fix; `git log --all | grep ca8ff5d6` is empty; the only unified-scheduling work,
`origin/feature/unify-ticket-scheduling-flows-and-enable-editing`, is unmerged and ticket-page-scoped). Per the
brief's fallback, we use the **existing interaction scheduling**: `QuickAddInteraction`'s "create schedule entry"
toggle already calls `addInteraction(..., { createScheduleEntry: true, scheduleAssignedUserIds })`
(`packages/clients/src/components/interactions/QuickAddInteraction.tsx:811-826`), which lands an interaction
(carrying `opportunity_id` + `contact_name_id` + `client_id`) plus a calendar `schedule_entries` row. A schedule
entry reaches a contact/opportunity only *through* its interaction work item — `schedule_entries` has no
contact/opportunity columns — so routing scheduling through the interaction is the correct and only substrate.

## Reuse target components

- Feed: `packages/clients/src/components/interactions/InteractionsFeed.tsx` — newest-first controlled list; mounts its own `QuickAddInteraction`.
- Dialog: `packages/clients/src/components/interactions/QuickAddInteraction.tsx` — logs note/call/meeting/email, optional schedule entry, Teams meeting.
- Read action: `packages/clients/src/actions/interactionActions.ts:184` `getInteractionsForEntity` → `InteractionModel.getForEntity` (`packages/clients/src/models/interactions.ts:66`).
- Client-boundary wrapper template: `server/src/app/msp/contacts/[id]/activity/ContactActivityFeed.tsx` (holds `useState`, renders the controlled `InteractionsFeed`).
- Injection pattern: `commitments` is already injected as a `ReactNode` from the server app into the opportunity host (`server/src/components/opportunities/OpportunityDetailWithDrafting.tsx:35`). `packages/opportunities` has **no** dependency on `@alga-psa/clients`, so the interactions section must be built in the server-app layer and injected the same way.

## Changes (exact files/functions)

### 1. Read path: teach the interactions model/action the `opportunity` entity
- `packages/clients/src/models/interactions.ts`
  - `getForEntity` signature (`:66`): widen `entityType` union to `'contact' | 'client' | 'ticket' | 'opportunity'`.
  - Where-clause switch (`:103-109`): add `else if (entityType === 'opportunity') query.where('interactions.opportunity_id', entityId)`. (Existing `orderBy interaction_date desc` already gives newest-first.)
  - Optional: add `opportunityId?` to `InteractionPageFilters` (`:8-19`) and `getInteractionsPage` (`:269`) for the standalone `/msp/interactions` table — not required by the brief; include only if cheap.
- `packages/clients/src/actions/interactionActions.ts`
  - `getInteractionsForEntity` (`:184-188`): widen the `entityType` param union to include `'opportunity'` and pass through. RBAC stays `interaction:read` (verify opportunity users hold it — see Risks).

### 2. Components: accept the `opportunity` entity and its contact
- `packages/clients/src/components/interactions/InteractionsFeed.tsx`
  - Props (`:33-40`): widen `entityType` to include `'opportunity'`; add optional `contactId?: string` (the deal's contact, so a new opportunity interaction can carry `contact_name_id`).
  - Pass `entityType` (already at `:389`) and the new `contactId` through to `QuickAddInteraction`.
- `packages/clients/src/components/interactions/QuickAddInteraction.tsx`
  - Props (`:66-77`): widen `entityType` to include `'opportunity'`; add optional `contactId?`.
  - Field mapping (`:774-782`): add an `opportunity` branch → set `opportunity_id = entityId`, `client_id = clientId` (required by create), `contact_name_id = contactId ?? null`. Submit path (`:826`) unchanged.

### 3. Opportunity detail: mount the activity section
- New `server/src/components/opportunities/OpportunityInteractionsSection.tsx` (mirror `ContactActivityFeed.tsx`): `'use client'`, `useState<IInteraction[]>`, renders `<InteractionsFeed entityType="opportunity" entityId={opportunityId} clientId={clientId} contactId={contactId} ... />` importing from `@alga-psa/clients/components` (components subpath only — see the note in `ContactActivityFeed.tsx:4-7` about not dragging `pg`/`knex` into the browser bundle). Seed `initialInteractions` via `getInteractionsForEntity(opportunityId, 'opportunity')` from the server page, or let the feed self-load.
- `server/src/components/opportunities/OpportunityDetailWithDrafting.tsx` (`:30-46`): build the section and pass it as a new `activity` prop to `OpportunityDetailHost`.
- `packages/opportunities/src/components/detail/OpportunityDetailHost.tsx`: add `activity?: ReactNode` to the props (`:66-85`) and forward it to `OpportunityDetailView` (`:220-276`). Mirror `commitments` exactly.
- `packages/opportunities/src/components/detail/OpportunityDetailView.tsx`: add `activity?: React.ReactNode` to `OpportunityDetailViewProps` (`:28-49`) and render it in a new full-width `BentoTile` ("Notes & interactions") below the 3/6/3 grid (after `:409`). Render it for **all** statuses (do not gate on `open`) so history stays visible on won/lost deals. New i18n title key in `msp/opportunities`.

### 4. Schedule-from-contact (card 2490)
Contact detail already mounts `InteractionsFeed` (`packages/clients/src/components/contacts/ContactDetails.tsx:887`, `ContactDetailsView.tsx:532`) and the standalone activity route uses `ContactActivityFeed.tsx`, both of which surface `QuickAddInteraction`'s schedule toggle. Verify the toggle is reachable there; if it is, scheduling-from-contact already works and the opportunity feed inherits the identical capability. Only surface an explicit "Schedule meeting" affordance if verification shows the toggle is hidden/unclear.

## Order of work
1. Read path (model + action `opportunity` branch) — smallest, unblocks the feed.
2. Component props (`InteractionsFeed`, `QuickAddInteraction`) — `opportunity` entity + `contactId`.
3. Server-app wrapper + inject `activity` through `OpportunityDetailWithDrafting` → `OpportunityDetailHost` → `OpportunityDetailView`; add the bento tile + i18n.
4. Verify schedule-from-contact; surface affordance only if needed.
5. Tests (below) + locale strings for every language.

## Deliberately NOT doing
- No new notes/`opportunity_notes` table — interactions are the store (per brief).
- No new bespoke "Schedule meeting" dialog or calendar UI, and no adoption of the unmerged unified/`WorkItemEntryEditor` ticket-scheduling flow — reuse `QuickAddInteraction`'s existing schedule toggle.
- No `schedule_entries → opportunity/contact` columns; association stays through the interaction work item.
- No web port of the mobile "log a call from any record" `CallPromptHost` (mobile-only; out of scope).
- No change to the existing plan-panel step timeline (`OpportunityStepTimeline` / `opportunityTimelineCore`); it stays as the plan's spine. (Accepted minor overlap — step-completion interactions appear in both it and the new feed.)
- No REST API change (opportunity_id already supported).

## Risks / watch-items
- **Package boundary:** `packages/opportunities` must not import `@alga-psa/clients` (no dep, and would invert layering). Keep the feed in the server-app layer and inject as `activity`. Import `@alga-psa/clients/components` (not the root barrel) to keep `pg`/`knex` out of the browser bundle.
- **`client_id` required on create:** `createInteractionWithSideEffects` requires `client_id || contact_name_id`; always pass the opportunity's `client_id`. Contact is optional (deals without a contact still log against the client).
- **Permissions:** `getInteractionsForEntity`/`addInteraction` gate on `interaction:read`/`interaction:create` (and `user_schedule:update` when booking others). Confirm opportunity users carry these; if not, decide whether opportunity read/update should imply interaction access.
- **Overlap** between the new feed and the plan-panel mini-timeline (both key on `opportunity_id`). Acceptable; if noisy, optionally scope the plan timeline to `category='opportunity_action'` only.
- **Won/lost:** interactions are never deleted on close (`removeOpportunityStepScheduleEntries` only clears step schedule entries), so history survives; just ensure the section renders when `status !== 'open'`.

## Test / verification approach
- **Integration (primary, required):** extend/add in `server/src/test/integration/`. `interactionApi.integration.test.ts` already seeds an opportunity (`:212-233`) + contact (`:189-197`) and, in T012/T013 (`:451-559`), creates an interaction with `opportunity_id` and reads it back filtered by opportunity and asserts `last_activity_at`. Add a case that a single interaction created with `opportunity_id` **+ `client_id` + `contact_name_id`** is returned by both `getForEntity(id,'opportunity')` **and** `getForEntity(contactId,'contact')` — the brief's "read it back on both the opportunity and the contact." Bootstrap via `createTestDbConnection` + `testDataFactory` (`createTenant`/`createClient`/`createUser`), gate with `describeWithDb()`; follow the account-timeline read pattern in `marketingOpportunityHandoff.integration.test.ts:96-136`.
- **Unit:** add a `getForEntity` `'opportunity'` branch test mirroring the mocked-`tenantDb` tests in `packages/clients/src/models/` (and note `interactionCreateHelper.test.ts` already covers the opportunity-belongs-to-client validation).
- **Manual smoke:** on an open opportunity, add a note and log a call/meeting/email; confirm newest-first with author + timestamp; toggle "schedule" on a meeting and confirm a calendar entry appears; open the deal's contact and client and confirm the same interactions show; mark the deal won and confirm the section and history remain.
- Run: `cd server && npm run test:integration` (or `test:local`); `packages/clients` unit tests via its vitest config.

## Open questions
1. Placement — full-width "Notes & interactions" tile below the bento grid (recommended, room for the feed) vs. center column beneath the plan tile. Confirm with design.
2. Should adding notes be allowed on won/lost opportunities, or read-only after close? (Plan assumes add stays allowed — sales record-keeping continues post-close.)
3. Do we also add the `opportunityId` filter to the standalone `/msp/interactions` table (`getInteractionsPage`), or keep this scoped to the deal detail?
4. Permission model: is `interaction:read/create` already granted to opportunity users, or should opportunity access imply it?
