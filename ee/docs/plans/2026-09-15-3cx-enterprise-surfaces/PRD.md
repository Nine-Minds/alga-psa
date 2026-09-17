# PRD — 3CX Enterprise Surfaces

- Slug: `2026-09-15-3cx-enterprise-surfaces`
- Date: `2026-09-15`
- Status: Draft
- Predecessor: [3CX CRM template](../2026-09-02-3cx-crm-template/PRD.md) (shipped on `integrations/3cx_planning`)
- Decision record: [3CX assessment](../2026-08-28-3cx-integration-assessment/ASSESSMENT.md)
- Parent class: [Telephony integration](../2026-08-22-telephony-integration/PRD.md)

## Summary

The CRM-template round made a 3CX PBX recognise callers and journal finished
calls. This round adds everything the predecessor listed as out of scope:

1. **Call Control**: an incoming-call card in the MSP app while the phone
   rings, and click-to-call from any phone number in Alga through the PBX.
2. **Configuration API**: call-history backfill from the PBX call log, and a
   two-way phonebook sync between Alga contacts and the 3CX company phonebook.
3. **CRM template extras**: contact creation from the 3CX client, chat
   journaling, and call transcripts and summaries.

Call Control and the Configuration API exist only on 3CX Enterprise/AI PBXs
with an 8SC+ license. On the Alga side nothing new is tier-gated: every
surface stays under `PBX_TELEPHONY` at `pro`. The card explains which
features need PBX API credentials and shows whether the PBX granted them.
Everything is Enterprise Edition only and reuses the ledger, matcher,
interactions, auto-ticket tail and unmatched queue from the telephony class.

## Problem

Technicians on 3CX Enterprise see the caller's name only inside the 3CX
client. They have to find the contact in Alga by hand, and outbound calls
placed from Alga are not attributed to the ticket they were made from. Call
history that predates the integration, or that the PBX reported while Alga
was unreachable, is missing from the ledger. Contacts and their numbers live
in two places and drift. Chats handled in the 3CX client and the PBX's own AI
transcripts never reach the contact record.

## Goals

- While an extension rings, the technician mapped to it sees a card in Alga
  with the caller, client, open tickets and recent interactions, with one
  click to the contact, the client or a new ticket.
- Every phone number in Alga can place a call through the PBX from the
  technician's own extension, and the resulting call journals against the
  ticket it was placed from.
- Enabling the integration on a PBX with history fills the ledger from the
  PBX call log, and keeps filling it on a schedule, without duplicating what
  the template already reported.
- Contacts with phone numbers appear in the 3CX company phonebook, and
  numbers that only exist in the PBX phonebook flow back onto matching
  contacts. Sync is opt-in and scheduled.
- A contact created in the 3CX client exists in Alga at once, attached to the
  right client or queued for a one-click mapping.
- A chat dealt with in the 3CX client becomes a `Chat` interaction on the
  contact.
- Transcripts and summaries produced by the PBX attach to the call's
  interaction and are visible there.
- The emulator covers every new PBX surface so CI never needs a PBX.

## Non-goals

- Audio streams, DTMF, transfer, divert or drop from Alga. Answer is in
  scope where the PBX grants direct control.
- Personal phonebooks, or creating Alga contacts from the phonebook import.
- Sending SMS or replying to live chats from Alga.
- Transcribing recordings on our side; transcripts come from the PBX.
- Mobile push or browser desktop notifications for the incoming-call card.
- Ring-time screen pop for Teams Phone.
- A new Alga tier gate. Community Edition availability.

## Users and Primary Flows

- **MSP admin**: enters the PBX FQDN, client id and secret on the 3CX card,
  presses Test, syncs extensions, maps the ones that did not auto-match,
  turns on call-history import and phonebook sync, and re-downloads the
  template.
- **Technician**: sees the incoming-call card, opens the contact or ticket,
  dials numbers from Alga, creates contacts and deals with chats in the 3CX
  client, and reads transcripts on interactions.

1. **Ring**: an external call rings extension 101. The Call Control consumer
   sees the participant enter `Ringing`, the server matches the caller and
   pushes a card to the user mapped to 101. When the call connects or ends
   the card closes.
