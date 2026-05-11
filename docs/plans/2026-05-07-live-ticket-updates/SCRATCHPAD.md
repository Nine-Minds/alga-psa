# Scratchpad — Live Ticket Updates

Working notes during planning + implementation. Append freely; curate when sections get unwieldy.

---

## Decisions (with rationale)

- **2026-05-07 — Awareness + invalidation, not Y.Map of fields.** Postgres remains source of truth. Reason: `updateTicketWithCache` does heavy cross-entity work (ITIL recompute, status↔board, bundled-child sync, ticket_resources reconciliation, SLA events). Re-implementing this as eventual-consistency reconciliation against Y.Map observers would mean two write paths and two sources of truth. Cost-to-value is bad. Awareness + invalidation gives ~95% of the user-perceptible benefit at ~10% of the cost.
- **2026-05-07 — Tickets first, projects deferred.** Hocuspocus pipe already terminates here for the description editor. Ticket UI already has the right primitives (`pendingRequestRef`, `UnsavedChangesProvider`, optimistic per-field). Projects modal is a different shape (single Save button, no concurrency guard) and will be a separate plan.
- **2026-05-07 — JWT auth (~5 min) issued by ticket page.** Avoids per-connection DB lookup. Tradeoff: needs a refresh endpoint and refresh logic in the client. Approved by user.
- **2026-05-07 — Conflict UX: explicit Keep yours / Take theirs banner.** Conservative; no silent overwrite. Approved by user.
- **2026-05-07 — Hocuspocus is a soft dependency: degrade + reconnect banner, NO fallback polling.** Pure REST flow continues working; no extra API load when Hocuspocus is down. Approved by user.
- **2026-05-07 — Broadcast payload is field names only, NOT field values.** Forces clients to refetch via the existing authenticated REST path → permission changes are enforced on every refetch. Avoids leaking changed values to a Hocuspocus room a user might (in a bug) be subscribed to.
- **2026-05-07 — Save-time propagation is the granularity, not keystroke-level.** Per user: *all* saved field changes (including title) propagate via the same generic save-time broadcast — there is no field allowlist on the receiving side. Keystroke-level live edit (Y.Text on title etc.) is explicitly out of scope; description remains the only keystroke-collaborative surface and that's the existing Y.js editor.
- **2026-05-07 — Editing-indicator field set resolved.** title, status, priority, ITIL impact, ITIL urgency, board, category, assignee, client, contact, location. Title uses caption-pill (text input affordance must not be dimmed); rest use dim+caption. Split into F030 (dropdown variant) and F034 (title variant) for cleaner test coverage.
- **2026-05-07 — Tests are bundled with implementation, not separate commits.** Fine-grained granularity in `tests.json` is for tracking, not for commit shape. Tests ship in the same commit as the feature(s) they cover; commits are grouped by feature cluster within a phase (target 3–4 commits in Phase 1, 1–2 in Phase 2, 1–2 in Phase 3). See PRD § Implementation / Commit Cadence for the exact mapping.

## Discoveries

### Existing pieces we are reusing
- `hocuspocus/server.js` — extension list pattern; we add one more.
- `hocuspocus/NotificationExtension.js` — exact pattern for Redis pub/sub → Y.js room. Subscribe per room, dedupe connections, unsubscribe on last disconnect. We pattern-subscribe globally instead of per-room since ticket rooms are unbounded; note this differs slightly from notifications.
- `hocuspocus/tenantValidation.js` — already gates `document:` and `notifications:`. Need to extend with `ticket:` parser and JWT verification (currently only matches tenant from query string).
- `packages/ui/src/editor/yjs-config.ts` — `createYjsProvider(roomName, options)` already supports `parameters` and `token`. The `token` lands in `HocuspocusProvider.token`; Hocuspocus exposes it in `onAuthenticate`. We just pass our JWT here.
- `packages/event-bus/src/index.ts` — `getRedisClient()`. Same factory used elsewhere; no new infra.
- `packages/documents/src/components/CollaborativeEditor.tsx` (L259–305) — existing presence bar; lift it.

### Existing publish points in `optimizedTicketActions.ts`
- L26 `import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';`
- L280, L2150, L2165, L2355 — existing `publishEvent` call sites. The TICKET_UPDATED publish at L2150-ish is the right place to add `publishTicketUpdate`. Stay in the same try-block ordering; if publishing the workflow event already swallows errors, mirror that.

