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
  (Which database that actually was is uncertain — see the `DB_NAME_SERVER`
  landmine below; a script run without an explicit database name talks to the
  operator's `server`, not `server_mc9`.)

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

## Browser-check blocker — root cause and fix (2026-08-24)
A review round reported the card's documented login (`glinda@emeraldcity.oz`)
failing in a real browser with "Invalid password". It was the environment, not
the feature. **Two independent causes, both now fixed on the card stack:**

1. `server/.env.local` — the operator's *personal* `:3000` config (`APP_PORT=3000`,
   `NEXTAUTH_URL=http://localhost:3000`, **`DB_NAME_SERVER=server`**) had been
   copied into this worktree. Next gives `.env.local` precedence over `.env`, so
   the card's app on :3109 was reading and writing the operator's `server`
   database instead of its own clone `server_mc9`. Moved out of the repo to
   `../alga-psa-mc9-server-env.local.operator-bak`. **Never restore it here.**
2. `NEXTAUTH_SECRET=dummy` in `server/.env` with `SECRET_READ_CHAIN=env,filesystem`.
   `hashPassword` is PBKDF2 over `nextauth_secret + salt`, and the clone's user
   rows were hashed with the *filesystem* secret (`secrets/nextauth_secret`), so
   with `dummy` winning the chain no password could ever verify. `server/.env`
   now carries the filesystem secret's real value.

Verified after the fix: the credentials callback 302s to `/`, and a real
Chromium sign-in lands on `/msp/dashboard`.

**Landmine — the dev server rewrites the admin password on every boot.** It
prints the new one in a banner (`******** Password is -> [ … ] ********`) in the
boot log. So the card's documented password stops working the moment anyone
bounces the server. After a bounce, either read the printed password or restore
the documented one by writing a PBKDF2 `salt:hash` (10000 iterations, 64 bytes,
sha512, key = the effective `nextauth_secret`) into `users.hashed_password`.

**Landmine — an ad-hoc `tsx`/node script defaults to the operator's database.**
`packages/db` resolves `process.env.DB_NAME_SERVER || 'server'`, and `tsx` does
*not* load `server/.env` the way Next does. A bare
`npx tsx scripts/whatever.ts` therefore connects to `server` — the operator's
personal dev database — while looking exactly like it is working. This round a
verification ingest landed a `telephony_call_records` row in `server`; it was
found and deleted, and both databases were confirmed clean. Any script touching
a card database must pass `DB_NAME_SERVER=server_mc9` (plus host/port/creds)
explicitly, or better, take an explicit `knex` — `ingestCanonicalCall`,
`matchCallParty` and the gate all accept one.

Corollary: earlier notes in this file claiming a check ran "against the real
database" via a script should be read with that in mind.

**Running real-database checks outside Next.** The root specifiers
`@alga-psa/event-schemas` (declares a `require` → `dist/index.cjs` that tsup
never emits) and `@alga-psa/workflow-streams` (declares `.` → `dist/index.mjs`
with no build script at all) only resolve inside Next's bundler. So the
interaction-writing half of ingestion cannot be driven from a plain script.
What does work, and is enough to prove the ladder: a throwaway vitest file that
builds its own `knex` against `server_mc9` and calls `matchCallParty` /
`tenantHasTelephonyEntitlement` directly.

## Gating re-verified in a real browser (2026-08-24)
Chromium against the card app on :3109, Oz tenant, which has `teams` active and
**no `telephony` row at all** — so this exercises exactly the operator's
"telephony lives inside the Teams add-on" call:

- Sub-nav renders `integration-subnav-communication-{email,microsoft-teams,telephony}`
  and the matching `integration-subsection-*` ids (kebab-case, as planned).
- Teams add-on **active** → Telephony shows the Teams Phone provider card, the
  auto-ticket toggle, the recent-calls strip and the "Calls needing attribution"
  queue. No paywall anywhere, despite no `telephony` entitlement existing.
- Teams add-on **expired** → *both* Communication sub-sections paywall:
  "Telephony requires the Teams add-on" / "Purchase the Teams add-on to journal
  calls…", with `manage-teams-addon-link` and `manage-telephony-addon-link`
  both present in the DOM at once — which is why the distinct `linkId` matters.
- The add-on row was returned to active afterwards.

Against `server_mc9` directly: the gate flips true→false→true with the `teams`
row's `expires_at`, `+1 (555) 246-8135` matches *Alice in Wonderland* /
*Wonderland* via `contact_phone`, a number shared by two contacts comes back
`ambiguous` with 2 candidates and no attribution, and an unknown number is
`unmatched` with no candidates.

## call-transcripts shipped (2026-08-24)
The last deferred group is built, which closes features.json (F001–F072 all
implemented). Shape, and why:

- `telephony_call_artifacts` + three fetch-state columns on the ledger. Calls
  cannot reuse `online_meetings`/`online_meeting_artifacts`: that pipeline is
  meeting-shaped end to end (it loads a meeting row, resolves an organizer from
  it, and terminates on meeting end time), so a call would have needed a fake
  meeting. The artifact *shape* is copied; the machinery is not.
- `fetchTeamsCallArtifacts` hits `/users/{id}/adhocCalls/{callId}/…` per the
  F065 spike. 403/404 → `[]` (recording is off for most tenants; that is not an
  error), any other status throws so a transient failure never ages a real
  recording into `none`.
- Poll, not webhook: Graph has no artifact notification for ad hoc calls. The
  CDR notification takes the first attempt inline and
  `sweep-telephony-call-artifacts` (10m fan-out, 2m→1h backoff, 6h window)
  takes the rest.
- Capture settings deliberately reuse `teams_integrations.download_recordings`
  / `expose_recordings_in_portal` rather than adding a second place to say the
  same thing.

**Verified live** against the card stack, not just unit fakes: migration applied
to `server_mc9`; algasim (rebuilt image) served a seeded transcript+recording
from the adhocCalls routes to the *real* EE fetcher with a real app-only token;
the transcript landed as `Call transcript - Inbound call from …` with client +
contact associations and text matching the seed; the recording downloaded (50
bytes, video/mp4); the ledger settled to `ready`; a replay was a no-op and a
forced re-poll created no second document. All rows created were removed.

**Landmine — algasim did not persist OAuth client registrations.** Seeds
survived a container restart but `core.clients` did not, so a restarted
emulator answered every app-only token with `invalid_client` while its state
view looked healthy. Fixed (clients are now in the snapshot) and pinned by the
persistence test asking the restored host for a token.

**Landmine — the EE barrel cannot be imported from a plain script.**
`@alga-psa/ee-microsoft-teams/lib` transitively pulls Teams UI (a
`react-day-picker` CSS import), which only a bundler can load. Live checks must
import the specific EE module by path; the barrel-based dynamic import is
covered by the jobs typecheck and unit tests instead.

**Still an operator action:** ad hoc call artifacts need their own admin
consent (`CallRecordings.Read.All` / `CallTranscripts.Read.All`) plus a Teams
application access policy for the organizer. Deliberately *not* added to
`REQUIRED_GRAPH_APPLICATION_PERMISSIONS`: that list drives a pass/fail setup
probe, and failing every tenant's Teams validation over an opt-in capability
they have not bought consent for would be worse than a 403 the fetcher already
reads as "nothing recorded".
