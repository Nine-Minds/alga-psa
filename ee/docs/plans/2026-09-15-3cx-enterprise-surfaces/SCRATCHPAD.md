# Scratchpad — 3CX Enterprise Surfaces

- Plan slug: `2026-09-15-3cx-enterprise-surfaces`
- Created: `2026-09-15`
- Predecessor: [3CX CRM template](../2026-09-02-3cx-crm-template/PRD.md) (all 86 features shipped on `integrations/3cx_planning`)
- Decision record: [3CX assessment](../2026-08-28-3cx-integration-assessment/ASSESSMENT.md) sections 3 (Phase 2, Phase 3) and 5 (emulator Phase 2/3)

## Decisions

- (2026-09-15) Alga tier stays `PBX_TELEPHONY` at `pro` for every new surface.
  The 3CX license (Enterprise/AI, 8SC+) is the real gate; the card explains
  which features need PBX API credentials and reports whether they work.
- (2026-09-15) Screen pop is an incoming-call card in the MSP app (contact,
  client, open tickets, recent interactions, actions), not only a toast. It
  rides the existing per-user Hocuspocus notification room; the 30 s polling
  fallback is too slow for ring time, so the card only appears when the socket
  is connected.
- (2026-09-15) Phonebook sync is two-way. Push: active contacts with a phone
  become 3CX company phonebook entries. Import: 3CX entries whose name or
  email matches an existing contact add their numbers to that contact; the
  import never creates contacts. Scheduled reconcile is opt-in on the card
  (off, daily, hourly). Mapping rows live in `tenant_external_entity_mappings`
  with `integration_type = '3cx'` and `alga_entity_type = 'contact'`.
- (2026-09-15) Contact creation from the 3CX client creates the contact
  immediately (3CX waits for a `ContactUrl`). Client attachment: exact
  case-insensitive `client_name` match attaches at once; otherwise the contact
  is created without a client and queued for mapping on the card with the
  best fuzzy suggestion preselected. Same table as above, `alga_entity_type =
  'contact'`, `metadata.mapping = 'unmapped' | 'mapped'`.
- (2026-09-15) PBX credentials (FQDN, client id, client secret) are entered on
  the card. The secret goes through the tenant secret provider
  (`getSecretProviderInstance().setTenantSecret`), referenced from
  `telephony_providers.config.pbx.clientSecretRef`, never stored inline. This
  is the Teams pattern (`microsoft_profiles.client_secret_ref`); the existing
  `webhook_secret` column keeps holding the CRM template key.
- (2026-09-15) `providerCallId` hash inputs stay `agentEmail|number|callType|startTimeUtc`
  but `startTimeUtc` is truncated to whole seconds on every path (template,
  CDR backfill, Call Control) so the three sources collapse onto one ledger
  row. Nothing shipped yet, so the hash change is free.
- (2026-09-15) The Call Control WebSocket consumer runs as a long-lived
  Temporal workflow per tenant (`threecxCallControlWorkflow`), not inside the
  Next.js server. Reason: there is no precedent for a singleton socket holder
  in `initializeApp`, multiple server replicas would each connect, and
  `pg_try_advisory_xact_lock` does not outlive a transaction. Temporal gives
  one execution per tenant (workflow id `threecx-callcontrol:<tenant>`),
  restarts and heartbeats for free. Events are forwarded to the server through
  the existing `MAINTENANCE_JOB_REQUESTED` hand-off as job
  `process-threecx-call-event`.

## Discoveries / Constraints

- (2026-09-15) Realtime to the browser: only channel is Redis pub/sub
  `${prefix}internal-notifications:<tenant>:<userId>` →
  `hocuspocus/NotificationExtension.js` → Yjs room
  `notifications:<tenant>:<userId>` → `useInternalNotifications`
  (`packages/notifications/src/hooks/useInternalNotifications.ts`). Toasts:
  `useToast` from `packages/ui/src/hooks/use-toast.ts`; `ThemedToaster` is
  mounted in `server/src/app/layout.tsx`.
- (2026-09-15) Non-`withAuth` notification helper:
  `createNotificationFromTemplateInternal(knex, request)` in
  `packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts:88`.
- (2026-09-15) `system_interaction_types` has Call, Email, Meeting, Note,
  General, Online Meeting, `Marketing: *`. No Chat. Chat journaling needs a
  migration adding `Chat` (copy `20260601120100` Online Meeting).