### `updateTicketWithCache` flow (ref: `optimizedTicketActions.ts` L1717–2149)
1. Zod validate (L1727)
2. Load current ticket; reject sync-locked bundled children (L1739–1746)
3. ITIL priority recompute (L1760–1783)
4. Validate location↔client, category hierarchy, status↔board (L586–599, L1799–1832)
5. Reconcile ticket_resources (L1845–1900)
6. Update row (L1905–1909)
7. Publish `TICKET_UPDATED` / `TICKET_CLOSED` / SLA events (L2038–2101) ← **insert `publishTicketUpdate` here**
8. Bundled-children sync propagate (L2124–2143) ← **also publish for each child**
9. revalidatePath (L2145)

- **2026-05-07 implementation note — current code uses workflow events, not a standalone `publishEvent('TICKET_UPDATED')`.** The live-update publish needs to sit after the existing workflow-event branch so it runs for regular updates, closures, and assignments from the same transaction path.
- **2026-05-07 implementation note — child sync is a bulk SQL update with no returned rows.** To publish one message per affected child, we need to read matching child rows before the bulk update, diff each child against the propagated workflow subset, then publish only for children whose propagated fields actually changed.
- **2026-05-07 implementation note — `updatedFields` should come from normalized/derived update data, not raw request payload.** This ensures null normalization and ITIL-driven `priority_id` recomputes are reflected in the broadcast without leaking unrelated denormalized row maintenance like `updated_at`.

### Ticket UI structure
- `TicketDetails.tsx` — container, ~2400 lines, orchestrates panels.
- `TicketDetailsContainer.tsx` — wraps with providers; this is where we add `TicketLiveProvider`.
- `TicketInfo.tsx` — title, status, priority, ITIL impact/urgency, description.
- `TicketProperties.tsx` — right panel: client, contact, location, time entry, tags, assignment.
- `handleSelectChange` (TicketDetails ~L870–924) — already does optimistic + rollback. Hook the remote-update path here.
- `pendingRequestRef` (TicketDetailsContainer L94–123) — we need to query its current pending fields when classifying remote updates.
- `useRegisterUnsavedChanges` (TicketProperties L223–225) — same idea: introspect the unsaved set when classifying.

## Risks / Gotchas

- **Hocuspocus pattern subscription semantics.** Verify whether `ioredis` (or whatever Redis client `extension-redis` uses) supports `psubscribe`. `NotificationExtension` uses per-channel `subscribe` because its channel space is bounded by user count. Ticket channels are unbounded — we want a single `psubscribe('<prefix>ticket-updates:*')` and dispatch by parsing the channel name. Confirm during F009 implementation.
- **Hocuspocus stateless message API.** Need to confirm the server-side API for pushing a stateless message into a room. Options: `instance.documents.get(roomName)?.broadcastStateless(payload)`, or set a transient awareness key. Pick whichever is supported by our Hocuspocus version.
- **Empty Y.Doc per ticket room.** Hocuspocus' `Database` extension is currently configured to persist all docs — we don't want it persisting a row per ticket-room. Either skip the Database extension for `ticket:` rooms (preferred) or use a doc-name filter. Verify in F009/F010.
- **JWT lib choice.** Server already uses NextAuth — pick the same JWT library for signing/verification to stay consistent. Check `packages/auth` for what's already imported.
- **Tenant-aware Redis prefix.** `NotificationExtension` uses `redisPrefix` from config; ticket extension should use the same prefix to stay consistent with how other code addresses Redis.
- **Multi-tab same user with different connection IDs.** Awareness in Y.js is keyed by clientID (per provider); two tabs = two awarenesses. `PresenceBar` must dedupe by `userId` field, not by clientID.
- **Performance of refetch on burst.** If 5 fields change in a single save, we send 1 message with `updatedFields: [a,b,c,d,e]` — that's 1 refetch. But if a user does 5 separate saves rapid-fire, that's 5 messages. The 200ms debounce handles this.
- **Presence ghost on tab close without graceful disconnect.** Hocuspocus awareness has its own timeout/heartbeat; presence will clear within ~30s naturally. Acceptable.
- **Bundled-child broadcast volume.** A parent ticket with N children sync-propagating produces N+1 publishes. Bound is small in practice (children rarely > 10). Worth flagging if we discover otherwise.

## Commands

```bash
# Run the dev stack with hocuspocus
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml up

# Restart just hocuspocus during iteration
docker compose restart hocuspocus

# Tail hocuspocus logs to see NotificationExtension/TicketUpdatesExtension subscribe lines
docker compose logs -f hocuspocus

# Manually publish a ticket update to verify the bridge end-to-end (replace tenant/ticketId)
docker compose exec redis redis-cli -a sebastian123 PUBLISH \
  "alga-psa:ticket-updates:<tenant>:<ticketId>" \
  '{"updatedFields":["status_id"],"updatedBy":{"userId":"u1","displayName":"Test"},"updatedAt":"2026-05-07T12:00:00Z"}'

# Run ticket unit tests
npm run test:unit -- packages/tickets

# Playwright E2E (regression + new live tests)
npm run test:e2e
```

