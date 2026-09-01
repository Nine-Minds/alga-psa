# Telephony Integration Class — PRD

Status: draft for review · Owner: Natallia · Plan folder: `ee/docs/plans/2026-08-22-telephony-integration/`

## Problem & Value

MSP technicians live on the phone, but calls are invisible to the PSA: no caller
recognition, no call history on the client record, no path from a call to a
ticket, and no transcript capture. Customers have asked for telephony
(Twilio and Ringotel were both mentioned); we also have an installed base of
Microsoft-connected tenants for whom Teams Phone needs zero new vendor
onboarding.

This plan introduces **telephony as an integration class**: a vendor-neutral
call core with per-provider adapters, starting with **Teams Phone**. The prime
user journey, in the customer's own priority order:

> **incoming caller → contact/company recognition → call interaction history →
> create/link ticket → transcript → (future) AI**

## Goals

1. Calls become first-class PSA records: every captured call lands as an
   **interaction** (existing `interactions` table, system type `Call`) with
   direction, duration, timestamps, and matched contact/client.
2. Caller recognition: match calling numbers to contacts
   (`contact_phone_numbers.normalized_phone_number`) and clients
   (`clients.phone`), with a defined ambiguity/unmatched policy.
3. Ticket flow: link a call interaction to an existing ticket, or create a
   ticket from a call (board/status/priority defaults reusing the established
   defaults pattern).
4. Settings IA: Integrations → Communication becomes a sub-navigated area —
   **Microsoft Teams** (existing settings unchanged) and **Telephony** (new
   provider-card grid, Accounting-tab pattern), with Teams Phone as the first
   provider card.
5. Teams Phone adapter: Graph `communications/callRecords` change-notification
   subscription (reusing the meeting-artifact subscription/webhook/clientState/
   renewal machinery), CDR fetch and mapping into the core.
6. Click-to-call: `tel:` and Teams deep links from contact and ticket views.
7. Emulator: the msgraph emulator gains a callRecords surface (seeder →
   change notification → CDR fetch) so the whole loop is locally testable, plus
   a usability round addressing the pain found during the Teams work.
8. Transcripts (phase 2 of this plan): call recordings/transcripts captured via
   the existing artifact pipeline and summarized onto the linked ticket with
   the already-shipped transcript→AI seam.

## Non-Goals

- **Live screen-pop / ring-time CTI.** Graph has no "phone is ringing" webhook;
  callRecords arrive after the call ends. Real-time is explicitly deferred to a
  future Twilio/Ringotel adapter (their webhooks fire at ring time). The UI must
  never promise real-time behavior in v1.
- Twilio and Ringotel adapters (design-constrained now, built later).
- Outbound dialing infrastructure, IVR, call routing, E911 — we journal calls,
  we are not a phone system.
- AI beyond the existing transcript-summary seam (deeper AI is "future").
- Emulator OIDC sign-in surface (separately parked task).

## Personas & Primary Flows

- **Technician**: sees a client's/contact's call history on their timeline;
  opens a call interaction; links it to the ticket they're working, or creates
  a ticket from it; clicks-to-call from the contact or ticket.
- **Dispatcher**: reviews recent unmatched calls, resolves them to
  contacts/clients, converts to tickets.
- **Admin**: enables the Telephony provider in Settings → Integrations →
  Communication → Telephony; runs the Teams Phone wizard (permission probe incl.
  `CallRecords.Read.All`); sets the unmatched-call and auto-ticket policy.

### Flow 1 — Inbound call journaling (core journey)
1. Call ends in Teams Phone; Graph emits a callRecords change notification.
2. Webhook validates clientState → enqueues processing (runner seam, Temporal on EE).
3. Adapter fetches the CDR, maps to the canonical call model.
4. Core dedupes by provider ref, normalizes numbers to E.164, runs the match
   ladder (contact → client → unmatched), creates the `Call` interaction
   (contact_name_id/client_id/ticket_id?, start/end/duration, direction+number in
   metadata/notes, title like "Inbound call from +1…").
5. Interaction appears on client/contact timelines immediately (existing UI).