2. **Click-to-call**: on a ticket, the technician clicks the contact's
   number and picks "Call via 3CX". Alga records a call intent and asks the
   PBX to dial from the technician's extension. After hangup the template's
   `report-call` journals the call against the ticket.
3. **Backfill**: the admin enables call-history import. The next hourly run
   reads the PBX call log since the watermark, maps external segments to
   canonical records, skips anything already in the ledger, and journals the
   rest.
4. **Phonebook**: the admin enables sync with a daily schedule. Push creates
   or updates one phonebook entry per active contact with a phone number.
   Import adds numbers from PBX entries that match an existing contact by
   email or name.
5. **Create contact**: from the 3CX client the technician saves an unknown
   caller with name, email, number and company. Alga creates the contact,
   attaches it to the client whose name matches exactly, or lists it on the
   card with the closest client suggested.
6. **Chat**: the technician marks a chat as dealt with. The template posts
   the transcript; Alga journals a `Chat` interaction on the matched
   contact.
7. **Transcript**: the PBX transcribes the recording. The artifact sweep
   fetches the text and summary and attaches them to the interaction.

## UX / UI Notes

### 3CX card (Integrations → Communication → Telephony)

Existing content stays. New sections, each behind the provider being active:

- **PBX API**: base URL, client id, client secret (write-only, "Replace"
  after first save), Test connection, status badge (`Not configured`,
  `Connected`, `Error` with the message), and two capability chips: `Call
  control` and `Configuration API`, each `granted` or `not granted`. Help
  text: which 3CX edition is needed, and that the API app must list every
  extension to monitor.
- **Extensions**: Sync from PBX button, last sync time, a table of
  extension, PBX display name, PBX email, mapped Alga user (auto or manual).
  Unmapped rows are highlighted and get a user picker.
- **Call history import**: toggle, lookback days for the first run (default
  30), last run time, records added last run.
- **Phonebook sync**: toggle, schedule select (`Daily`, `Hourly`), Push now,
  Import now, last push and import times with counts.
- **Contacts created from 3CX**: list of contacts created through the
  client that have no client yet: name, email, company text from 3CX,
  suggested client preselected in a client picker, Apply, and "Leave without
  client" which removes the row.
- The Download template button re-renders the template with the new
  scenarios; the version stamp tells the admin when to re-upload.

### Incoming-call card

- A floating card at the bottom right of the MSP shell, above the toaster,
  not modal, one at a time (a newer ring replaces the older one).
- Header: caller name or "Unknown caller", the number, the client name, the
  extension that is ringing.
- Body for a matched contact: email, up to 5 open tickets for the contact or
  client (number, title, status) as links, the last 3 interactions (type,
  title, date).
- Actions: Open contact, Open client, New ticket (opens the quick-add ticket
  dialog prefilled with client and contact), Dismiss. For an unknown caller:
  Create contact (opens quick-add contact prefilled with the number) and
  Dismiss.
- An Answer button appears when the PBX reports the extension as under
  direct control (uaCSTA). It answers through the Call Control API on the
  technician's own extension; the resulting `connected` event closes the
  card. Extensions without direct control show no button.
- Closes on `connected` or `ended` events, on Dismiss, or after 60 seconds.
- Appears only when the realtime socket is connected. No notification row is
  written; missed calls are journaled by `report-call`.

### Click-to-call

- `CallLink` gains a "Call via 3CX" action beside the existing `tel:` link
  when the tenant's PBX is connected and the current user has a mapped
  extension. Success shows a short toast; failure shows the PBX message.
- Every string goes through `t()` under
  `integrations.telephony.providers.threecx.*` and
  `telephony.incomingCall.*`. Every interactive element carries a kebab-case
  `id`.

## Requirements

### FR1 PBX connection

- `telephony_providers.config` for the `3cx` row gains
  `pbx: { baseUrl, clientId, clientSecretRef, status, lastCheckedAt, lastError, capabilities: { xapi, callControl } }`.
  `status` is `not_configured | connected | error`.
- The client secret is written through the tenant secret provider
  (`getSecretProviderInstance().setTenantSecret`) under the name
  `threecx-pbx-client-secret` and referenced by `clientSecretRef`. It is
  never returned to the browser and never stored in `config`.