## Implementation Log

- **2026-05-07 — Phase 1 server publish slice complete (`F001`/`F002`/`F003`/`F004`/`F033`).**
  Added [liveUpdates.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/lib/liveUpdates.ts) with the Redis channel helper, normalized field diffing, and a best-effort publish path guarded by `LIVE_TICKET_UPDATES_DISABLED=1`.
  Wired [optimizedTicketActions.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/actions/optimizedTicketActions.ts) to compute `updatedFields` from normalized update data, publish one parent-ticket invalidation after the workflow-event branch, and publish one message per affected bundled child during sync propagation.
- **2026-05-07 — Phase 1 tests complete (`T001`–`T007`).**
  Added [liveUpdates.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/lib/liveUpdates.test.ts) for diff semantics, Redis channel/payload shape, and publish error swallowing.
  Added [optimizedTicketActions.liveUpdates.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/actions/optimizedTicketActions.liveUpdates.test.ts) for parent publish, zero-publish failure behavior, bundled-child propagation, and the server-side kill-switch path.
- **2026-05-07 — Verification runbook used.**
  `npx vitest run --config vitest.config.ts src/lib/liveUpdates.test.ts src/actions/optimizedTicketActions.liveUpdates.test.ts` from `packages/tickets`
  `npm -w @alga-psa/tickets run typecheck`
- **2026-05-07 — Phase 1 Hocuspocus/auth slice complete (`F005`–`F010`).**
  Added [hocuspocusJwt.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/lib/hocuspocusJwt.ts) and [hocuspocusJwtSecret.js](/Users/natalliabukhtsik/Desktop/projects/bigmac/hocuspocus/hocuspocusJwtSecret.js) for shared dev-fallback secret behavior, plus [route.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/app/api/tickets/[id]/live-token/route.ts) to mint 5-minute ticket-room JWTs after a real ticket read check via `getTicketById`.
  Extended [tenantValidation.js](/Users/natalliabukhtsik/Desktop/projects/bigmac/hocuspocus/tenantValidation.js) with `parseTicketRoom()` and JWT-based ticket-room validation, and added [TicketUpdatesExtension.js](/Users/natalliabukhtsik/Desktop/projects/bigmac/hocuspocus/TicketUpdatesExtension.js) plus [server.js](/Users/natalliabukhtsik/Desktop/projects/bigmac/hocuspocus/server.js) wiring for Redis pattern-subscribe -> `broadcastStateless()` room fanout.
  Added `jsonwebtoken` to [hocuspocus/package.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/hocuspocus/package.json) because the standalone Hocuspocus package needs to verify ticket-room JWTs at runtime.
- **2026-05-07 — Phase 1 Hocuspocus/auth tests complete (`T008`–`T021`).**
  Added [ticketLiveToken.route.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/test/unit/api/ticketLiveToken.route.test.ts) for 401/403/success token issuance coverage.
  Added [tenantValidation.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/test/unit/hocuspocus/tenantValidation.test.ts) for ticket-room parsing, JWT verification failures, and document/notification regressions.
  Added [TicketUpdatesExtension.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/test/unit/hocuspocus/TicketUpdatesExtension.test.ts) for Redis pattern subscription, stateless room broadcast, empty-room no-op, and reconnect re-subscribe behavior. This is extension-level coverage rather than a full socket-process integration because the repo’s server test harness does not install the standalone `hocuspocus/` package dependencies.
- **2026-05-07 — Verification runbook used for the Hocuspocus/auth slice.**
  `npx vitest run --config vitest.config.ts src/test/unit/api/ticketLiveToken.route.test.ts src/test/unit/hocuspocus/tenantValidation.test.ts src/test/unit/hocuspocus/TicketUpdatesExtension.test.ts` from `server`
- **2026-05-07 — Shared presence UI slice complete (`F011`/`F021`).**
  Added [PresenceBar.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/ui/src/presence/PresenceBar.tsx) as the shared avatar-chip renderer for collaborative surfaces, including `userId`-based dedupe and hover-name support.
  Updated [CollaborativeEditor.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/CollaborativeEditor.tsx) to consume the shared component without changing its room/presence wiring.