- (2026-09-15) Contacts: `contacts.client_id` is nullable; `email` is required
  and unique per tenant (`EMAIL_EXISTS`). Non-`withAuth` creator:
  `ContactModel.createContact(input, tenant, trx)` in
  `shared/models/contactModel.ts:699`; phones via `replacePhoneNumbers`.
  `CONTACT_CREATED` is published by the action only when `client_id` is set;
  the 3CX route must publish it itself.
- (2026-09-15) Call intents: `createTelephonyCallIntent` in
  `packages/integrations/src/actions/integrations/telephonyActions.ts:158`
  hard-codes `teams-phone` and Microsoft `provider_account_id`;
  `resolvePendingCallIntent` (`ingestCanonicalCall.ts:47`) matches on
  `provider` + `provider_user_id` + `phone_number_e164`, and the value it
  compares against is the canonical record's `organizerUserId`. For 3CX that
  is already the Alga user id (report-call resolves the agent by email), so
  3CX intents store the Alga user id as `provider_user_id`; the extension DN
  is only needed to place the call.
- (2026-09-15) Transcripts: `createCallTranscriptDocument` in
  `packages/telephony/src/lib/callArtifactDocuments.ts` writes a block
  document with `document_associations` for client and contact.
  `telephony_call_artifacts` is never read by UI code;
  `InteractionDetails.tsx:430-495` only renders Teams meeting artifacts.
- (2026-09-15) Recurring EE jobs: add to `MAINTENANCE_FANOUT_SCHEDULES` in
  `ee/temporal-workflows/src/schedules/setupSchedules.ts:474` and to the
  fanout map in `packages/jobs/src/lib/maintenanceJobFanout.ts:93` with a
  `tenants` selector.
- (2026-09-15) Event bus contact events: `CONTACT_CREATED|UPDATED|ARCHIVED|DELETED`,
  `CLIENT_UPDATED`; subscriber pattern `server/src/lib/eventBus/subscribers/searchIndexSubscriber.ts`.
- (2026-09-15) Emulator host: `serve()` (smtp-sink) is the hook for a
  non-HTTP listener. No emulator opens a WebSocket yet; `ws` is only a root
  override floor, so `@alga-psa/emulator-threecx` must declare it.
- (2026-09-15) Generic mapping table `tenant_external_entity_mappings`
  (`20250502173321`): `integration_type`, `alga_entity_type`,
  `alga_entity_id`, `external_entity_id`, `external_realm_id`, `sync_status`,
  `metadata`. Used by qbo, xero, ninjaone, hudu, tacticalrmm.
- (2026-09-15) Local dev: EE always uses Temporal; the `temporal-worker`
  image must be rebuilt after adding job registrations. Sibling worktree dev
  servers on the same Redis steal forwarded jobs (memory:
  shared-redis-consumer-group-worktrees).

## Commands / Runbooks

- Validate the plan files:
  `python3 ~/.claude/skills/software-planner/scripts/validate_plan.py ee/docs/plans/2026-09-15-3cx-enterprise-surfaces`
- Rebuild the local Temporal worker after job changes:
  `docker compose -f docker-compose.yaml -f docker-compose.base.yaml -f docker-compose.ee.yaml build temporal-worker && docker compose -f docker-compose.yaml -f docker-compose.base.yaml -f docker-compose.ee.yaml up -d --no-deps temporal-worker`
- Emulator: `cd packages/emulators/suite && npm run build && npm start`;
  drive with `npx algasim action threecx <action> -p '{...}'`.
- Fetch a 3CX doc for grepping: `curl -sL -A "Mozilla/5.0" <url> -o page.html`

## Links / References

- Call Control API: https://www.3cx.com/docs/call-control-api/ and
  https://www.3cx.com/docs/call-control-api-endpoints/
- Configuration API: https://www.3cx.com/docs/configuration-rest-api/ ,
  https://github.com/3cx/xapi-tutorial
- CRM template XML: https://www.3cx.com/docs/crm-template-xml-description/
- Call Control SDK: https://github.com/3cx/call-control-sdk-ts

## Open Questions

- Whether 3CX AI transcription text is reachable through XAPI on the
  customer's edition, or only the recording file. Decides whether transcripts
  are ingested as text or transcribed on our side.