- `baseUrl` must be `https://` unless `THREECX_EMULATOR_MODE=true`, which
  also allows `http://` (mirrors `isTeamsEmulatorModeEnabled`).
- `ThreecxPbxClient` in `ee/packages/threecx/src/lib/pbx/` wraps token
  acquisition (`POST /connect/token`, `client_credentials`, form-encoded),
  XAPI calls under `/xapi/v1` and Call Control calls under `/callcontrol`.
- Tokens are cached in Redis under `${prefix}threecx:token:<tenant>` with a
  TTL of `expires_in - 60` seconds and refreshed under a Redis lock, because
  the PBX keeps one live token per app and the server and the Temporal
  worker share it.
- Test connection: acquire a token, `GET /xapi/v1/Defs?$select=Id` sets
  `capabilities.xapi`, `GET /callcontrol` sets `capabilities.callControl`.
  Either failing is recorded per capability; a token failure sets `status:
  'error'` with the PBX message.
- Server actions: `saveThreecxPbxCredentials`, `testThreecxPbxConnection`,
  `clearThreecxPbxCredentials`. All require `canManageTelephony`.

### FR2 Extension map

- `config.extensions: Array<{ dn, pbxDisplayName, pbxEmail, userId: string | null, mappedBy: 'auto' | 'manual' | null }>`
  and `config.extensionsSyncedAt`.
- `syncThreecxExtensions` reads `GET /xapi/v1/Users?$select=Id,Number,FirstName,LastName,EmailAddress,Enabled`
  (paged with `$top`/`$skip`), keeps enabled users, and auto-maps each to
  the tenant user whose email matches case-insensitively. Manual mappings
  survive a re-sync; extensions that vanished from the PBX are removed.
- `setThreecxExtensionUser({ dn, userId | null })` sets a manual mapping.
- Helpers `extensionForUser(config, userId)` and `userForExtension(config, dn)`
  are used by FR3 to FR6.

### FR3 Call Control consumer

- A Temporal workflow `threecxCallControlWorkflow` runs one execution per
  tenant, workflow id `threecx-callcontrol:<tenant>`, on the EE worker.
- A maintenance fanout job `reconcile-threecx-call-control` runs every 5
  minutes for tenants with an active `3cx` row: it starts the workflow when
  `pbx.status = 'connected'` and `capabilities.callControl` is true, and
  signals `stop` otherwise or when the provider is disabled.
- The workflow loops over a long-running activity `consumeThreecxCallControl`
  (heartbeat every 15 s, one hour per run, then `continueAsNew`). The
  activity opens `wss://<pbx>/callcontrol/ws` with the bearer token, and on
  each `Upsert` event does `GET <entity>` on the participant, ignoring
  results whose `sequence` is older than the latest seen. It keeps the
  participant's last status in memory.
- Transitions produce events forwarded to the server as job
  `process-threecx-call-event` through the existing
  `MAINTENANCE_JOB_REQUESTED` hand-off:
  - `status` becomes `Ringing` on an extension present in the extension
    map: `{ kind: 'ringing', dn, participantId, callId, partyCallerId, partyCallerName, partyDid, at }`.
  - `status` becomes `Connected` for a participant that was ringing:
    `{ kind: 'connected', dn, participantId, callId }`.
  - `Remove` for a participant that was ringing or connected:
    `{ kind: 'ended', dn, participantId, callId }`.
- Reconnect with exponential backoff from 5 s to 120 s; a 401 refreshes the
  token first. Repeated failures for 10 minutes write `pbx.lastError` and
  `pbx.status = 'error'`; the reconcile job restarts the workflow when Test
  connection succeeds again.
- Call Control events never write the ledger. `report-call` and the CDR
  backfill remain the sources of `telephony_call_records`.

### FR4 Incoming-call card

- Handler `process-threecx-call-event` (registered in
  `server/src/lib/jobs/registerAllHandlers.ts`, EE-gated like the other
  telephony handlers): resolves the user through `userForExtension`; drops
  the event when no user is mapped. For `ringing` it normalizes
  `partyCallerId`, runs `matchCallParty`, loads the matched contact and
  client, up to 5 open tickets for the contact (else client) ordered by
  update time, and the last 3 interactions for the contact. It publishes on
  the user's Redis channel `${prefix}internal-notifications:<tenant>:<userId>`
  a message `{ type: 'telephony.incoming_call', event: 'ringing' | 'connected' | 'ended', call: {...} }`.
