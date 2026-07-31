# PRD — Microsoft Teams Integration: Production Readiness

- **Plan folder:** `ee/docs/plans/2026-07-03-teams-production-readiness/`
- **Status:** Draft (pending scope confirmation)
- **Date:** 2026-07-03
- **Related plans:** `2026-03-07-microsoft-teams-integration-v1`, `2026-04-23-teams-meeting-on-appointment-approval`, `2026-05-12-teams-enterprise-addons`, `2026-05-24-teams-observability-loop`, `2026-05-29-teams-diagnostics-test-message`, `2026-06-01-teams-online-meetings-interactions`

## 1. Problem statement

The Microsoft Teams integration (EE add-on, `ADD_ONS.TEAMS`, enforced at ~10 gate sites) has a broad feature surface, but several gaps keep it from being production-ready:

- **Meeting scheduling is half-functional.** The booking → approval → join-link path works, but meetings are created on a shared service-account calendar with **no attendees** — the client and the assigned technician never receive a real Outlook/Teams calendar invite; they only get a link in an email. Decline orphans live Teams meetings, cancel can orphan them on transient Graph failures, and every Graph failure is swallowed (`return null`, `logger.warn`) so approvers silently get link-less approvals. Recording/transcript capture has no polling fallback, and its subscription-renewal job never runs on self-hosted EE deployments using pg-boss.
- **The chat bot is barely usable.** Ten real, RBAC-checked command handlers exist, but users hit cliffs before reaching them: unlinked users get a **dead-end** "sign-in required" card with no button; if bot credentials are missing the bot **silently never replies** (HTTP 200, nothing happens); commands are strict anchored regexes requiring raw UUIDs (`approve approval <approval-id>`); replies are plain hero cards.
- **Two inbound surfaces are unauthenticated.** The message-extension and quick-action endpoints do **no Bot Framework JWT verification** — identity is taken from the caller-supplied request body. A caller who knows a linked user's AAD object id can execute mutations as that user. The bot route also proceeds unauthenticated when `TEAMS_BOT_APP_*` env is unset.
- **The delivery-observability layer is not recording production traffic.** The live notification path uses a simpler duplicate delivery module in `packages/notifications` instead of the EE implementation that writes `teams_notification_deliveries`; the diagnostics panel's "recent delivery health" therefore reads from a table production never populates.
- **Onboarding is a documentation cliff.** Setup requires a manual Azure app registration, a separate Bot Framework registration that must match the generated manifest's botId (an undocumented footgun — manifest botId is the tenant profile client_id while the runtime bot authenticates with platform-level env creds), correct Graph app permissions plus Exchange/Teams application access policies, and a manual sideload. The only runbook covers meetings; nothing covers the base setup.

This plan closes the gap to a production-ready integration: secure, reliable, self-serve to set up, and pleasant enough that an MSP's technicians actually use it.

## 2. Current state (evidence summary)

What works today (EE + active `teams` add-on + configured tenant):

- Personal tab (iframe of PSA with Teams SSO popup), personal/group-chat bot with 10 commands, message extension (search + message→ticket + message→note), quick-action task modules, activity-feed notifications for 5 categories, appointment-approval Teams meetings with join link in email/ICS/portal, direct "Online Meeting" interactions, webhook-driven recording/transcript capture into documents/files, admin settings with capabilities/categories/allowed-actions, app-package generation + zip download, 10-step diagnostics + proactive test message, delivery/audit/conversation-reference tables.

Key deficiencies with evidence (full detail in `SCRATCHPAD.md`):