### Flow 2 — Ticket create/link
- From a call interaction: "Link to ticket…" (picker) or "Create ticket" —
  title prefilled from call, client/contact attribution carried over, defaults
  via the board/status/priority defaults resolver; interaction.ticket_id set.
- Optional per-tenant policy: auto-create for matched calls (off by default).

### Flow 3 — Transcript (phase 2)
- Where a call has a recording/transcript exposed by the provider, capture via
  the artifact pipeline (documents/files) and post the AI summary as an internal
  comment on the linked ticket (existing `annotateLinkedTicketFromTranscript`
  seam generalized from meetings to calls).

## Architecture

### Layering
- **Core (vendor-neutral)** — new `packages/`-level module (working name
  `@alga-psa/telephony` or a `telephony/` area in an existing vertical):
  canonical `CanonicalCallRecord` type, E.164 normalization, match ladder,
  idempotent ingestion → interaction creation. No provider imports.
- **Adapters** — Teams Phone first (`ee/packages/microsoft-teams` — it owns the
  Graph auth/subscription machinery). Later Twilio/Ringotel as siblings.
- **Storage** — new table `telephony_call_records` (tenant-distributed, tenant
  in PK per Citus rules): provider, provider_call_id (dedupe key), raw payload
  jsonb, direction, caller/callee E.164, start/end/duration, match outcome,
  interaction_id FK-by-convention. Interactions stay the user-facing record;
  this table is the ingestion ledger + reprocessing source.

### Canonical call model (v1 fields)
`provider`, `providerCallId`, `direction` (inbound|outbound|missed),
`callerNumber`, `calleeNumber` (E.164 + raw), `organizerUserId?` (provider-side
user), `startedAt`, `endedAt`, `durationSeconds`, `modality` (audio|video),
`raw` (provider payload).

### Matching ladder (per call, tenant-scoped)
1. `contact_phone_numbers.normalized_phone_number` exact E.164 → contact (+ its
   client).
2. `clients.phone` normalized → client only.
3. Unmatched → recorded with `match_status='unmatched'`; visible in a
   "recent unmatched calls" list on the Telephony settings/overview surface.
Ambiguity (same number on N contacts): pick none automatically; store the
candidate set; flag `match_status='ambiguous'` for manual resolve.

### Teams Phone specifics
- Subscription resource `communications/callRecords`, TTL/renewal/secret exactly
  mirroring `renewTeamsMeetingArtifactSubscriptions` (same table pattern —
  columns on a new `telephony_providers` config row or reuse
  `teams_integrations` columns; decision: new `telephony_providers` table so
  Twilio/Ringotel rows are first-class later).
- Webhook route `/api/telephony/webhooks/teams-calls` (allowlisted like
  `/api/teams/webhooks/`), clientState-validated, enqueue via runner seam.
- CDR fetch `GET /communications/callRecords/{id}?$expand=sessions` app-token.
- Permission probe row: `CallRecords.Read.All` added to the Teams wizard probe.
- Click-to-call: `tel:` links always; Teams deep link
  (`https://teams.microsoft.com/l/call/0/0?users=…`) when Teams integration
  active.

### Gating
- Telephony ships inside the existing `teams` add-on — no separate key. Teams
  Phone additionally requires an active Teams-capable Microsoft profile. UI and
  webhook/ingest paths all gate on that add-on (deny-by-default).

### Emulator
- msgraph emulator: `call-record` seeder (direction, numbers, duration,
  organizer) → stores CDR + pushes change notification to
  `communications/callRecords` subscriptions; vendor routes
  `GET /v1.0/communications/callRecords/:id` (+ `$expand=sessions` shape);
  state view `call-records`; faults reuse `operation-fault`.
- Usability round (from real friction during the Teams work):
  1. **State persistence** — `--state-file` snapshot/restore so container
     restarts don't wipe seeds (top pain).
  2. **Default actor** — configure a default `fromAadObjectId`/conversation so
     bot-activity seeds don't repeat identity boilerplate.
  3. **Seed presets** — console: save/load named seed payloads.
  4. **Adaptive Card preview** — console renders card JSON locally (vendored
     renderer; CSP-safe, no CDN).
  5. **Fault prefix matching** — `operation-fault` accepts `prefix:` operations
     so reply-path activity ids can be targeted.
  6. **Scenario record** — record control calls into a replayable scenario YAML.