- `hocuspocus/NotificationExtension.js` relays `telephony.incoming_call`
  messages into the room's Yjs map `incomingCall` (`{ event, call, receivedAt }`).
- `useInternalNotifications` exposes `incomingCall` and a `dismissIncomingCall`
  that clears the local state. `IncomingCallProvider` in
  `server/src/components/layout/` mounts beside `MspCallLinkProvider` and
  renders `IncomingCallCard` from `packages/telephony/src/components/`.
- The card behaves as described under UX. The New ticket action opens the
  existing quick-add ticket dialog with client and contact prefilled; Create
  contact opens quick-add contact with the number prefilled.

### FR5 Click-to-call

- `getTelephonyCallLinkState` returns `threecx: { connected: boolean, extension: string | null }`
  for the current user. `CallLinkProvider` carries it; `CallLink` renders the
  "Call via 3CX" action when `connected` and `extension` are set.
- `createTelephonyCallIntent` becomes provider-aware:
  `{ provider: 'teams-phone' | '3cx', ticketId, phoneNumber }`. For `3cx`
  `provider_user_id` is the caller's extension DN. `resolvePendingCallIntent`
  is unchanged; the `report-call` mapping already passes `provider: '3cx'`
  and now passes the agent's DN as `providerUserId` resolved from the
  extension map by agent email (falling back to `agentExtension` from the
  body).
- `placeThreecxCall({ phoneNumber, ticketId?, contactId?, clientId? })`
  (withAuth, non-portal, `interaction:create`): records the intent when a
  ticket id is given, then calls `POST /xapi/v1/Users/Pbx.MakeCall` with
  `{ dn: <extension>, destination: <E.164 digits> }`. Returns
  `{ success, message? }`. PBX errors are returned as the message; the
  intent is left to expire.

### FR6 Call-history backfill

- `config.cdr: { enabled, lookbackDays, watermark, lastRunAt, lastRunAdded }`.
- Maintenance fanout job `backfill-threecx-cdr` runs hourly for tenants with
  `cdr.enabled`, `pbx.status = 'connected'` and `capabilities.xapi`. The
  first run uses `now - lookbackDays`; later runs use `watermark`.
- Source: `GET /xapi/v1/CallHistoryView?$filter=SegmentStartTime ge <from>&$orderby=SegmentStartTime asc&$top=200&$skip=N`.
  Segments where neither party is external are skipped.
- Mapping to `CanonicalCallRecord`: `direction` is `inbound` when the source
  is external, `outbound` when the destination is external, `missed` for an
  unanswered inbound segment; the external party's number is the caller or
  callee; the internal DN maps to the agent through the extension map, which
  gives `organizerUserId` and the agent email for the hash;
  `startedAt = SegmentStartTime`, `endedAt = SegmentEndTime`,
  `durationSeconds` from `CallTime`; `raw` carries the segment including
  `SegmentId`.
- `providerCallId` uses the shared hash `agentEmail|numberE164|callType|startTimeUtc`
  with the start time truncated to whole seconds. The same truncation is
  applied in `report-call`, so a call reported by the template and later seen
  in the log collapses onto one row.
- Before enqueueing, a segment is skipped when a `3cx` record exists with the
  same hash, or with the same `organizer_user_id`, same E.164 number and
  `started_at` within 60 seconds. Survivors are enqueued as
  `process-telephony-canonical-call`.
- The watermark advances to the last processed `SegmentStartTime` minus 5
  minutes.

### FR7 Phonebook sync

- `config.phonebook: { enabled, schedule: 'daily' | 'hourly', lastPushAt, lastImportAt, lastPushCounts, lastImportCounts, lastError }`.
- Mapping rows in `tenant_external_entity_mappings`: `integration_type =
  '3cx'`, `alga_entity_type = 'contact'`, `alga_entity_id = contact_name_id`,
  `external_entity_id = <3CX Contact Id>`, `external_realm_id = pbx.baseUrl`,
  `metadata = { fingerprint }`.
