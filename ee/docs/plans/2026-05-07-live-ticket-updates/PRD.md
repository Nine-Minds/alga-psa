# PRD — Live Ticket Updates

- Slug: `live-ticket-updates`
- Date: `2026-05-07`
- Status: Draft
- Scope: Phases 1–3, **tickets only** (projects port deferred to a follow-up plan)

## Summary

Add a real-time layer to the ticket detail page so that when one user saves a change, every other user viewing the same ticket sees it within ~500 ms — without requiring a refresh and without breaking when Hocuspocus is unavailable. Postgres remains the source of truth; Hocuspocus carries presence and lightweight "something changed" signals; the existing REST-based save model is unchanged.

## Problem

Today, two users editing the same ticket cannot tell that the other is there, and a save by user B does not reach user A's screen until A reloads. The save flow already has good bones — optimistic per-field updates, a `pendingRequestRef` queue, and `UnsavedChangesProvider` — but no awareness of remote activity. The result is two visible failure modes:

1. **Stale reads**: A is looking at a ticket whose status was changed 10 minutes ago by B; A makes decisions on stale data.
2. **Lost-update-style overwrites at the field level**: A and B both change the same dropdown around the same time. The second save wins silently. Cross-entity validation in `updateTicketWithCache` (priority recompute, status↔board, etc.) means even non-overlapping fields can produce surprising server state.

## Goals

- A second user's save shows up on my screen for the ticket I'm viewing without a manual refresh, within ~500 ms of the save committing.
- I can see who else is currently viewing this ticket (presence bar) and which structured field they are actively editing (focus indicator).
- If two users edit the same field and remote save lands while I have unsaved local changes for that field, I get an explicit **Keep yours / Take theirs** banner — no silent overwrite.
- If Hocuspocus is unreachable, the ticket page works exactly as it does today: reads, writes, optimistic updates, unsaved-changes warning all unchanged. The user sees a small "Live updates offline — reconnecting…" indicator; the live layer auto-reconnects in the background.
- The implementation reuses the existing Hocuspocus pipe and the Redis pub/sub bridge pattern from `NotificationExtension`, so we are not introducing new infrastructure.

## Non-goals

- Collaborative editing of structured fields (no Y.Map of ticket fields). Postgres stays authoritative; we are not migrating the save path.
- Live updates for the rich-text **description** field — already handled by the existing `CollaborativeEditor` Y.js pipeline; we will not touch it.
- Live updates for **comments**, **tags**, **resources**, **teams**, **time entries** as separate channels in this plan. They will fold in later as additional invalidation signals on the same ticket room, but Phase 1–3 scope is the structured fields handled by `updateTicketWithCache`.
- Live updates for **projects**. Same architecture later (separate plan), not now.
- Hard locks on fields. The "X is editing" indicator is advisory only.
- Background polling fallback. If Hocuspocus is down, we degrade — we do not periodically refetch via REST as a backstop.
- Operational tooling beyond what's needed to verify the feature (no dashboards, no metrics pipelines, no admin UI).

## Users and Primary Flows

**Personas:** MSP technicians and dispatchers viewing tickets concurrently. The most common collisions are around status, priority, assigned_to, and board.

**Primary flows:**

1. **Two users on one ticket, no conflict.** A and B both have the ticket open. B changes status from "New" to "In Progress". A's status field updates silently within ~500 ms. A toast does not appear; the field is briefly highlighted.
2. **Presence.** A opens the ticket; sees a stack of avatars in the header showing B is viewing. B closes the tab; A's avatar list shrinks within a few seconds.
3. **Focus indicator.** A focuses the priority dropdown. On B's screen, the priority field is dimmed with a subtle "Alex is editing" caption. A blurs without changing — the indicator clears on B's screen.
4. **Same-field conflict.** A opens the status dropdown and selects "On Hold" but has not yet committed. Meanwhile B saves status = "Resolved". A's local state still has "On Hold" pending. The field freezes, a banner appears: "Bob just changed status to Resolved (2 sec ago). [Keep yours] [Take theirs]". A clicks Keep yours → A's pending value is sent on next save and may overwrite B; A clicks Take theirs → A's local pending value is dropped, "Resolved" is shown.
5. **Hocuspocus down.** Server is unreachable. A sees "Live updates offline — reconnecting…" indicator in the header. All saves and reads work normally. When the server comes back, the indicator disappears and the room rejoins.
6. **Reconnect.** A's connection drops mid-session and reconnects after 30 s. On reconnect, the client refetches the ticket once to catch any updates that landed during the gap.