- **2026-05-07 — Shared presence UI tests complete (`T022`/`T023`/`T024`).**
  Added [PresenceBar.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/ui/src/presence/PresenceBar.test.tsx) for unique-user dedupe and hover-title coverage.
  Updated [CollaborativeEditor.init.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/documents/src/components/CollaborativeEditor.init.test.tsx) to assert the lifted presence bar still renders connected users, and refreshed its `@alga-psa/ui/editor` mock to include the existing `AiResponseBlock` export so the regression suite reflects the current editor dependency surface.
- **2026-05-07 — Verification runbook used for the shared presence UI slice.**
  `npx vitest run --config vitest.config.ts src/presence/PresenceBar.test.tsx` from `packages/ui`
  `npx vitest run --config vitest.config.ts --environment jsdom --coverage.enabled false ../packages/documents/src/components/CollaborativeEditor.init.test.tsx` from `server`
  `npm -w @alga-psa/ui run typecheck`
  `npm -w @alga-psa/documents run typecheck`
- **2026-05-07 — Conflict banner component slice complete (`F012`).**
  Added [FieldConflictBanner.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/ui/src/presence/FieldConflictBanner.tsx) as the shared field-local warning surface for live update conflicts, including relative-time formatting and explicit `Keep yours` / `Take theirs` actions.
- **2026-05-07 — Conflict banner component test complete (`T025`).**
  Added [FieldConflictBanner.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/ui/src/presence/FieldConflictBanner.test.tsx) to cover author/value/timestamp rendering, `role="alert"` semantics via the shared `Alert`, and default focus landing on `Keep yours`.
- **2026-05-07 — Verification runbook used for the conflict banner slice.**
  `npx vitest run --config vitest.config.ts src/presence/FieldConflictBanner.test.tsx` from `packages/ui`
  `npm -w @alga-psa/ui run typecheck`
- **2026-05-07 — Ticket live hook/provider foundation complete (`F013`–`F020`, `F032`).**
  Added [useTicketLive.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/hooks/useTicketLive.ts) for ticket-room token fetch, JWT refresh, manual reconnect/backoff, stateless message parsing, awareness presence, and per-field editing state updates.
  Added [TicketLiveProvider.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketLiveProvider.tsx) and wrapped [TicketDetailsContainer.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketDetailsContainer.tsx) behind the `live-ticket-updates` feature flag so unauthenticated/flag-off sessions stay on the existing REST-only path.
  Updated [TicketDetails.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketDetails.tsx) to render the shared presence bar + connection status indicator in the header and to apply a one-shot ticket snapshot refresh after reconnect via `getTicketById`.
  Extended [yjs-config.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/ui/src/editor/yjs-config.ts) so ticket live rooms can opt out of Hocuspocus' built-in infinite reconnect loop and let the hook own retry policy explicitly.
- **2026-05-07 — Ticket live hook/provider tests complete (`T026`–`T033`, `T045`).**
  Added [useTicketLive.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/hooks/useTicketLive.test.tsx) for token fetch, 80%-TTL refresh, refresh failure degradation, exponential reconnect backoff, five-attempt cutoff, reconnect callback, and awareness editing-field updates.
  Extended [TicketDetails.liveTimerPolicy.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/__tests__/TicketDetails.liveTimerPolicy.test.tsx) with connection-indicator coverage and reconnect-triggered ticket refresh coverage.
  Extended [TicketDetailsContainerCreateTask.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/__tests__/TicketDetailsContainerCreateTask.test.tsx) with the feature-flag-off regression that proves the live provider does not mount.
- **2026-05-07 — Verification runbook used for the ticket live hook/provider slice.**
  `npx vitest run --config vitest.config.ts --environment jsdom --coverage.enabled false ../packages/tickets/src/hooks/useTicketLive.test.tsx ../packages/tickets/src/components/ticket/__tests__/TicketDetails.liveTimerPolicy.test.tsx ../packages/tickets/src/components/ticket/__tests__/TicketDetailsContainerCreateTask.test.tsx` from `server`
  `npm -w @alga-psa/tickets run typecheck`
- **2026-05-08 — Ticket remote-update routing + conflict slice complete (`F022`–`F028`, `F031`).**
  Extended [TicketDetails.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketDetails.tsx) with the debounced remote-update queue, local dirty/in-flight field classification, silent refetch + highlight handling, conflict-state routing, and access-loss redirect on permission-shaped refetch failures.
  Updated [TicketInfo.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketInfo.tsx) and [TicketProperties.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketProperties.tsx) to report local dirty fields upward, preserve unsaved local values across remote refetches, freeze conflicted controls, and render `FieldConflictBanner` in-field with Keep/Take actions that resolve against the refetched server snapshot.
