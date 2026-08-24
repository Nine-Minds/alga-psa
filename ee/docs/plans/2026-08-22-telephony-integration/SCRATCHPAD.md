# Telephony Plan — Scratchpad

## Decisions
- **Calls live in `interactions`** (user decision 2026-08-22). Schema already fits:
  type_id (system type `Call` EXISTS in system_interaction_types), contact_name_id,
  client_id, ticket_id, duration (int), start_time/end_time, notes, status_id.
  No interactions schema change needed for v1.
- Vendor-neutral core + adapters; Teams Phone first (rides existing Microsoft
  profile/auth/subscription machinery). Twilio/Ringotel later — they bring
  ring-time webhooks (real screen-pop), which Graph cannot do.
- Gated by the existing `teams` add-on; no separate telephony key.
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

## Live loop verification (2026-08-22, card stack on :3109)
Ran the plan's verification against a card-local msgraph emulator (control
9509 / vendor 4019) with `TEAMS_EMULATOR_MODE=true` and the tenant's existing
`alga-teams-graph-client` credentials seeded into it. Results:

- **Subscription create** — enabling Teams Phone from Settings → Integrations →
  Communication → Telephony created a real `communications/callRecords`
  subscription (`subscription-2-…`) and stored its id, expiry and clientState
  secret; the Graph validation handshake echoed the validationToken (200) and
  the first notification was accepted (202).
- **Matched inbound** — `+15552468135` → contact *Alice in Wonderland* /
  *Wonderland*, interaction "Inbound call from +1 (555) 246-8135", duration 3
  (minutes), start/end stamped from the CDR.
- **Duplicate notification** — the same notification delivered twice left one
  call record and one interaction.
- **Missed** — an unanswered CDR mapped to `direction='missed'` and titled
  "Missed call from …".
- **Ambiguous** — a number shared by two contacts stored both candidates with
  no attribution and no interaction.
- **Unmatched → resolve** — an unknown number stored zero candidates; the new
  search picker in the queue found *Dorothy Gale · Emerald City*, resolved the
  call (`match_status='resolved'`) and minted the interaction on that timeline.
- **Ticket from call** — created TIC001037 on the matched client/contact with
  the board/status/priority defaults, and stamped `interactions.ticket_id`.

Landmine worth recording: **EE ignores `JOB_RUNNER_TYPE=pgboss`** — the webhook
always starts `genericJobWorkflow` on Temporal. This card's stack has no worker
polling namespace `default`, so those workflows just time out after 1h (several
from earlier rounds are visible in the Temporal UI). For the run above the
worker's hand-off was reproduced exactly as `forwardJobToServer` does it, by
publishing `MAINTENANCE_JOB_REQUESTED` onto the event stream the server-side
`maintenanceJobSubscriber` consumes. Everything downstream of Temporal is
therefore covered; Temporal's own delivery is not.

Verification data was removed afterwards (call records, interactions, the
ticket) and `telephony_providers` was returned to `not_configured`.

## Gating moved under Microsoft Teams (2026-08-24)
Operator call: telephony is not sold separately, it ships inside the existing
`teams` add-on. `ADD_ONS.TELEPHONY` is gone; every telephony gate — the
settings sub-section, `getTelephonyAvailability`, and the ingestion path —
now reads a non-expired `teams` row. Re-verified on the card stack (:3109)
against the Oz tenant after deleting its stale `telephony` row:

- Teams add-on active → Telephony sub-section renders the provider grid,
  recent calls and the attribution queue; no paywall.
- Teams add-on expired → both Communication sub-sections show the add-on
  notice pointing at `/msp/add-ons?addon=teams`. The two notices need distinct
  link ids (`manage-teams-addon-link` / `manage-telephony-addon-link`) because
  sub-sections stay mounted while hidden.
- `ingestCanonicalCall` against the real database: matched call → ledger row +
  "Inbound call from +1 (555) 246-8135" interaction on Alice in Wonderland /
  Wonderland; replay was a no-op; with the add-on expired it skipped with
  `addon_inactive` and wrote nothing. Verification rows removed afterwards.

Landmine: booting the dev server rewrites the tenant admin's password (it
prints the new one), and `server/.env.local`, if present, overrides the card's
`.env` — including `DB_NAME_SERVER`, which would point the card at another
database entirely.

## Quick Add meeting round — repair notes (2026-08-24)
The Quick Add online-meeting changes that landed alongside the gating move were
red. What they needed, for the next round's benefit:

- `ensureCreatorAttendee` cannot live in `onlineMeetingSchedulingActions.ts`: a
  `'use server'` module may only export async functions, and importing it from
  a test drags `@alga-psa/auth` → next-auth → `next/server`, which vitest
  cannot resolve. It belongs in `lib/teamsMeetingContent.ts` next to
  `buildTeamsMeetingAttendees`, and its test with it.
- The clients-package `MeetingAttendee.emailAddress` is a **plain string**; the
  Graph-shaped `{ address, name }` object only exists on the scheduling side of
  the seam. Reading `.address` in the invite summary emptied the list silently.
- The cross-feature seam type `ScheduleTeamsMeetingFromClientInput` has to
  declare every field the caller passes (`createScheduleEntry`), and
  `TeamsMeetingCapabilityResult` has to declare `sendMeetingInvites` — the
  EE implementation's object flows through `resolveTeamsMeetingService`
  untouched, so an undeclared field reaches the UI but typechecks as absent.
- Adding a field to a capability result breaks `toEqual` assertions in
  `server/src/test/unit/teamsMeetingHelpers.test.ts`; that suite is the gate.

Note when running server unit tests: several suites resolve fixtures relative
to `process.cwd()`, so run them from `server/`, not from the repo root with
`--root server`. Otherwise `public/locales/...` and doc-contract paths miss and
you get ~22 phantom failures.