## UX / UI Notes

- **Presence bar**: lift the existing presence component out of `packages/documents/src/components/CollaborativeEditor.tsx` into `packages/ui` so tickets and (later) other entities share one component. Avatars + tooltip with name; visible in the ticket detail header next to the title.
- **Field focus indicator**: visual differs by control type — dropdowns dim with a caption beneath; text inputs (title) show a small caption pill next to the control without dimming. No hard lock in either case — A can still focus the same field; we only show *who* else is.
- **Silent remote update**: the changed field briefly highlights (~600 ms fade) when a remote update is applied. No toast unless the change touches data the user was looking at but hadn't saved.
- **Conflict banner**: appears inside the field's container, not as a global toast. Two buttons: **Keep yours** (default focus), **Take theirs**. Shows author name + relative timestamp.
- **Connection status**: small text indicator in the header. Three states: connected (no indicator), reconnecting ("Live updates offline — reconnecting…"), permanent failure ("Live updates unavailable" — after N retries, no further auto-retry that session).
- **Multi-tab same user**: presence dedupes by `userId`, so A in two tabs shows once.

## Requirements

### Functional Requirements

**FR-1. Server-side broadcast on ticket update.** After `updateTicketWithCache` commits successfully and publishes its existing `TICKET_UPDATED` event, also publish a Redis message on channel `ticket-updates:<tenantId>:<ticketId>` with payload `{updatedFields: string[], updatedBy: {userId, displayName}, updatedAt: ISO8601}`. This must run in the same code path as the existing event publish (`packages/tickets/src/actions/optimizedTicketActions.ts` ~L2038–2101) so no save can succeed without the broadcast attempt. Broadcast failure is logged but does not fail the update.

**FR-2. Hocuspocus extension bridges Redis to room broadcasts.** A new `TicketUpdatesExtension` (modeled on `NotificationExtension`) subscribes to `ticket-updates:*`. When a message arrives for `ticket-updates:<tenant>:<id>`, it broadcasts a stateless message to all clients connected to room `ticket:<tenant>:<id>`.

**FR-3. Per-ticket Hocuspocus room.** `tenantValidation.js` recognizes the `ticket:` room prefix in addition to `document:` and `notifications:`. Authentication is via short-lived signed JWT (see Security).

**FR-4. Client subscription on ticket open.** When a user opens a ticket detail page, the client joins room `ticket:<tenant>:<id>` using `createYjsProvider`. The provider is empty Y.Doc — used only for awareness and stateless messages, not for field state.

**FR-5. Presence.** Awareness state holds `{userId, displayName, avatarUrl, color, editingField?: string}`. Presence bar renders all unique users (deduped by `userId`).

**FR-6. Silent refetch on remote update with no local conflict.** When the client receives an update message:
- If the user has no pending local edits to any field in `updatedFields`, refetch the ticket and update component state. Briefly highlight changed fields. No toast.
- Debounce refetches at 200 ms so a burst of changes triggers a single refetch.

**FR-7. Conflict banner on same-field collision.** When the client receives an update message that includes a field with pending unsaved local state:
- Freeze that specific field.
- Render a banner in the field's container with author + timestamp + remote value.
- **Keep yours**: keeps local pending value; clears banner; user proceeds normally.
- **Take theirs**: drops local pending value; refetches; field updates to remote value.

**FR-8. Toast on remote update with non-overlapping unsaved local changes.** If the user has unsaved changes on field X and a remote update lands on field Y:
- Refetch and update Y silently.
- Show a passing toast: "{Name} updated {field}".
- Local pending changes on X are preserved untouched.

**FR-9. Per-field editing indicator.** When the user focuses an editable field (title, status, priority, ITIL impact, ITIL urgency, board, category, assignee, client, contact, location), set `awareness.editingField = '<field>'`. On blur or selection-commit, clear it. On other clients, render a "{Name} is editing" indicator on that field when at least one remote awareness has the same `editingField`. Visual treatment is per control type:
- Dropdowns/selects: dim the control + caption beneath.
- Text inputs (title): caption pill near the control; do not dim (would interfere with the input affordance).
- No hard lock in either case.