- **Push** (`pushThreecxPhonebook`): for each active contact with at least
  one phone number, build a `Pbx.Contact`: `FirstName`/`LastName` from
  `full_name` split, `CompanyName` from the client, `Email`, `PhoneNumber`
  from the default number, `Business`, `Business2`, `Mobile2`, `Home`,
  `Other` from the remaining numbers by canonical type, `Tag = 'AlgaPSA'`.
  No mapping row: `POST /xapi/v1/Contacts`, store the mapping. Mapping with
  a different fingerprint: `PATCH /xapi/v1/Contacts(<id>)`. Contacts that are
  inactive or gone but still mapped: `DELETE`, remove the mapping. A 404 on
  PATCH or DELETE drops the mapping and, for PATCH, recreates.
- **Import** (`importThreecxPhonebook`): page `GET /xapi/v1/Contacts` with
  `$top=200`; skip entries that have a mapping row or `Tag = 'AlgaPSA'`. Match
  by `Email` case-insensitively, else by `FirstName + LastName` against
  `full_name` case-insensitively when exactly one contact matches. Add each
  phone field that is not already on the contact (compared by normalized
  digits) with the canonical type implied by the field. Never create
  contacts, never remove numbers. Record a mapping row so later pushes
  update that entry instead of creating a duplicate.
- Event-driven push while enabled: a subscriber on `CONTACT_CREATED`,
  `CONTACT_UPDATED`, `CONTACT_ARCHIVED`, `CONTACT_DELETED` enqueues
  `sync-threecx-phonebook-contact { tenantId, contactId }` for tenants with
  sync enabled and the PBX connected.
- Scheduled reconcile: maintenance fanout job `reconcile-threecx-phonebook`
  runs hourly; a tenant runs when `hourly`, or when `daily` and more than 23
  hours have passed since `lastPushAt`. A run is push then import.
- Card actions `setThreecxPhonebookSync`, `runThreecxPhonebookPush`,
  `runThreecxPhonebookImport`.

### FR8 Contact creation from the 3CX client

- Template scenario `CreateContactRecordFromClient` posts
  `{ firstName, lastName, number, email, company }` (from `[FirstName]`,
  `[LastName]`, `[Number]`, `[Email]`, `[Company]`) to
  `POST /api/telephony/3cx/[tenantSlug]/contacts`, guarded like the other
  routes.
- Client: exact case-insensitive `client_name` match attaches the contact;
  otherwise `client_id` is null and `suggestedClientId` is the best
  `client_name ILIKE '%company%'` match, if any.
- **With an email**: the contact is created with `ContactModel.createContact`
  inside a transaction, the number as the default phone (type business),
  then `CONTACT_CREATED` is published. A duplicate email answers 200 with the
  existing contact so the client opens it. When no client matched, a row is
  written to `tenant_external_entity_mappings` with
  `alga_entity_type = 'contact-origin'`, `alga_entity_id = contact_name_id`,
  `external_entity_id = 'crm-create'`, `external_realm_id = contact_name_id`
  and `metadata = { companyName, suggestedClientId, status: 'unmapped' }`.
  Response is the lookup shape with one contact, including `entityId` and
  `entityType`.
- **Without an email**: the contact model requires one, so nothing is
  created yet. A pending row is written with
  `alga_entity_type = 'contact-pending'`, `alga_entity_id = <new uuid>`,
  `external_entity_id = 'crm-create'`, `external_realm_id = <that uuid>` and
  `metadata = { firstName, lastName, number, company, suggestedClientId, status: 'pending' }`.
  The response is the lookup shape with `contactUrl` pointing at the
  integrations settings page with `?threecxPending=<uuid>`, which opens the
  Complete contact dialog, and `entityType = 'pending'`.
- Card section **Contacts created from 3CX** lists both kinds. An unmapped
  row shows name, email, company text, a client picker with the suggestion
  preselected, Apply, and "Leave without client". A pending row shows
  "Complete" which opens a dialog with name and number editable, email
  required, and the client picker with the suggestion preselected; saving
  creates the contact as above and deletes the pending row. The dialog also
  opens automatically when the page is loaded with `?threecxPending=<uuid>`.