| # | Deficiency | Evidence |
|---|---|---|
| 1 | Message-extension & quick-action endpoints skip Bot Framework JWT verification | `teamsQuickActionHandler.ts:795`, `teamsMessageExtensionHandler.ts:1363` vs bot's `teamsBotHandler.ts:1173` |
| 2 | Bot processes activities unauthenticated when creds unset | `teamsBotJwtVerifier.ts:73-80` returns `unconfigured`, handler proceeds |
| 3 | Approval-path meetings created with no attendees; no calendar invites | `appointmentRequestManagementActions.ts:630-636` (no `attendees`) |
| 4 | Decline never deletes the Graph meeting; cancel deletes after commit w/o retry | `appointmentRequestManagementActions.ts:1277-1284`; `appointmentRequestActions.ts:1454` |
| 5 | All Graph meeting ops swallow failures (`null` + `warn`); approver never told | `createTeamsMeeting.ts:93-194`, `updateTeamsMeeting.ts`, `deleteTeamsMeeting.ts` |
| 6 | Artifact capture: webhook-only (no polling fallback), renewal cron absent on pg-boss EE, attempts cap 3 → premature terminal `no_recording` | `onlineMeetingArtifactCapture.ts`; `server/src/lib/jobs/index.ts:494-508`; `OnlineMeetingModel.listPendingRecordings` (zero non-test callers) |
| 7 | Bot sign-in dead end (buttonless card), silent no-reply, rigid regex commands, raw-ID ergonomics | `teamsBotHandler.ts:1022-1039`, `:1216`, `:185-266` |
| 8 | Prod notifications bypass the delivery recorder (duplicate impl) | `packages/notifications/src/realtime/teamsNotificationDelivery.ts` (wired) vs `ee/packages/microsoft-teams/src/lib/notifications/teamsNotificationDelivery.ts:355` (recorded, unused in prod) |
| 9 | Manifest bot command list omits implemented commands | `teamsPackageActions.ts:221-227` vs handler `:197,:245,:255` |
| 10 | No setup runbook for Azure app / Bot Framework / sideload; manifest-botId vs env-creds mismatch undocumented | only `docs/integrations/teams-meetings-setup.md`; `teamsBotConnector.ts:30-67` |
| 11 | Add-on gate duplicated (~6 copies of `tenantHasTeamsAddOn`) | e.g. `meetingConfig.ts:35-44`, `teamsNotificationDelivery.ts:299-307` |
| 12 | Approval file is `// @ts-nocheck` — meeting plumbing untypechecked | `appointmentRequestManagementActions.ts:1-2` |
| 13 | Delivery/audit read APIs exist with no UI consumer | `listTeamsDeliveries` / `listTeamsAuditEvents` |
| 14 | 2 unimplemented tests from the addons plan (Entra guard 403; tier-vs-addon smoke) | `2026-05-12-teams-enterprise-addons/tests.json` T003/T006 |

## 3. Goals

1. **Secure by default (P0):** every inbound Teams surface cryptographically verified; fail closed when unconfigured.
2. **Meetings behave like real bookings (P1):** attendees get actual calendar invites; reschedule/cancel/decline propagate to Microsoft; failures are visible and retryable, never silent.
3. **Artifact capture is dependable (P1):** works on both Temporal and pg-boss deployments; recovers from missed webhooks.
4. **The bot is usable by a non-expert technician (P1):** working sign-in from the bot, human-friendly references, forgiving parsing, actionable cards, no silent failure modes.
5. **Self-serve onboarding (P1):** an MSP admin can go from zero to verified-working using in-product guidance + a complete runbook, with live validation at each step.
6. **Entitlement consistency (P1):** single centralized entitlement gate, production delivery/audit visibility, clear locked/inactive states, defined expiry behavior.
7. **Natural-language layer (P2, stretch):** free-text bot commands on top of the existing action registry.

## 4. Non-goals

- Channel (team-scope) bot conversations — remains personal + group chat.
- Encrypted Graph change-notification resource data (subscriptions are created unencrypted; keep explicit, loud failure).
- CE availability of any Teams feature; changes to the add-on/entitlement model itself.
- Replacing the shared-organizer model with per-technician delegated OAuth (recorded as a future option; app-only + attendees covers the invite gap).
- Google Meet / other meeting providers.
- Prometheus/OTel metrics export.

## 5. Personas & primary flows

- **MSP admin** — activates the add-on and configures the integration; needs setup to succeed without support tickets.
- **Technician (internal user)** — receives assignment/reply notifications in Teams, acts on tickets from the bot/cards, joins meetings from their own calendar.
- **Dispatcher/approver** — approves appointment requests; must see meeting-generation success/failure at decision time.
- **Client contact** — books in the client portal; receives a real calendar invite with the Teams link; sees accurate state after cancel.

