# PRD — Teams Online Meetings → Interactions, MSP scheduling, recording/transcript capture

- Slug: `teams-online-meetings-interactions`
- Date: `2026-06-01`
- Status: Draft (design converged; see `../../../../.ai/teams-meetings-interactions-consolidated-plan.md` for the long-form design)

## Summary

Make Microsoft Teams online meetings first-class **interaction** records in Alga PSA, let MSP users
**schedule** meetings themselves (not just as a side effect of a client appointment request), and
**capture the recording and transcript** after a meeting ends — surfaced on the contact/client
interactions timeline (and appointment views). Meetings are created as **calendar-backed events** so
their recordings/transcripts are retrievable from Microsoft Graph. Storage: transcript saved as a
durable internal **document**; recording streamed through an internal authenticated **proxy** (raw Graph
content URLs are never exposed), with an optional per-tenant blob-download.

## Problem

Today a Teams meeting only exists as a side effect of an end-client appointment request: the client
requests, an MSP user approves, and (if enabled) Graph creates a standalone online meeting whose join
link is stashed on `appointment_requests`. There is **no record on the interactions timeline**, MSP
users **cannot originate a meeting** themselves, and **nothing captures the recording or transcript**.
Additionally, the current standalone-onlineMeeting creation path cannot reliably surface
recordings/transcripts (Graph requires calendar-backed meetings for those APIs).

## Goals

- Online meetings appear as "Online Meeting" interactions on the contact/client timeline with the join
  link, regardless of edition (CE shows join link only).
- MSP users can schedule a Teams meeting from the interactions feed and from the schedule-entry popup.
- After a meeting ends, recording(s) and transcript(s) are captured and surfaced on the interaction and
  appointment detail views, via a manual "Refresh recordings" action (Phase 1) and Graph change
  notifications (Phase 2).
- Appointment-approval meetings and MSP-initiated meetings share one data model and one interaction
  type.

## Non-goals

- Importing externally-organized Teams meetings (per-user OAuth browse/import) — deferred.
- Per-user meeting organizer (everything uses one tenant service account in v1).
- Co-organizer / presenter role assignment for the creating MSP user.
- Providers other than Teams (data model is provider-agnostic but only `teams` is implemented).
- "Recording available" notification emails.
- Operational gold-plating (metrics, dashboards, retry frameworks) beyond the explicit capability
  diagnostics and the bounded recording-fetch retry cap below.

## Users and Primary Flows

