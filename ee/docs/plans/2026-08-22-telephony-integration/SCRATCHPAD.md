# Telephony Plan — Scratchpad

## Decisions
- **Calls live in `interactions`** (user decision 2026-08-22). Schema already fits:
  type_id (system type `Call` EXISTS in system_interaction_types), contact_name_id,
  client_id, ticket_id, duration (int), start_time/end_time, notes, status_id.
  No interactions schema change needed for v1.
- Vendor-neutral core + adapters; Teams Phone first (rides existing Microsoft
  profile/auth/subscription machinery). Twilio/Ringotel later — they bring
  ring-time webhooks (real screen-pop), which Graph cannot do.
- New `telephony` add-on key, pro floor (never solo — standing policy).
- New tables `telephony_providers` + `telephony_call_records` (ingestion ledger;
  interactions remain the user-facing record). Greenfield-Citus pattern.
- Unmatched/ambiguous calls do NOT create interactions until resolved.
- v1 is explicitly post-call journaling, not live CTI (Graph callRecords arrive
  after call end, sometimes minutes).

## Ground truth corrections (verified against server_mc9, 2026-08-22)
- `contact_phone_numbers.normalized_phone_number` is a GENERATED digits-only
  column (`regexp_replace(phone_number,'[^0-9]+','','g')`) — NOT E.164. The
  matcher therefore compares digit candidates (with and without country code).
- There is **no `clients.phone`**. The client-level number lives on
  `client_locations.phone`, so ladder step 2 reads that (digits derived in SQL).
- `interactions.user_id` is NOT NULL, so an ingested call is owned by the oldest
  active internal user until a manual resolve stamps the real actor.

## Ground truth (verified in DB 2026-08-22)
- `system_interaction_types` includes `Call` (also Email, General, Marketing:*).
- `contacts` has NO phone column; phones live in **`contact_phone_numbers`**
  with `normalized_phone_number` already present → the match key.
  (contact_phone_type_definitions exists for types.)
- `clients.phone` exists (client_locations also carries phone).
- `interactions` columns: tenant, interaction_id, type_id, contact_name_id,
  user_id, ticket_id, title, interaction_date, duration, notes, start_time,
  end_time, status_id, client_id, project_id, visibility, category, tags,
  opportunity_id.

## Reuse map (from the 2026-08 Teams work, branch feature/teams_emulator_meetings_and_temporal)
- Subscription create/renew/secret/webhook-validation: mirror
  `ee/packages/microsoft-teams/src/lib/meetings/artifactSubscriptions.ts` +
  `/api/teams/webhooks/recordings` route (clientState parse/verify, allowlist).
- Job path: webhook → runner seam (`getJobRunner().scheduleJob`) → Temporal on EE
  → worker `forwardJobToServer` → maintenanceJobSubscriber (runWithTenant) —
  identical to process-teams-meeting-artifact-notification.
- Defaults resolver for tickets: getTeamsTicketCreationDefaults +
  resolveDefaultPriorityIdForBoard (exported).
- AI summary seam: annotateLinkedTicketFromTranscript (meetings) — generalize
  input for calls in phase 2.
- Emulator patterns: seeder→notification (meeting-recording), resource-scoped
  subscription filtering (ARTIFACT_SUBSCRIPTION_RESOURCES), operation-fault.
- Permission probe: REQUIRED_GRAPH_APPLICATION_PERMISSIONS in
  teamsSetupValidationActions — add CallRecords.Read.All.

## Gotchas / landmines to carry
- Next dev watcher does not see edits under ee/packages/* or packages/jobs/*
  (node_modules symlinks) — bounce the dev server.
- Emulator state is in-memory today; restarts wipe seeds (the --state-file
  feature in this plan removes that). Bot signing keypair must NOT rotate on
  state restore mid-run (JWKS caching), same as reset() semantics.
- Citus: tenant in PK, no RLS, migrations via ./utils/tenantDb.cjs shim.
- PgBossJobRunner.scheduleJob throws when a handler is unregistered (CE) —
  register handlers before any enqueue path can fire.
- teams_audit_events.action_id has a CHECK constraint — telephony actions need
  their own audit table or a constraint extension (decide in call-ingestion).

## Open questions (also in PRD Risks)
- ~~Graph surface for Teams Phone 1:1 call recordings/transcripts~~ ANSWERED —
  see SPIKE-F065-call-artifacts.md: `/users/{id}/adhocCalls/{callId}/{recordings,transcripts}`.
  Needs a second Entra consent (`CallRecordings.Read.All`) + an application
  access policy, so F066–F068 stay deferred behind operator actions.
- callRecords subscription quota behavior on large tenants.
- Default region for E.164 normalization of national-format numbers (tenant
  setting? derive from client_locations country?).

## Commands
- Plan validation: `python3 ~/.claude/skills/software-planner/scripts/validate_plan.py ee/docs/plans/2026-08-22-telephony-integration`
- Emulator: `docker compose -f packages/emulators/compose.yml up -d`; alias
  `algasim='node packages/emulators/host/dist/cli.js'`.