Primary flows: (a) admin zero→verified setup; (b) client books → approver approves → both sides get invites → meeting happens → recording/transcript lands on the interaction; (c) technician gets an actionable Teams notification and resolves work without leaving Teams; (d) technician chats "ticket 1234", "assign 2 to me", "new ticket printer down at Acme".

## 6. Epics & requirements

### E1 — Inbound security hardening (P0)

1. Extract a shared inbound-verification helper (JWT verify against Bot Framework OpenID metadata, audience = `TEAMS_BOT_APP_ID`, trusted-serviceUrl allow-list) and apply it to **all three** surfaces: bot messages, message-extension query, quick-actions.
2. Fail closed: when bot credentials are unconfigured, inbound requests are rejected 401/403 (never processed unauthenticated). Diagnostics `bot_connector` check already explains the remedy.
3. Use identity claims from the **verified token** (tid, oid) as the source of truth; reject mismatches with the activity body rather than trusting `from.aadObjectId` / `channelData.tenant.id`.
4. New diagnostics check: generated-manifest `webApplicationInfo.id`/botId consistency with the runtime `TEAMS_BOT_APP_ID` (surfaces the registration-mismatch footgun).

*Acceptance:* requests without a valid Bot Framework JWT are rejected on every surface (verified by route tests); no code path executes registry actions from unverified identity.

### E2 — Notification delivery correctness (P0/P1)

1. Make the EE delivery implementation (the one writing `teams_notification_deliveries` via `writeTeamsDeliveryRow`) the **only** implementation; the `packages/notifications` copy becomes a thin dynamic delegator (CE-safe, same pattern as `teamsMeetingService`). No duplicate logic left.
2. Retry retryable Graph failures (429 w/ Retry-After, 5xx) with bounded backoff before recording `failed`.
3. Result: the diagnostics "recent delivery health" step reflects real production traffic.

*Acceptance:* a delivered/failed/skipped row exists for every production Teams notification attempt; duplicate module deleted.

### E3 — Meetings that behave like real calendar bookings (P1)

**Invites & content**
1. Approval-path meeting creation passes attendees: the client contact (required) and the assigned technician (required), reusing the `scheduleTeamsMeeting` attendee shape. Organizer remains the tenant service account.
2. Admin toggle "Send calendar invites to participants" on the Teams meeting settings (default **on**).
3. Meeting subject/body carry appointment context (service/appointment title, PSA link).
4. Reschedule PATCHes subject + attendees + times (today: times only) so Graph sends updated invites; attendee set refreshed if the assignee changed.

**Lifecycle integrity**
5. Decline of a previously-approved request deletes the Graph meeting (parity with cancel).
6. Cancel/decline Graph cleanup is an idempotent, retried job (IJobRunner) rather than a fire-and-forget post-commit call; `online_meetings` reflects `cancel_pending` until confirmed.
7. The already-computed `teamsMeetingWarning` is surfaced in the client-portal cancel dialogs.

**Failure visibility**
8. Meeting CRUD returns typed results (`created | failed(reason) | skipped(not_configured/addon_inactive)`); callers stop conflating them.
9. Approver UI shows meeting-generation failure at approval time with "approve without meeting" and "retry" choices; approved requests missing a link get a "Generate Teams meeting" retry action.
10. Graph failures persist an `online_meetings` row with `status='failed'` + error code (not silent absence).
11. Remove `// @ts-nocheck` from `appointmentRequestManagementActions.ts`; file typechecks.

**Artifact capture reliability**
12. Ensure artifact subscriptions at meeting-creation time (not only via the 30-min renewal cron).
13. Schedule subscription renewal through the IJobRunner abstraction so it runs on Temporal **and** pg-boss deployments (per repo policy: never pg-boss directly).
14. Polling fallback job sweeps `recording_pending` meetings (using the existing, currently-uncalled `listPendingRecordings`) and fetches artifacts after meeting end.
15. Replace the hard `recording_fetch_attempts` cap of 3 with a bounded backoff schedule; early empty notifications must not drive a meeting to terminal `no_recording` while Teams is still processing.
16. Diagnostics: subscription-expiry check + webhook base-URL reachability check.