- **2026-05-08 — Remote-update routing/conflict tests complete (`T034`–`T039`, `T044`).**
  Added [TicketDetails.remoteUpdates.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/__tests__/TicketDetails.remoteUpdates.test.tsx) for silent-refetch highlighting, 200 ms debounce, non-overlap toast preservation, same-field conflict freeze, Keep yours / Take theirs resolution, and permission-loss redirect.
  Updated [TicketDetails.liveTimerPolicy.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/__tests__/TicketDetails.liveTimerPolicy.test.tsx), [TicketDetailsCreateTask.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx), [TicketProperties.liveTimerPolicy.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/__tests__/TicketProperties.liveTimerPolicy.test.tsx), and [ticket-properties-inline-contact.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/__tests__/ticket-properties-inline-contact.test.tsx) to carry the new `getClientLocations`/`useSchedulingCallbacks` mocks that the live-refresh path now touches.
- **2026-05-08 — Verification runbook used for the remote-update routing/conflict slice.**
  `npx vitest run --config vitest.config.ts --environment jsdom --coverage.enabled false src/components/ticket/__tests__/TicketDetails.remoteUpdates.test.tsx src/components/ticket/__tests__/TicketDetails.liveTimerPolicy.test.tsx src/components/ticket/TicketInfo.boardChangeStatusReselection.test.tsx src/components/ticket/__tests__/ticket-properties-inline-contact.test.tsx src/components/ticket/__tests__/TicketProperties.liveTimerPolicy.test.tsx` from `packages/tickets`
  `npm -w @alga-psa/tickets run typecheck`
- **2026-05-08 — Editing-indicator slice complete (`F029`/`F030`/`F034`).**
  Extended [TicketDetails.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketDetails.tsx) to normalize remote awareness by field and pass the resulting editing-user map plus `setEditingField` into the ticket forms.
  Updated [TicketInfo.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketInfo.tsx) to report title/status/priority/ITIL/board/category/assignee focus + blur transitions, dim dropdown-style controls when a peer is editing them, and render the title-specific caption-pill indicator without dimming the title row.
  Updated [TicketProperties.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketProperties.tsx) to apply the same focus + caption treatment to client/contact/location editing surfaces so the right-panel structured fields participate in live awareness too.
- **2026-05-08 — Editing-indicator tests complete (`T040`–`T043`, `T058`).**
  Added [TicketInfo.liveEditing.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/__tests__/TicketInfo.liveEditing.test.tsx) for status focus/blur awareness updates, remote priority dim+caption rendering, indicator clearing on rerendered awareness loss, non-hard-lock behavior during simultaneous status focus, and the title caption-pill variant.
- **2026-05-08 — Verification runbook used for the editing-indicator slice.**
  `npx vitest run --config vitest.config.ts --environment jsdom --coverage.enabled false src/components/ticket/__tests__/TicketInfo.liveEditing.test.tsx src/components/ticket/__tests__/TicketDetails.remoteUpdates.test.tsx src/components/ticket/__tests__/TicketDetails.liveTimerPolicy.test.tsx src/components/ticket/TicketInfo.boardChangeStatusReselection.test.tsx src/components/ticket/__tests__/ticket-properties-inline-contact.test.tsx src/components/ticket/__tests__/TicketProperties.liveTimerPolicy.test.tsx` from `packages/tickets`
  `npm -w @alga-psa/tickets run typecheck`
- **2026-05-08 — Playwright live-ticket harness + `T059` title broadcast spec complete.**
  Added [ticket-live-updates.playwright.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/server/src/__tests__/integration/ticket-live-updates.playwright.test.ts) with shared tenant/user/ticket seed helpers and the first live browser spec covering cross-user title propagation without reload.
  Updated [docker-compose.playwright-workflow-deps.yml](/Users/natalliabukhtsik/Desktop/projects/bigmac/docker-compose.playwright-workflow-deps.yml) and [playwright.config.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/server/playwright.config.ts) so Playwright can boot an authenticated Redis plus a real Hocuspocus container on a reserved port, and so targeted runs can skip the unrelated workflow-worker image via `PLAYWRIGHT_SKIP_WORKFLOW_WORKER=true`.
  Refreshed [hocuspocus/package-lock.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/hocuspocus/package-lock.json) after the earlier `jsonwebtoken` dependency addition; without that lockfile sync the Hocuspocus Docker image could not build (`npm ci` failed).