**FR-10. Soft dependency on Hocuspocus.** All live behavior is layered over the existing REST save path. If the WebSocket fails to connect or disconnects:
- Presence, focus indicator, silent refetch, conflict banner all become no-ops.
- The ticket page renders, reads, writes, optimistic updates, and unsaved-changes warnings exactly as today.
- A header indicator shows "Live updates offline — reconnecting…". Reconnects auto-retry with exponential backoff (start 1 s, cap 30 s). After 5 failed reconnects, switch to "Live updates unavailable" and stop auto-retrying that session (manual reload re-enables).

**FR-11. On reconnect, refetch once.** When the WebSocket reconnects after a drop, the client refetches the ticket exactly once to catch up on any updates that landed during the gap.

**FR-12. Multi-tab dedupe.** A single user with the same ticket open in multiple tabs appears once in the presence bar (deduped by `userId`).

**FR-13. Permission revocation mid-session.** If the server pushes a message indicating the current user no longer has access (e.g., ticket reassigned to a board they can't see), the client redirects away (or shows a "no access" view) instead of silently 403'ing on the next refetch. (Implementation note: refetch failure with 403 is the trigger; we do not need a separate channel for this in Phase 1–3.)

### Non-functional Requirements

- **Latency**: P95 from save commit to all subscribed clients applying the update ≤ 500 ms on the same data center.
- **Throughput**: Phase 1–3 design target — up to 50 concurrent viewers per ticket and up to 100 ticket updates / sec / tenant. No formal load test in scope; just don't pick designs that obviously break here.
- **Auth**: per-ticket JWT, ≤ 5 min expiry, signed with the existing Hocuspocus shared secret. Tenant + ticketId + userId encoded in claims.
- **Backward compatibility**: zero changes required to existing ticket UI for users on the live layer to see fresh data. A user with Hocuspocus disabled in their environment sees the same UX as today plus the offline indicator.

## Data / API / Integrations

**Server (Next.js / `@alga-psa/tickets`):**
- New helper `publishTicketUpdate({tenantId, ticketId, updatedFields, updatedBy, updatedAt})` in `packages/tickets/src/lib/liveUpdates.ts`. Uses `getRedisClient()` from `@alga-psa/event-bus`.
- Call `publishTicketUpdate` in `updateTicketWithCache` (`packages/tickets/src/actions/optimizedTicketActions.ts` ~L2038–2101 region) after successful commit, alongside the existing `publishEvent('TICKET_UPDATED', …)` call. Compute `updatedFields` from the diff between the loaded ticket and the validated update payload (same diff already used implicitly for ITIL recompute / status↔board logic — extract the diff into a helper).
- New endpoint `GET /api/tickets/:id/live-token` returns a short-lived JWT `{tenantId, userId, ticketId, exp}`. Wrapped in `withAuth`; checks `assertTicketReadAllowed`. Token signed with `HOCUSPOCUS_JWT_SECRET` (new env var; reuse existing Hocuspocus shared secret if one exists).

**Hocuspocus (`/hocuspocus`):**
- New `TicketUpdatesExtension.js` modeled on `NotificationExtension.js`. Subscribes to `<redisPrefix>ticket-updates:*` (pattern subscribe). On message, looks up matching room and broadcasts a stateless message via Hocuspocus' `sendStateless` API (or sets a transient awareness key the clients listen for).
- Extend `tenantValidation.js`:
  - Add `parseTicketRoom(roomName)` for `ticket:<tenant>:<ticketId>`.
  - Update `validateDocumentRoomAccess` to handle the `ticket:` prefix: parse, then verify the JWT in the request (query param `token=<jwt>`); reject if signature, expiry, tenant, or ticketId mismatch.
- Register `TicketUpdatesExtension` in `server.js` extensions list.

**Client (`@alga-psa/tickets`):**
- New `packages/tickets/src/hooks/useTicketLive.ts`: takes `{tenantId, ticketId, currentUser, onRemoteUpdate, onPresenceChange}`. Internally fetches the live-token, calls `createYjsProvider('ticket:<tenant>:<id>', { token })`, exposes `presence`, `connectionStatus`, `setEditingField(field|null)`. Handles reconnect-then-refetch (FR-11).
- New `packages/tickets/src/components/ticket/TicketLiveProvider.tsx`: wraps `TicketDetails`, owns the hook, exposes context.
- Modify `packages/tickets/src/components/ticket/TicketDetails.tsx` (~L94–171, L870–924):
  - Subscribe to `onRemoteUpdate` from context.
  - Intersect `updatedFields` with the current `pendingRequestRef` queue and component-level dirty state to route to silent refetch / toast / conflict banner.
  - Wire `setEditingField` on focus/blur of structured field controls.
- Lift presence bar from `packages/documents/src/components/CollaborativeEditor.tsx` (~L259–305) into `packages/ui/src/presence/PresenceBar.tsx`. Update `CollaborativeEditor` to import from there. Tickets imports the same component.
- Conflict banner component: `packages/ui/src/presence/FieldConflictBanner.tsx`. Used wherever a structured field needs the banner.

**Wire format:**
- Redis channel: `<redisPrefix>ticket-updates:<tenantId>:<ticketId>`.
- Redis payload (JSON): `{ updatedFields: string[], updatedBy: { userId: string, displayName: string }, updatedAt: string /* ISO */ }`.
- Hocuspocus stateless message payload from extension to clients: same JSON.
- Awareness shape: `{ userId, displayName, avatarUrl?, color, editingField?: string }`.

## Security / Permissions

- **Per-ticket auth.** `tenantValidation.js` currently only validates that the room's tenant matches the request's tenant. For tickets we additionally require:
  1. Client requests a JWT from `/api/tickets/:id/live-token`. Endpoint runs `withAuth` → `assertTicketReadAllowed(user, ticketId)` (must check both tenant and ticket-level visibility — bundled-child sync locks, board visibility, client-portal restrictions).
  2. JWT is short-lived (≤ 5 min) and includes `{tenantId, userId, ticketId, exp, iat, jti}`.
  3. Hocuspocus `onAuthenticate` (or equivalent in `validateDocumentRoomAccess`) verifies the JWT, asserts `tenantId === room.tenantId` and `ticketId === room.ticketId`.
- **Token refresh.** Client refreshes the token automatically before expiry (e.g., at 80 % of TTL). Refresh failure → degrade as if Hocuspocus were down.
- **Cross-tenant probe.** A direct WebSocket connection with a token for tenant X attempting to join `ticket:Y:*` MUST be rejected by `tenantValidation.js`.
- **No PII in awareness.** Awareness fields limited to userId, display name, avatar URL, color. No emails, no permissions snapshots.
- **No payload data on the wire.** The Redis message and the broadcast carry only `updatedFields` (field names) and metadata. Clients refetch the ticket via the existing authenticated REST path to obtain values. This means access changes are enforced on every refetch — a user whose access was just revoked will see 403 from the refetch and trigger FR-13.
- **JWT signing key.** New env var `HOCUSPOCUS_JWT_SECRET` (or reuse existing Hocuspocus secret if it covers signing). Stored in `secrets/`. Required in production; in dev, fall back to a fixed dev key with a startup warning.

## Observability

Out of scope for this plan beyond what's necessary to verify behavior in development:
- Console logging in `TicketUpdatesExtension` matching the pattern in `NotificationExtension` (subscribe/unsubscribe, message receipt) — useful for `docker compose logs hocuspocus` during dev.
- Console logging on the client when reconnect attempts happen.

If formal metrics are required they will be added in a follow-up plan.

## Rollout / Migration

- **Feature flag.** Gate the live layer behind a PostHog feature flag `live-ticket-updates` (per project conventions in `alga-feature-flags`). Off by default. Roll out tenant-by-tenant.
- **Backwards compatible.** No DB migrations. No schema changes. Existing REST flow is untouched — the new code is purely additive.
- **Backout.** Disable the flag → all clients revert to today's behavior (REST only, no presence). The Redis publishes still happen but go nowhere; no harm. Optional kill-switch via env var on the server side to skip the publish entirely.

### Implementation / Commit Cadence

Tests are listed at fine granularity in `tests.json` for tracking, but they MUST NOT be committed one-test-per-commit. Bundle commits by **feature group** within a phase. Specifically:

- **Phase 1 commits** (target: 3–4 commits total):
  1. Server publish: F001 + F002 + F003 + F004 + F033 (Redis publish helper, diff helper, wire into `updateTicketWithCache`, bundled-child propagation, env kill-switch). Tests T001–T007 ship in **the same commit** as the code they cover.
  2. Hocuspocus extension + auth: F005 + F006 + F007 + F008 + F009 + F010. Tests T008–T021 ship in this commit.
  3. Client subscription + silent refetch + offline UX: F011 + F013 + F014 + F015 + F016 + F017 + F018 + F019 + F020 + F021 + F022 + F023 + F024 + F025 + F031 + F032. Tests T022–T036, T044–T046, T051–T056 ship here. (`PresenceBar` lift in F011 is allowed to be its own commit if the documents-package regression test T024 wants isolation; otherwise fold in.)
- **Phase 2 commits** (target: 1–2 commits): F029 + F030 + F034 + the editing-indicator wiring, with T040–T043, T048, T058 in the same commits.
- **Phase 3 commits** (target: 1–2 commits): F012 + F026 + F027 + F028 + the conflict-banner integration, with T037–T039, T049 in the same commits.
- **Cross-phase E2E** (T046, T047, T049, T050, T051, T052, T053, T059) ship in the commit that completes the relevant phase, not split across many.

Rule of thumb: a commit should leave `main` in a green state where the implemented features + their tests are both present. Do not split "code" and "tests" commits — they are reviewed together.

## Open Questions

1. ~~**Editing-indicator field set.**~~ **Resolved 2026-05-07:** title, status, priority, ITIL impact, ITIL urgency, board, category, assignee, client, contact, location. Title uses caption-pill variant; rest use dim+caption.
2. **Bundled child tickets.** When a parent ticket sync-propagates to children (`optimizedTicketActions.ts` L2124–2143), should the child rooms also receive a broadcast? Probably yes; deferred to Phase 1 implementation note.
3. **Conflict-banner persistence.** If the user dismisses a banner with **Keep yours** and *then* B saves the same field again, do we re-show the banner (probably yes) and is it cumulative? Decide during Phase 3 design.
4. **JWT secret.** Reuse Hocuspocus' existing shared secret or introduce a separate one? Defer to security review.

## Acceptance Criteria (Definition of Done)

**Phase 1 — Server publish + silent client refetch (no presence, no conflict UI yet):**
- Two browsers, two users, one ticket: B saves status → A sees status update without reload within ~500 ms; A's other unsaved fields are preserved.
- B saves while Hocuspocus is down: A does not get the live update; A's reads/writes still work; A sees offline indicator.
- Cross-tenant probe: a user from tenant X with valid token-for-X cannot join `ticket:Y:*` (verified via direct WS probe in test).

**Phase 2 — Presence + per-field editing indicator:**
- Two users open the same ticket: each sees the other in the presence bar within ~2 s.
- A focuses status; B sees "Alex is editing" indicator on the status field. A blurs; indicator clears on B's screen.
- A and B both focused on status simultaneously: each sees the other's indicator (no hard lock).
- One user open in two tabs: presence shows once, not twice.

**Phase 3 — Conflict banner:**
- A has unsaved status change pending. B saves a different status. A sees the banner with B's value + author + timestamp; the field is frozen until A clicks Keep yours or Take theirs.
- A has unsaved change on field X; B saves field Y. A sees a passing toast; A's pending change on X is preserved; Y is silently updated.
- Banner Keep yours: A's local pending value remains; A's next save sends it; banner clears.
- Banner Take theirs: A's local pending is dropped; field reflects B's value; banner clears.

**Always (regression guards):**
- Hocuspocus container killed: ticket page renders, all reads/writes via REST work, optimistic updates and unsaved-changes warning all behave as today; offline indicator shown.
- Hocuspocus restarts: client reconnects within ~30 s, indicator disappears, refetches once on reconnect.
- All existing ticket-related tests pass unchanged.