*Acceptance:* both participants see the meeting on their own calendars; declining/cancelling reliably removes it; a killed webhook does not lose a recording; no silent link-less approvals.

### E4 — Bot usability (P1)

1. **Sign-in that works:** unlinked users receive a card with a sign-in button (deep link into the existing tab sign-in / Microsoft account-link flow); on completion the bot confirms with a welcome card. No dead ends.
2. **Human references:** accept ticket numbers (`1234`, `#1234`); `ticket <text>` falls back to title search with a pick list; list results (`my tickets`, `my approvals`) are numbered and follow-up commands accept ordinals (`approve 2`, `ticket 3`) via a per-conversation context of last-listed entities (stored alongside conversation references).
3. **Forgiving parsing:** missing-argument commands prompt with examples instead of the generic fallback; near-miss suggestions for misspelled commands.
4. **Create from chat:** `new ticket <title>` (optional client) reusing the `create_ticket_from_message` registry action.
5. **Actionable cards:** migrate bot replies to Adaptive Cards with inline actions (Assign to me, Add note, Open) replacing hero-card `imBack` round-trips; ticket card "Assign to me" executes and updates in place.
6. **No silent failures:** settings shows a prominent banner when bot connector credentials are missing ("bot cannot reply"); manifest bot command list generated from the same source of truth as the handler (adds `my approvals`, approval commands, `new ticket`).
7. **Notifications where people live:** optional bot-DM delivery (actionable Adaptive Card via stored conversation references) per notification category — admin chooses activity feed / bot DM / both. RBAC-aware help card generated from the action registry (users only see commands they can execute).
8. Friendly unsupported-scope reply (channels) with a docs link.

*Acceptance:* a brand-new linked technician can list, open, assign, note, and create tickets from Teams without reading docs or pasting UUIDs; an unlinked user can self-serve link from the bot.

### E5 — Natural-language layer (P2, stretch)

1. LLM intent parsing mapping free text to existing registry actions; deterministic parser remains the fallback and the default when unavailable.
2. Every NL-parsed **mutation** shows a confirmation card before executing; execution goes exclusively through `executeTeamsAction` (RBAC + audit + idempotency preserved — prompt injection cannot widen scope).
3. Disambiguation dialog for ambiguous targets.
4. Gated behind the AI Assistant add-on plus a tenant toggle (open question below).

### E6 — Self-serve onboarding & admin experience (P1)

1. Guided setup wizard (stepper): Microsoft profile → Graph permissions → Bot Framework registration → activate → generate/download package → sideload instructions → verify (diagnostics + test message).
2. Live validation, not presence checks: acquire a Graph app token on save/validate; per-permission consent probe for required Graph app permissions; on-demand Bot Framework token acquisition.
3. Complete admin runbook (`docs/integrations/teams-setup.md`): Azure app registration (scopes, redirect URIs, App ID URI), Bot Framework/Azure Bot registration and how it must relate to platform bot creds and the manifest botId, Graph app permissions + Exchange/Teams application access policies, package sideload (incl. org-wide app catalog upload), verification. In-app links from wizard/settings.
4. Stale-manifest detection: warn when the deployment base URL or profile changed after the last package generation.
5. Delivery log viewer + audit log viewer in the Teams settings area (consuming the existing `listTeamsDeliveries` / `listTeamsAuditEvents` actions), with a troubleshooting panel mapping delivery error codes (`graph_unauthorized`, `user_not_mapped`, `addon_inactive`, …) to remedies.

*Acceptance:* a competent MSP admin completes setup unassisted; every failure they can hit during setup has an in-product or runbook remedy.

### E7 — Entitlement gating & add-on lifecycle (P1)

1. Centralize the add-on gate: one exported `tenantHasTeamsAddOn`/`assertTeamsAddOn` helper; migrate the ~6 duplicated copies.
2. Close the addons-plan test debt: Entra guard 403-without-add-on regression test; tier-alone-does-not-unlock smoke coverage.
3. Paywall card in Teams settings shows what's included + purchase CTA for billing admins (deep link to Account Management add-on purchase).
4. Defined expiry behavior: expired add-on soft-disables (sends skipped with `addon_inactive`, config and history preserved, admin banner explains).
5. Update `ADD_ON_DESCRIPTIONS[TEAMS]` to include meetings, recordings/transcripts capture.

