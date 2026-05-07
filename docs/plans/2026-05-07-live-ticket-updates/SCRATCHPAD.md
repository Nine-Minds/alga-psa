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

## Links / Refs

- Audit doc that motivated this plan: `branch claude/review-save-mechanisms-3oHlW`, file `How We Save Changes — Tickets & Projects` (in conversation, not committed).
- Project conventions for feature flags: `.claude/skills/alga-feature-flags`.
- Playwright conventions: `.claude/skills/playwright-testing`.

## Open follow-ups (not in this PRD)

1. Apply same architecture to projects: channel `project-updates:*`, mirror touch points. Separate plan.
2. Apply to comments / tags / resources / teams / time entries on tickets (additional invalidation channels reusing the same room).
3. Optimistic concurrency token (`updated_at` / version column) on the server actions — orthogonal correctness fix; useful even with live updates because it catches the multi-modal-open case before the broadcast races.
4. Formal observability (metrics on publish counts, broadcast latency, reconnect rates) — only if requested.