- Whether one Call Control app can observe every extension or only the DNs
  listed in its configuration. Decides the setup instructions on the card.
- Whether CDR rows expose a stable call id. If yes, prefer it over the hash
  for backfilled rows and store the hash as a secondary key.

## Implementation notes (2026-09-15, first pass)

- `tenant_external_entity_mappings` uses column `tenant` (renamed in
  `20250512094730_standardize_tenant_columns`), not `tenant_id`; rows carry a
  `deleted_at` tombstone (`20260830…`). Reads filter `deleted_at IS NULL`.
- The pending-contact URL is `/msp/settings/integrations?category=communication&threecxPending=<uuid>`
  (middleware 307s the `?tab=integrations` form there). Constant
  `THREECX_PENDING_QUERY_PARAM` in `ee/packages/threecx/src/lib/contacts.ts`.
- Phonebook import stores the fingerprint of the PBX entry as-is so the next
  push PATCHes it into managed form (`Tag=AlgaPSA`); otherwise the adopted
  entry would never be updated. Import does not touch `contacts.updated_at`,
  so the search index only refreshes the phone list on the next contact edit.
- Contact canonical phone types are `work | mobile | home | other` (no
  `business`); the create route stores the 3CX number as `work`.
- The Call Control consumer shares the PBX token through the Redis key
  `alga-psa:threecx:token:<tenant>` (lock `<key>:lock`); the worker
  re-implements the get-or-refresh logic because it cannot import the
  src-consumed EE package.
- `ee/packages/threecx/vitest.config.ts` aliases `@alga-psa/workflow-streams`
  and `@alga-psa/shared/*` to source because the workflow-streams dist is
  not built in the workspace.
- Job names are inlined as strings in `job-activities.ts`, the subscriber and
  the route deps (dist-resolved imports would need a jobs rebuild first);
  `telephonyJobWiring.wiring.test.ts` keeps them in step.
- Component tests: `Button`/`Input` ids come from the UI reflection hook and
  the `Dialog` mounts at document level, so tests query buttons by name and
  dialog fields with `document.querySelector`.
- Lockfile: run `npm install --package-lock-only --ignore-scripts` after
  adding workspace deps (`ws` in the emulator; `redis`, `event-bus`, `shared`,
  `workflow-streams` in ee-threecx).

## Local manual test (2026-09-16)

Verified against the emulator with the Oz tenant: PBX credentials + Test
connection, extension sync (3 auto-mapped, 1 unmapped), incoming-call card
for a matched and an unknown caller, hang-up closing the card, Call via 3CX
(MakeCall recorded on the emulator), contact creation (exact client, unmapped
queue, pending → Complete dialog via deep link), chat journaling (matched →
Chat interaction; unmatched → attribution queue), ReportCall transcript →
document + artifact + summary, CDR backfill (2 segments, idempotent second
run), phonebook push (12 created) and import (1 number adopted).

Fixes made during the test:
- The worker runs in Docker: `localhost:4070` on the card is unreachable from
  it. `rewriteEmulatorHost` in `threecxCallControlSession.ts` maps
  localhost to `host.docker.internal` when `THREECX_EMULATOR_MODE=true`
  (passed into the worker via `docker-compose.ee.yaml` and the root `.env`).
- `interactions` has no `updated_at`; the summary append now updates only
  `notes` (this silently rolled back the whole transcript attach).
- `TelephonyCallsPanel` never loaded chats when the server pre-supplied the
  call overview; chats now load on mount regardless.
- The emulator CRM actions carry `entityId`/`entityType` from the lookup
  into ReportCall and accept `transcription`/`summary`/`recordingUrl`.

Local prerequisites that are easy to miss: a Hocuspocus process on :1234
(`cd hocuspocus && PORT=1234 REDIS_HOST=localhost REDIS_PASSWORD=$(cat ../secrets/redis_password) node server.js`)
or the incoming-call card never renders; no sibling dev server on the shared
Redis; a fresh `npm --prefix packages/telephony run build` after telephony
changes because the jobs dist imports the telephony dist.
- Job handlers are registered once when the dev server boots
  (`registerAllHandlers` from instrumentation). Editing a handler under
  `packages/jobs/src` does not reach the running server through HMR: rebuild
  the jobs dist AND restart the dev server.