## Data / Migration Notes

- One CE migration: `telephony_call_records` + `telephony_providers`
  (greenfield-Citus pattern: tenant uuid first, tenant in PK, distribute inline;
  no RLS). No changes to `interactions` schema (fields suffice: type_id →
  system `Call`, duration, start/end, notes, client/contact/ticket ids).
- Migration shim rule: use `./utils/tenantDb.cjs`, never `@alga-psa/db`.
- Existing `contact_phone_numbers.normalized_phone_number` is the match key;
  backfill/normalization audit of existing rows is part of the matcher group.

## UX Notes

- Integrations → Communication: left sub-nav (or segmented control) —
  "Microsoft Teams" | "Telephony". Telephony renders provider cards
  (Teams Phone: Configure/Active states) + an overview strip: recent calls,
  unmatched count.
- Call interaction rendering: direction icon, number, duration; actions:
  Link to ticket, Create ticket, Open contact/client.
- All new strings via `t()` with defaultValue; 7-locale parity in the i18n
  group.
- Reflection ids (kebab-case) on all new interactive elements.

## Risks & Open Questions

1. **Post-call latency**: Graph callRecords can lag minutes after call end —
   set expectations in UI copy ("call history", not "live calls").
2. **1:1 call recordings/transcripts via Graph**: availability differs from
   meetings (`getAllRecordings` is meetings-scoped); phase-2 spike must verify
   what Teams Phone exposes for call recording artifacts before committing UI.
3. **Number hygiene**: existing contact numbers may normalize poorly; matcher
   ships with a normalization audit query + unmatched surface as the safety net.
4. **Same-number ambiguity** across clients (shared switchboards): resolved
   manually via the unmatched/ambiguous queue in v1.
5. **Add-on/licensing**: telephony is packaged inside the `teams` add-on, so it
   needs no Stripe product of its own.
6. Graph subscription volume: one subscription per tenant covers all users'
   calls (org-wide resource) — verify quota behavior on large tenants.

## Acceptance Criteria (Definition of Done, v1 = phases 1–3)

- With telephony enabled on a tenant and Teams Phone configured, an emulator-
  seeded inbound call produces, without manual steps: a `telephony_call_records`
  row, a `Call` interaction attributed to the matched contact+client, visible on
  their timelines, within one processing cycle; duplicate notifications do not
  duplicate interactions.
- Unmatched and ambiguous calls appear in the unmatched queue and can be
  manually resolved to a contact/client (which stamps the interaction).
- From a call interaction, a technician can link an existing ticket or create a
  ticket with correct attribution and tenant defaults.
- The Teams wizard probe reports `CallRecords.Read.All`; subscriptions renew via
  the existing maintenance schedule; webhook rejects bad clientState.
- Settings IA ships with Teams settings functionally unchanged under the new
  sub-nav; telephony UI fully gated on the Microsoft Teams add-on.
- Emulator: the full loop (seed call → notification → ingest → interaction) runs
  locally; emulator state survives a container restart via the state file; all
  suite tests green.
- Phase 2 (transcripts): a seeded call transcript lands as a document artifact
  and, when a ticket is linked and AI is available, as an internal summary
  comment (same behavior contract as meetings today).

## Phasing (maps to commitGroups)

1. `addon-gating`, `settings-ia` — class scaffolding + IA split
2. `call-schema`, `number-matching`, `call-ingestion` — core
3. `teams-config`, `teams-subscription`, `teams-cdr` — Teams Phone adapter
4. `ticket-linkage`, `click-to-call` — ticket flow + affordances
5. `emulator-callrecords`, `emulator-usability` — test bench
6. `call-transcripts` — phase-2 artifacts + AI summary reuse
7. `i18n`, `regression` — polish + suite health