- Card actions: `listThreecxContactQueue`,
  `mapThreecxContactToClient({ contactId, clientId | null })`,
  `completeThreecxPendingContact({ pendingId, firstName, lastName, email, number, clientId | null })`,
  `dismissThreecxPendingContact({ pendingId })`.

### FR9 Chat journaling

- Migration adds `Chat` to `system_interaction_types`, following the
  `Online Meeting` migration.
- Template scenario `ReportChat` posts
  `{ number, email, name, agentEmail, queueExtension, durationSeconds, startTimeUtc, endTimeUtc, messages, entityId, entityType }`
  to `POST /api/telephony/3cx/[tenantSlug]/report-chat`.
- Migration creates `telephony_chat_records`, distributed on `tenant` like
  `telephony_call_records`: `tenant`, `chat_record_id`, `provider`,
  `provider_chat_id` (unique with tenant and provider), `agent_user_id`,
  `party_number_raw`, `party_number_e164`, `party_email`, `party_name`,
  `queue_extension`, `started_at`, `ended_at`, `duration_seconds`,
  `messages` (text), `match_status` (`matched | unmatched | ambiguous`),
  `matched_contact_id`, `matched_client_id`, `match_candidates`,
  `interaction_id`, `raw`, timestamps. No RLS policies.
- The route validates, mints `providerChatId` as SHA-256 of
  `agentEmail|number|email|startTimeUtc` (seconds), enqueues
  `process-threecx-chat` and answers 202.
- The handler `ingestChat` inserts the record idempotently on
  `(tenant, provider, provider_chat_id)`; a repeat creates nothing. It
  resolves the contact: `entityId` when `entityType = 'contact'` and the
  contact exists; else email (case-insensitive); else number through
  `matchCallParty`. With a contact it creates a `Chat` interaction through
  `interactionCreateHelper` with title `Chat with <name>`, `notes =
  messages`, `start_time`, `end_time`, `duration`, `user_id` from the agent
  email (fallback as `ingestCanonicalCall` does), `contact_name_id`,
  `client_id`, and stores `interaction_id` on the record. Without a contact
  the record stays `unmatched` (or `ambiguous` with candidates).
- The "Calls needing attribution" panel (`TelephonyCallsPanel`) also lists
  unmatched and ambiguous chats, marked as chats, with the same assign
  picker. `resolveTelephonyChat({ chatRecordId, contactId, clientId })`
  stamps the match and creates the `Chat` interaction, mirroring
  `resolveCallMatch`.

### FR10 Transcripts and summaries

- The template's `ReportCall` request adds `transcription`, `summary` and
  `recordingUrl` from `[Transcription]`, `[Summary]`, `[RecordingUrl]`;
  `report-call` accepts them as optional strings and stores them in `raw`.
- `processTelephonyCanonicalCall`, after ingestion with status `ingested`
  and a non-empty `raw.transcription`, creates a transcript document with
  `createCallTranscriptDocument` associated to the contact, the client and
  the interaction, writes a `telephony_call_artifacts` row
  (`artifact_type = 'transcript'`, `provider_artifact_id = 'report-call'`,
  `document_id`), appends the summary to the interaction notes, and sets
  `artifact_status = 'ready'`.
- Records without a transcript stay `artifact_status = 'pending'`. The
  existing `sweep-telephony-call-artifacts` job gains a `3cx` fetcher: for
  tenants with `capabilities.xapi`, query
  `GET /xapi/v1/Recordings?$filter=StartTime ge <started_at - 2m> and StartTime le <started_at + 2m>`,
  pick the recording whose external number matches the record, and when
  `IsTranscribed` create the transcript document and artifact row as above;
  when `RecordingUrl` is set download through
  `GET /xapi/v1/Recordings/Pbx.DownloadRecording(recId=<Id>)`, upload with
  `StorageService.uploadFile` and write a `recording` artifact with
  `file_id`. Backoff and `none` settlement follow `captureCallArtifacts`.
- `InteractionDetails` renders call artifacts for interactions referenced by
  a `telephony_call_records.interaction_id`: transcript link, recording link
  and the summary. This reads `telephony_call_artifacts` and benefits Teams
  Phone too.

### FR11 Entity pass-through