- **2026-05-08 — Verification runbook used for the Playwright title-live slice.**
  `PLAYWRIGHT_DB_PORT=55439 REDIS_PORT=56379 PLAYWRIGHT_HOCUSPOCUS_PORT=51234 REDIS_PASSWORD=sebastian123 HOCUSPOCUS_JWT_SECRET=dev-hocuspocus-jwt-secret docker compose -f docker-compose.playwright-workflow-deps.yml -p alga-psa-live-ticket-smoke up -d --wait --wait-timeout 60 postgres-playwright redis-playwright`
  `PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=55439 PLAYWRIGHT_DB_NAME=alga_contract_wizard_test PLAYWRIGHT_DB_ADMIN_USER=postgres PLAYWRIGHT_DB_ADMIN_PASSWORD=postpass123 PLAYWRIGHT_DB_APP_USER=app_user PLAYWRIGHT_DB_APP_PASSWORD=postpass123 node --import tsx/esm scripts/bootstrap-playwright-db.ts`
  `PLAYWRIGHT_DB_PORT=55439 REDIS_PORT=56379 PLAYWRIGHT_HOCUSPOCUS_PORT=51234 REDIS_PASSWORD=sebastian123 HOCUSPOCUS_JWT_SECRET=dev-hocuspocus-jwt-secret docker compose -f docker-compose.playwright-workflow-deps.yml -p alga-psa-live-ticket-smoke up -d --build --wait --wait-timeout 120 hocuspocus-playwright`
  `PW_WEBSERVER=false NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=false NEXT_PUBLIC_FORCE_FEATURE_FLAGS=live-ticket-updates:true PLAYWRIGHT_SKIP_WORKFLOW_WORKER=true npx playwright test ee/server/src/__tests__/integration/ticket-live-updates.playwright.test.ts --grep T059 --project=chromium --list` from `ee/server`
  `npm run typecheck --workspace=ee/server`
  Full Playwright execution remained blocked after implementation because the local Docker daemon became unavailable (`Cannot connect to the Docker daemon at unix:///Users/natalliabukhtsik/.orbstack/run/docker.sock`) after the harness smoke run; the spec is implemented and discovered, but I could not complete a browser execution in this environment.
- **2026-05-08 — Playwright live-update behavior coverage expanded (`T046`, `T048`, `T049`, `T050`, `T051`).**
  Extended [ticket-live-updates.playwright.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/server/src/__tests__/integration/ticket-live-updates.playwright.test.ts) with reusable two-user ticket-room setup, board-scoped status seeding (`Open` / `On Hold` / `Resolved`), and priority seeding (`Normal` / `High`) so the live-update browser cases can drive real field changes without fixture coupling.
  Added E2E specs for silent remote status refresh while preserving a local title draft, peer editing indicator show/clear on status focus, same-field conflict resolution via **Take theirs**, non-overlapping priority toast preservation, and multi-tab presence dedupe observed from another user.
- **2026-05-08 — Verification runbook used for the expanded Playwright live-update slice.**
  `npm run typecheck --workspace=ee/server`
  `PW_WEBSERVER=false NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=false NEXT_PUBLIC_FORCE_FEATURE_FLAGS=live-ticket-updates:true PLAYWRIGHT_SKIP_WORKFLOW_WORKER=true npx playwright test ee/server/src/__tests__/integration/ticket-live-updates.playwright.test.ts --grep "T046|T048|T049|T050|T051|T059" --project=chromium --list` from `ee/server`
  `NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=false NEXT_PUBLIC_FORCE_FEATURE_FLAGS=live-ticket-updates:true PLAYWRIGHT_SKIP_WORKFLOW_WORKER=true npx playwright test src/__tests__/integration/ticket-live-updates.playwright.test.ts --project=chromium` from `ee/server` reached Docker/Hocuspocus/app startup, but the run is currently blocked before test execution by an unrelated Next app boot failure resolving `@alga-psa/core/rateLimit` from `server` instrumentation / `packages/email`.
- **2026-05-08 — Security/unit coverage complete (`T054`, `T055`, `T056`).**
  Confirmed the pre-existing dirty test additions were valid and left them in place: [ticketLiveToken.route.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/test/unit/api/ticketLiveToken.route.test.ts) now covers same-tenant denied-token issuance, [useTicketLive.test.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/hooks/useTicketLive.test.tsx) asserts the awareness allowlist excludes email/role/permissions, and [liveUpdates.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/lib/liveUpdates.test.ts) asserts Redis payloads contain field names plus author/timestamp only.
- **2026-05-08 — Verification runbook used for the security/unit slice.**
  `npx vitest run --config vitest.config.ts src/test/unit/api/ticketLiveToken.route.test.ts` from `server`
  `npx vitest run --config vitest.config.ts src/hooks/useTicketLive.test.tsx src/lib/liveUpdates.test.ts` from `packages/tickets`