## 7. UX / UI notes

- Setup wizard lives where `TeamsIntegrationSettings` renders today (Settings → Integrations → Microsoft Teams); existing three-card layout becomes the "manage" view once installed.
- All new interactive elements need kebab-case `id`s (UI reflection) and `t()` i18n keys (both portals rule applies to the client-portal cancel dialog change).
- Approver failure surfacing: inline alert in `AppointmentRequestsPanel` approve flow, not a toast that can be missed.
- Adaptive Cards: keep hero-card fallback for surfaces/clients that reject Adaptive Cards.

## 8. Data model / API notes

- `online_meetings`: add `status='cancel_pending'` + error-code column for failed creation (extend existing CHECK).
- New per-conversation bot context: extend `teams_conversation_references` (or sibling table, tenant in PK) with last-listed-entities JSONB + TTL.
- `teams_integrations`: add invite toggle + notification-channel-per-category (extend existing JSONB `notification_categories` shape), package-staleness metadata.
- Graph calls remain hand-rolled `fetch` (no SDK adoption in this plan); app-only auth model unchanged.
- Citus rules: every new table/column keyed and queried by `tenant`.
- Jobs via IJobRunner abstraction only (Temporal EE / pg-boss fallback) — no direct pg-boss usage.

## 9. Rollout & migration

- Phase order: E1+E2 (P0, ship first — security fix should not wait on the rest), then E3/E4/E6/E7 in parallel tracks, E5 last.
- E1 is a behavior change for misconfigured tenants (previously "worked" unauthenticated): release note + diagnostics guidance; no data migration.
- Attendee invites apply to newly created/updated meetings only; no backfill.
- Existing PostHog flag `teams-integration-ui` continues to gate visibility; new NL layer gets its own flag.
- The duplicate-delivery consolidation must keep CE builds green (dynamic import pattern, ce-ee-stub conventions).

## 10. Risks

- **JWT enforcement may break tenants whose Bot Framework registration is subtly wrong** — mitigated by the new diagnostics check and runbook shipped in the same release.
- **Attendee invites via app-only Graph**: sending invites from a service-account organizer can land in spam or read oddly ("Alga Meetings" organizer); mitigate with organizer display-name guidance in runbook. Per-technician delegated organizers deliberately deferred.
- **Adaptive-card migration** risks regressions on older Teams clients — keep hero fallback and test matrix in tests.json.
- **NL layer cost/safety** — mitigated by confirmation cards + registry-only execution; still behind flag + add-on.
- Cancel-cleanup job changes touch a `@ts-nocheck` file with heavy existing behavior — typecheck restoration (E3.11) lands first.

## 11. Open questions

1. Should the NL bot layer (E5) require the AI Assistant add-on in addition to the Teams add-on, or ship with the Teams add-on alone? (Plan assumes: requires AI Assistant add-on.)
2. Default notification channel once bot-DM exists: keep activity feed as default, or default new installs to bot-DM? (Plan assumes: activity feed default, per-category opt-in.)
3. Is per-technician delegated meeting organizers (meetings on the tech's own calendar as organizer) wanted as a fast-follow? (Out of scope here.)
4. Should the sideload step be reduced via Teams Admin Center app-catalog API automation, or is documented manual upload acceptable for v1? (Plan assumes: documented manual upload.)

## 12. Definition of done

- All P0/P1 features in `features.json` implemented; tests in `tests.json` implemented and green.
- A tenant configured per the runbook passes all diagnostics checks, and: books → approves → both attendees receive calendar invites → decline/cancel removes the meeting → recording lands via webhook **and** via polling with webhooks disabled.
- Security: no inbound Teams surface processes an unverified request (route tests prove it).
- Prod delivery rows visible in the new delivery log viewer.
- CE build unaffected (stubs 501, no EE imports leak).