- `lookup`, `lookup-by-email` and `search` responses add `entityId`
  (contact id or client id) and `entityType` (`contact` | `client`). The
  template maps them to `EntityId` and `EntityType`, and `ReportCall` and
  `ReportChat` send them back as `entityId` and `entityType`.
- `report-call` passes `entityId`/`entityType` into the canonical record's
  `raw`; the handler passes a `preferredContactId` to `ingestCanonicalCall`,
  which uses it as the match when the contact exists and is active,
  otherwise falls back to number matching.

### FR12 Template

- `renderThreecxTemplate` adds the `CreateContactRecordFromClient` and
  `ReportChat` scenarios, the `EntityId`/`EntityType` outputs on the lookups,
  and the transcript fields on `ReportCall`. `THREECX_TEMPLATE_VERSION`
  increments. The validator test covers every new URL, variable and output.

### FR13 Emulator

`packages/emulators/threecx` switches from `wire()` to `serve()` so it can
own an HTTP and WebSocket listener on 4070, keeping the existing CRM-engine
client actions.

- HTTP: `POST /connect/token` (checks `client_id`/`client_secret` against
  the seeded app), `GET /xapi/v1/Defs`, `GET /xapi/v1/Users` (with `$top`,
  `$skip`, `$select`), `GET|POST /xapi/v1/Contacts`,
  `GET|PATCH|DELETE /xapi/v1/Contacts(<id>)`,
  `POST /xapi/v1/Contacts/Pbx.DeleteContactsById`,
  `GET /xapi/v1/CallHistoryView` (with `$filter` on `SegmentStartTime`,
  `$orderby`, `$top`, `$skip`), `GET /xapi/v1/Recordings` (with `$filter` on
  `StartTime`), `GET /xapi/v1/Recordings/Pbx.DownloadRecording(recId=<n>)`,
  `POST /xapi/v1/Users/Pbx.MakeCall`, `GET /callcontrol`,
  `GET /callcontrol/:dn/participants/:id`, `POST /callcontrol/:dn/makecall`.
  Every request except the token endpoint requires the bearer token.
- WebSocket `/callcontrol/ws`: bearer in the handshake header; pushes
  `{ sequence, event: { event_type, entity, attached_data } }`.
- Seeds: `pbx-app { clientId, clientSecret, callControl, xapi }`,
  `pbx-user { dn, email, firstName, lastName }`, `pbx-contact {...}`,
  `cdr-segment {...}`, `recording { ..., transcription, summary }`.
- Actions: `pbx-ring { dn, callerNumber, callerName }` creates a participant
  in `Ringing` and pushes an Upsert; `pbx-answer { participantId }` moves it
  to `Connected`; `pbx-hangup { participantId }` pushes a Remove;
  `crm-create-contact {...}` and `crm-report-chat {...}` drive the two new
  template scenarios against Alga like `crm-inbound-call` does.
- State views: `pbx-contacts`, `makecalls`, `participants`, `tokens`, plus
  the existing `exchanges`.
- Faults: `token-invalid` (token endpoint answers 401), `ws-drop` (closes
  every socket once).
- `@alga-psa/emulator-threecx` declares `ws` as a dependency.

### Non-functional Requirements

- Every query carries `tenant` in `WHERE` and `JOIN` conditions, including
  the existing `primaryNumberE164` in `lookup.ts`, which is fixed in this
  round.
- PBX-originated routes keep answering within the PBX timeout: validate,
  enqueue, respond.
- The CE build compiles with the EE package aliased away; the new Temporal
  workflow and handlers are EE-gated like the existing telephony ones.
- Existing telephony, Teams and 3CX tests stay green.

## Data / API / Integrations

- Two migrations: the `Chat` system interaction type, and
  `telephony_chat_records`.
- Everything else lives in `telephony_providers.config` (`pbx`,
  `extensions`, `cdr`, `phonebook`), `tenant_external_entity_mappings`
  (`integration_type '3cx'`, entity types `contact`, `contact-origin`,
  `contact-pending`), `telephony_call_records`, `telephony_call_intents`,
  `telephony_call_artifacts`, `documents` and `interactions`.