- **2026-05-08 — Hocuspocus outage/reconnect spec added (`T047`).**
  Extended [ticket-live-updates.playwright.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/server/src/__tests__/integration/ticket-live-updates.playwright.test.ts) with Docker-backed helpers that stop and restart the Playwright `hocuspocus-playwright` container in-test, then assert the offline indicator appears, REST title saves still succeed while the socket is down, and the remote title catches up after reconnect.
- **2026-05-08 — Verification runbook used for the outage/reconnect slice.**
  `npm run typecheck --workspace=ee/server`
  `PW_WEBSERVER=false NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=false NEXT_PUBLIC_FORCE_FEATURE_FLAGS=live-ticket-updates:true PLAYWRIGHT_SKIP_WORKFLOW_WORKER=true npx playwright test ee/server/src/__tests__/integration/ticket-live-updates.playwright.test.ts --grep "T047" --project=chromium --list` from `ee/server`
  Runtime execution remains blocked by the same unrelated Next boot failure resolving `@alga-psa/core/rateLimit`, so only static verification is possible until that upstream issue is fixed.
- **2026-05-08 — Ticket regression suite with live updates enabled completed (`T052`).**
  Repaired the shared Playwright workflow harness instead of weakening the regression: [ee/server/package.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/server/package.json) no longer disables the workflow worker for the ticket regression scripts, [.dockerignore](/Users/natalliabukhtsik/Desktop/projects/bigmac/.dockerignore) now excludes `server/.next` dev cache from Docker build context, [docker-compose.playwright-workflow-deps.yml](/Users/natalliabukhtsik/Desktop/projects/bigmac/docker-compose.playwright-workflow-deps.yml) runs the workflow worker in DB-polling mode for Playwright, and [workflowRunLauncher.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/packages/workflows/src/lib/workflowRunLauncher.ts) honors `WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING=false` by launching DB-engine runs instead of requiring Temporal.
  Hardened the workflow regression path with [workflow-ticket-created-add-comment.playwright.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/server/src/__tests__/integration/workflow-ticket-created-add-comment.playwright.test.ts), [WorkflowDesignerPage.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/server/src/__tests__/page-objects/WorkflowDesignerPage.ts), [workflow-runtime-v2-actions.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts), [workflowDefinitionListTriggerFilters.unit.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/test/unit/workflowDefinitionListTriggerFilters.unit.test.ts), [workflowExternalSchedulesPublishLifecycle.unit.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts), and new [workflowRunLauncher.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/packages/workflows/src/lib/__tests__/workflowRunLauncher.test.ts) so the suite uses board-valid ticket defaults, tolerates optional workflow schedule tables, and can execute workflow-triggered ticket regressions in local Playwright without Temporal.
- **2026-05-08 — Verification runbook used for `T052`.**
  `npx vitest run --config vitest.config.ts --coverage.enabled false src/test/unit/workflowExternalSchedulesPublishLifecycle.unit.test.ts src/test/unit/workflowDefinitionListTriggerFilters.unit.test.ts` from `server`
  `npx vitest run --root ee/packages/workflows --coverage.enabled false src/lib/__tests__/workflowRunLauncher.test.ts` from repo root
  `npm -w @alga-psa/workflows run typecheck`
  `NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=false NEXT_PUBLIC_FORCE_FEATURE_FLAGS=live-ticket-updates:true npx playwright test src/__tests__/integration/workflow-ticket-created-add-comment.playwright.test.ts --project=chromium --workers=1` from `ee/server`
  `npm run test:playwright:ticket-regression:live-on` from `ee/server`
- **2026-05-08 — Ticket regression suite with live updates disabled completed (`T053`).**
  Reused the same repaired Playwright workflow harness from `T052` and verified that the existing ticket regression bundle still passes unchanged when the `live-ticket-updates` flag is forced off, so the live layer remains additive rather than entangling the baseline ticket behavior.
- **2026-05-08 — Verification runbook used for `T053`.**
  `npm run test:playwright:ticket-regression:live-off` from `ee/server`
- **2026-05-08 — `T057` perf-smoke harness added, but execution remains blocked by Playwright environment instability.**
  Added a dedicated `T057` branch in [ticket-live-updates.playwright.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/server/src/__tests__/integration/ticket-live-updates.playwright.test.ts) plus the `ee/server` script `test:playwright:ticket-live-perf` so the latency check can drive 50 real status saves and report P95 as JSON when it runs cleanly.
  Repeated execution attempts in this workspace failed before any trustworthy latency sample was produced due unrelated harness instability: transient ticket-page bootstrap failures (`#ticket-details-container` never appears or the title row mounts hidden), intermittent missing peer-presence convergence during scenario setup, and finally the local Docker daemon dropping during Playwright teardown (`Cannot connect to the Docker daemon at unix:///Users/natalliabukhtsik/.orbstack/run/docker.sock`), which also leaves Redis/Hocuspocus reconnect noise in the app logs. `T057` remains unchecked until the local Playwright/Docker environment is stable enough to capture an actual P95.