- **MSP user (internal):**
  - Approves a client appointment request with "Generate Teams meeting" → meeting created, interaction +
    `online_meetings` row created, capture registered.
  - Creates a meeting ad-hoc from the interactions feed (Quick Add → type "Online Meeting" → "Create
    Teams meeting") or from the schedule-entry popup.
  - Views the interaction: Join, list of recording/transcript artifacts (newest first), status, and a
    "Refresh recordings" button.
- **Client user (client portal):** sees Join, and recording/transcript links only when the tenant has
  enabled client-portal visibility (default MSP-only).
- **Tenant admin:** configures the meeting organizer service account and the `download_recordings` /
  `expose_recordings_in_portal` toggles in the Teams integration settings page.

## UX / UI Notes

- New system interaction type **"Online Meeting"**, icon `video` (provider-agnostic; distinct from the
  manual "Meeting" type).
- `InteractionDetails`: "Online Meeting" section — Join + status ("Recording pending" / "No recording") +
  "Refresh recordings" + an **artifacts list** (each transcript → "View transcript" opening the internal
  document; each recording → "Download recording" hitting the internal proxy).
- `QuickAddInteraction`: when type = Online Meeting, a "Create Teams meeting" toggle (gated on
  capability) with start/end.
- `EntryPopup`: "Generate Teams meeting" option when creating a schedule entry.
- Client-portal appointment views: recording/transcript links next to "Join Teams Meeting", gated on the
  tenant visibility setting.
- All new interactive elements need stable kebab-case `id`s (UI reflection); all new copy via `t('...')`
  i18n keys.

## Requirements

### Functional Requirements

1. Create meetings as **calendar-backed events** (`POST /users/{organizerUpn}/events`,
   `isOnlineMeeting: true`, `onlineMeetingProvider: 'teamsForBusiness'`); resolve the onlineMeeting id
   from the event `joinUrl`.
2. Persist a `online_meetings` row + an "Online Meeting" interaction for both creation paths
   (appointment approval and MSP-initiated), linked by `appointment_request_id` or `schedule_entry_id`.
3. Capture recordings and transcripts as **`online_meeting_artifacts`** rows (collections, not single
   values). Transcript content stored as an internal document (client+contact association,
   `is_client_visible=false` unless opted in). Recording surfaced via internal proxy; optional blob
   download.
4. Manual "Refresh recordings" action (Phase 1) and Graph change-notification subscriptions (Phase 2)
   both drive the same idempotent fetch handler.
5. Keep appointment reschedule/cancel in sync: update/delete the calendar event via `provider_event_id`
   for new rows; preserve legacy `online_meeting_id` handling for pre-existing standalone meetings;
   set status `cancelled` on decline.
6. Tenant settings (Teams integration settings page): organizer service account
   (`default_meeting_organizer_upn` + `default_meeting_organizer_object_id`), `download_recordings`,
   `expose_recordings_in_portal`.
7. Capability diagnostics surface missing consent / Exchange-side mailbox scoping instead of failing
   silently.

### Non-functional Requirements

- **Multi-tenant / Citus:** all new tables distributed on `tenant`, PK includes `tenant`,
  application-level integrity (no cross-shard FKs). `online_meeting_artifacts` colocated with
  `online_meetings`.
- **Transaction discipline:** all Graph create/update/delete calls run **outside** DB transactions; if
  Graph create succeeds but the DB transaction fails, the orphaned calendar event is deleted
  (compensation).
- **Edition:** `online_meetings`, `online_meeting_artifacts`, and the interaction type are
  edition-agnostic; recording/transcript capture, subscriptions, and renewal jobs are EE-gated.
- **Bounded retry:** recording fetch capped via `recording_fetch_attempts`, terminal `no_recording`.
- **Security:** raw Graph content URLs never sent to any client; proxy enforces auth + tenant + (for
  portal) the visibility setting.

## Data / API / Integrations

- **New core migration** — `online_meetings` (PK `(tenant, meeting_id)`; `provider`,
  `provider_meeting_id`, `provider_event_id`, `organizer_upn`, `organizer_user_id`, `subject`,
  `join_url`, `start_time`, `end_time`, `status` ∈
  {scheduled, ended, recording_pending, recording_ready, no_recording, cancelled, failed},
  `recording_fetch_attempts`, `last_fetch_at`, `appointment_request_id`, `interaction_id`,
  `schedule_entry_id`, `created_by`, timestamps) **and** `online_meeting_artifacts`
  (PK `(tenant, artifact_id)`; `meeting_id`, `artifact_type` ∈ {recording, transcript},
  `provider_artifact_id`, `content_url`, `document_id`, `file_id`, `created_date_time`, timestamps;
  unique `(tenant, meeting_id, artifact_type, provider_artifact_id)`).
- **New core migration** — insert "Online Meeting" into `system_interaction_types` (icon `video`).
- **EE migration** — add `default_meeting_organizer_object_id`, `download_recordings`,
  `expose_recordings_in_portal` (+ Phase 2 subscription id/expiry) to `teams_integrations`.
- **Types** — `IOnlineMeeting` + `IOnlineMeetingArtifact` (with `artifacts[]`); optional
  `online_meeting` on `IInteraction`.
- **Graph (EE)** — change `createTeamsMeeting`/`update`/`delete` to the events endpoints; new
  `fetchMeetingArtifacts` (recordings + transcripts collections, transcript content); reuse
  `fetchMicrosoftGraphAppToken` / `resolveTeamsMeetingExecutionConfig`. URL-encode id path segments.
- **Permissions (document, admin-consent)** — `Calendars.ReadWrite` (application) **scoped via an
  Exchange Application Access Policy / RBAC to the organizer mailbox**, plus protected/metered
  `OnlineMeetingRecording.Read.All`, `OnlineMeetingTranscript.Read.All` on top of existing
  `OnlineMeetings.ReadWrite.All` + Teams Application Access Policy.

## Security / Permissions

- `scheduleTeamsMeeting` requires an explicit `hasPermission` check (confirm resource/action in repo
  catalog) in addition to `withAuth`.
- Recording proxy route: authenticated, tenant-scoped, portal-visibility-gated.
- Transcript documents default `is_client_visible=false`.
- `Calendars.ReadWrite` must be mailbox-scoped on the Exchange side (Teams Application Access Policy does
  not scope calendar/mailbox access).

## Observability

Out of scope beyond capability diagnostics (consent/scoping warnings) — no metrics/dashboards.

## Rollout / Migration

- New tables/type ship in CE & EE; capture features are EE-only and no-op in CE.
- **No backfill** of appointments approved before launch (they keep `online_meeting_*` columns +
  email/portal links; no timeline interaction).
- Phase 1 (manual refresh) ships first; Phase 2 (subscriptions + renewal job) follows.
- New Graph permissions + Exchange scoping documented in Teams setup docs; not auto-granted.

## Open Questions

- Exact `hasPermission` resource/action for `scheduleTeamsMeeting` (confirm against repo catalog).
- Whether MSP-initiated meetings should default to including the contact as an attendee or leave it
  optional in the UI.

## Acceptance Criteria (Definition of Done)

- Approving an appointment with a Teams meeting creates an "Online Meeting" interaction + `online_meetings`
  row (calendar-backed), with no external attendees, and the join link still appears in email/portal.
- An MSP user can create a meeting from the interactions feed and the schedule popup; both produce the
  same interaction + row; a schedule entry (when created) has `work_item_id = interaction_id`.
- After recording a meeting, "Refresh recordings" populates transcript document(s) + recording
  artifact(s); the interaction lists all artifacts; recording plays via the proxy; no raw Graph URL is
  exposed.
- Reschedule updates, and cancel/decline cancels, the calendar event via `provider_event_id` (legacy
  rows still handled); all Graph calls run outside DB transactions; orphaned events are cleaned up on DB
  failure.
- Client portal shows recording/transcript only when `expose_recordings_in_portal` is on.
- CE build shows the interaction with join link only and no recording UI errors.
- Migrations apply/rollback cleanly on plain Postgres and Citus.