- New jobs: `process-threecx-call-event`, `process-threecx-chat`,
  `sync-threecx-phonebook-contact` (server-side handlers, forwarded by the
  worker), `reconcile-threecx-call-control`, `backfill-threecx-cdr`,
  `reconcile-threecx-phonebook` (maintenance fanout, worker-scheduled), and
  the `3cx` fetcher inside `sweep-telephony-call-artifacts`.
- New Temporal workflow `threecxCallControlWorkflow` and activity
  `consumeThreecxCallControl` in `ee/temporal-workflows`.
- New routes: `POST /api/telephony/3cx/[tenantSlug]/contacts`,
  `POST /api/telephony/3cx/[tenantSlug]/report-chat`.
- Locale keys land in all ten `msp/integrations.json` files and, for the
  incoming-call card, the `msp/telephony.json` files (or the file that holds
  the unmatched-queue strings).

## Security / Permissions

- Card actions require `canManageTelephony`. `placeThreecxCall` requires a
  non-portal user with `interaction:create`; the call is always placed from
  the caller's own mapped extension, never from an arbitrary DN.
- The incoming-call card is published only to the user mapped to the ringing
  extension. Ticket and interaction details in the payload are limited to
  what that user could read.
- The PBX client secret is stored through the tenant secret provider; the
  token cache holds only the bearer token with its TTL.
- PBX-originated routes keep the bearer key, slug resolution, rate limit and
  gate order from the predecessor.

## Rollout / Migration

- Deploy behind the same `release-v1-6-feature` card flag. Tenants without
  PBX credentials see the new sections but nothing runs.
- Re-download and re-upload the template after deploy; the version stamp
  flags this on the card.
- The Temporal worker image must include the new workflow and job
  registrations before the reconcile job starts anything.
- Local verification runs against the emulator: the runbook in the
  scratchpad covers ring, click-to-call, backfill, phonebook, contact create,
  chat and transcript.

## Open Questions

- Whether `POST /xapi/v1/Users/Pbx.MakeCall` dials from any extension or only
  from DNs monitored by the API app. If the latter, fall back to
  `POST /callcontrol/<dn>/makecall`. Decided on the first Enterprise PBX.
- The exact line format of `[ChatMessages]`; the interaction stores it
  verbatim until known.
- Whether the API app can observe every extension or only listed ones; the
  card help text assumes listed ones.

## Acceptance Criteria (Definition of Done)

- With the emulator's PBX app seeded and credentials saved on the card, Test
  connection reports `Connected` with both capabilities granted, and
  Extensions sync maps a seeded user to the Alga user with the same email.
- `pbx-ring` for a mapped extension shows the incoming-call card in the
  browser within 2 seconds, with the matched contact, client, open tickets
  and interactions; `pbx-hangup` closes it. An unknown number shows the
  unknown-caller card.
- "Call via 3CX" on a ticket records a `telephony_call_intents` row with
  `provider = '3cx'` and the caller's DN, and the emulator's `makecalls` view
  shows the request. A following `crm-outbound-call` journals the call
  against that ticket.
- With `cdr-segment` seeds and call-history import enabled, one run adds one
  ledger row per external segment, skips a segment already reported through
  `report-call`, and a second run adds nothing.
- Phonebook push creates one PBX entry per active contact with a phone and
  updates it when the contact changes; import adds a seeded PBX number to
  the matching contact and creates no contact. Daily schedule runs at most
  once per 23 hours.
- `crm-create-contact` with an email creates the contact, attaches it when
  the company matches a client exactly, otherwise lists it on the card with
  the closest client suggested; Apply attaches it. Without an email it lists
  a pending entry whose Complete dialog creates the contact once an email
  is entered, and the returned `contactUrl` opens that dialog.
- `crm-report-chat` creates a `Chat` interaction on the matched contact with
  the transcript in notes; a repeat creates nothing; an unmatched chat
  appears in the attribution panel and resolving it creates the interaction.
- A `report-call` with a transcription creates a transcript document and
  artifact visible on the interaction; the artifact sweep does the same from
  a seeded recording with `IsTranscribed`, and stores the recording file.
- The template validator passes with the two new scenarios and the entity
  outputs; CE answers 501 on the new routes; every locale file passes the
  locale quality gates; existing telephony tests stay green.