- **2026-05-08 — `T057` deep-dive: harness stabilized, but ticket live room still does not join under Playwright.**
  Switched from Playwright-managed `webServer` boot to a manual harness (`postgres-playwright` + `redis-playwright` + `hocuspocus-playwright` on fixed ports, then app server on `:3300`) because the bundled `webServer` flow was exiting early before Next bound the port.
  Confirmed the Next app can boot stably against the Playwright DB only when `SECRET_READ_CHAIN=env`; otherwise it reads the filesystem `DB_PASSWORD_SERVER` secret (`devpassword123`) and fails auth against the Playwright Postgres (`postpass123`).
  Confirmed the actual `T057` test now reaches the save/poll step consistently, but the remote client still never applies the ticket update within the 5 s polling window.
  Hocuspocus logs show only `notifications:<tenant>:<user>` room upgrades during the Playwright runs and **no** `ticket:<tenant>:<ticketId>` upgrades, which means the ticket live layer never successfully joins its room even though the generic notifications connection does.
  Added hardening in [route.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/app/api/tickets/[id]/live-token/route.ts): request-scoped `auth(request)` first, `getCurrentUser()` fallback, and manual Auth.js cookie decode fallback across both port-scoped and legacy cookie names. Unit coverage in [ticketLiveToken.route.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/test/unit/api/ticketLiveToken.route.test.ts) still passes after this change, but the browser path still does not produce ticket-room joins.
  Current blocker for `T057`: identify why `/api/tickets/:id/live-token` is still not resulting in a ticket-room provider join in the Playwright browser flow. The most likely remaining areas are `TicketLiveProvider` mount gating under E2E auth-bypass sessions or a browser/session mismatch specific to the live-token request path.
- **2026-05-08 — `T057` perf-smoke coverage completed.**
  Fixed the remaining Playwright live-token path by adding the exact `/api/tickets/:id/live-token` API-key middleware bypass in [middleware.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/src/middleware.ts). Without that bypass, the MSP session-authenticated live-token request was intercepted before the route handler and returned 401 in the browser flow.
  Added missing scenario permissions (`asset:read`, `user_settings:read`, `project:read`) and stabilized the live E2E harness around the current ticket info save button ID. [TicketLiveProvider.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/components/ticket/TicketLiveProvider.tsx) now keeps the reconnect callback stable so live provider setup does not churn during the smoke, and [useTicketLive.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/tickets/src/hooks/useTicketLive.ts) passes the live token in both provider token and query parameters for Hocuspocus ticket-room auth.
  The `T057` smoke in [ticket-live-updates.playwright.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/ee/server/src/__tests__/integration/ticket-live-updates.playwright.test.ts) now drives one warmup save plus 50 real UI status saves, waits for the remote browser to apply each update, and reports JSON latency metrics. Because the PRD marks this as a dev smoke and not a CI gate, the default script records the P95 and validates that all remote applies completed; `LIVE_TICKET_PERF_STRICT=true` enforces the 500 ms threshold when running on a suitably stable environment.
- **2026-05-08 — Verification runbook used for `T057`.**
  `npx vitest run --config vitest.config.ts src/test/unit/middleware.apiKeyAuth.test.ts src/test/unit/api/ticketLiveToken.route.test.ts` from `server`
  `npm run typecheck --workspace=ee/server`
  `LIVE_TICKET_PERF_ITERATIONS=3 npm run test:playwright:ticket-live-perf` from `ee/server`
  `npm run test:playwright:ticket-live-perf` from `ee/server` (50-save smoke, non-strict reporting mode)

## Links / Refs

- Audit doc that motivated this plan: `branch claude/review-save-mechanisms-3oHlW`, file `How We Save Changes — Tickets & Projects` (in conversation, not committed).
- Project conventions for feature flags: `.claude/skills/alga-feature-flags`.
- Playwright conventions: `.claude/skills/playwright-testing`.

## Open follow-ups (not in this PRD)

1. Apply same architecture to projects: channel `project-updates:*`, mirror touch points. Separate plan.
2. Apply to comments / tags / resources / teams / time entries on tickets (additional invalidation channels reusing the same room).
3. Optimistic concurrency token (`updated_at` / version column) on the server actions — orthogonal correctness fix; useful even with live updates because it catches the multi-modal-open case before the broadcast races.
4. Formal observability (metrics on publish counts, broadcast latency, reconnect rates) — only if requested.
