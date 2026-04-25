# PRD — Teams Meeting Link on Appointment Approval

- Slug: `teams-meeting-on-appointment-approval`
- Date: `2026-04-23`
- Status: Draft

## Summary

Generate a Microsoft Teams online meeting link automatically when an MSP staff member approves an appointment request, controlled per-appointment by a toggle on the approval form. The Teams join URL is embedded in the client-facing approval email, the calendar ICS attachment, the MSP schedule-entry view, and the client-portal appointment detail page. Meetings follow the appointment's lifecycle: they are patched when the schedule is changed and deleted when the appointment is cancelled.

## Problem

MSP operators running virtual consultations currently have to create a Teams meeting manually after approving an appointment request, then paste the join link into a follow-up email to the client. This is slow, error-prone, and leaves the ICS calendar attachment without a join URL. With the Teams integration shipping for tenant notifications, we have a viable path to create meetings on the tenant's behalf and close the loop.

## Goals

- Let MSP approvers create a Teams meeting at approval time with a single toggle (no second screen, no copy-paste).
- Ship the join URL to the client via the existing approval email and ICS attachment.
- Keep the meeting in sync when the appointment is rescheduled or cancelled so the link never points at a stale time.
- Expose tenant-level configuration (default meeting organizer) in an existing settings surface so admins can turn the feature on without a developer.
- EE-only: CE builds must continue to work unchanged.

## Non-goals

- Supporting providers other than Microsoft Teams (Zoom, Google Meet). The schema is generic to allow this later, but only the Teams provider is implemented.
- Per-user delegated OAuth. All meetings are created as a designated tenant organizer via app-only auth.
- A general "integrations" admin hub. The configuration lives inside Availability Settings → Teams Meetings tab because it is tied to the appointment-approval workflow, not a standalone concern.
- Retries / background queues / circuit breakers for Graph calls. On failure we log, show a warning toast, and let the approver retry manually if desired.
- Recording/transcript policies, lobby/PSTN options, federated participants. Meetings are created with Graph defaults.
- Translating templates beyond English for the new strings. Pseudo-locale regeneration + translation pass can follow the usual i18n pipeline.

## Users and Primary Flows

**MSP approver (primary)**
1. Opens a pending appointment request in the MSP panel or via the calendar Edit Entry modal.
2. Sees the "Generate Teams meeting link" toggle (only if their tenant has Teams configured AND has an organizer set). Toggle defaults ON.
3. Clicks Approve. Schedule entry is created and — if toggle on — a Teams meeting is created on behalf of the tenant's designated organizer.
4. Sees the join URL on the approved appointment's detail view, and a green success toast. If the Graph call failed, sees a yellow warning toast explaining the approval succeeded but the meeting was not created.

**MSP admin (setup)**
1. Navigates to Scheduling → Availability Settings. The "Teams Meetings" tab is visible only when `teams_integrations.install_status = 'active'`.
2. Enters the default meeting organizer UPN (e.g., `scheduling@acme.com`). Saves.
3. A validation server action optionally verifies the UPN resolves to a Microsoft user (best-effort; failure is a warning, not a blocker).

**MSP approver (reschedule)**
1. Opens an approved appointment request and updates `final_date` / `final_time`.
2. If the appointment has an `online_meeting_id`, the server patches the meeting via Graph to the new times.
3. If the PATCH fails, the reschedule still succeeds; a warning toast informs the approver.

**MSP approver (cancel / decline)**
1. Clicks Cancel or Delete on an approved appointment that has an associated Teams meeting.
2. A confirmation dialog warns: "This will also delete the Microsoft Teams meeting."
3. On confirm, the Graph DELETE is attempted. Success or failure, the appointment state change proceeds; Graph errors become warnings.

**Client (end user)**
1. Receives the approval email with a "Join Teams Meeting" button.
2. Opens the ICS attachment in their calendar; the LOCATION field shows "Microsoft Teams Meeting" and the URL/description contain the join link.
3. In the client portal, the appointment detail page shows a prominent "Join Teams Meeting" button.

## UX / UI Notes

**Approval form — toggle**
- Label: "Generate Microsoft Teams meeting link"
- Placement: between "Assign Technician" and "Internal Notes" in the approval form within `AppointmentRequestsPanel.tsx` and in the pending-request approval UI in `EntryPopup.tsx`.
- Visibility: only if `getTeamsMeetingCapability(tenantId)` returns `{ available: true }`.
- Default: checked.

**Availability Settings — new tab**
- New `TabsTrigger value="teams-meetings"` appended to the existing list in `AvailabilitySettings.tsx`.
- Tab visibility gated by a readiness check (`install_status = 'active'`); the whole `<TabsTrigger>` is conditionally rendered so non-configured tenants never see it.
- Body contains: a single Input for "Default meeting organizer (UPN or Microsoft user ID)" with help text, a Save button, and a small "Verify" link that calls Graph `/users/{upn}` to confirm the user exists.
- A warning banner at the top of the tab lists prerequisites the admin must complete in Azure: application permission `OnlineMeetings.ReadWrite.All` + an Application Access Policy granting the app permission to create meetings for this user.

**MSP schedule-entry view (approved)**
- Add a "Join Teams Meeting" button inside the existing success banner in `EntryPopup.tsx`. Clicking opens the URL in a new tab.

**Client-portal appointment details**
- Add a prominent primary button "Join Teams Meeting" when `online_meeting_url` is present. Placed near the date/time block in `AppointmentRequestDetailsPage.tsx`.

**Email templates**
- `appointment-request-approved-client`: add a conditional Handlebars block that renders a "Join Teams Meeting" button when `{{onlineMeetingUrl}}` is present.
- `appointment-assigned`: same conditional block for the assigned technician.

**ICS file**
- When `online_meeting_url` is present, set `LOCATION: Microsoft Teams Meeting` and include the URL in both the `URL` property (which `icsGenerator` already supports) and append a line to `DESCRIPTION`: "Join Teams Meeting: {{url}}".

**Failure UX**
- `approveAppointmentRequest` returns `{ success: true, data: ..., teamsMeetingWarning?: string }`. When the warning is present, the UI shows a yellow `variant="warning"` toast and continues showing the approved state.
- Reschedule failures → `{ ..., teamsMeetingWarning?: string }` in the update action's return, surfaced as a toast.
- Delete failures → warning toast: "Appointment deleted, but the Microsoft Teams meeting could not be removed. Please remove it manually in Teams."

## Requirements

### Functional Requirements

**FR-1 Schema: `appointment_requests`**
- Add nullable columns: `online_meeting_provider` (text), `online_meeting_url` (text), `online_meeting_id` (text).
- Values populated only when a meeting is successfully created.

**FR-2 Schema: `teams_integrations`**
- Add nullable column `default_meeting_organizer_upn` (text).
- Readiness check for meeting creation = `install_status = 'active'` AND `selected_profile_id IS NOT NULL` AND `default_meeting_organizer_upn IS NOT NULL`.

**FR-3 Helper: `createTeamsMeeting()`**
- Location: `ee/packages/microsoft-teams/src/lib/meetings/createTeamsMeeting.ts`.
- Input: `{ tenantId, subject, startDateTime, endDateTime }`.
- Behaviour: resolve profile via `resolveTeamsMicrosoftProviderConfigImpl`, fetch app token via `fetchMicrosoftGraphAppToken`, read organizer UPN from `teams_integrations`, POST to `https://graph.microsoft.com/v1.0/users/{upn}/onlineMeetings`.
- Output: `{ joinWebUrl, meetingId } | null`. Logs on failure and returns `null`.

**FR-4 Helper: `updateTeamsMeeting()`**
- Same location. Input: `{ tenantId, meetingId, startDateTime, endDateTime }`.
- PATCHes `/users/{upn}/onlineMeetings/{id}` with new times.

**FR-5 Helper: `deleteTeamsMeeting()`**
- Same location. Input: `{ tenantId, meetingId }`. Fire-and-forget DELETE. Surfaces errors only via log.

**FR-6 Readiness server action: `getTeamsMeetingCapability(tenantId)`**
- Location: `ee/packages/microsoft-teams/src/lib/actions/meetings/meetingCapabilityActions.ts`.
- Output: `{ available: boolean, reason?: 'ee_disabled' | 'not_configured' | 'no_organizer' }`.
- Called from the approval form to decide toggle visibility.

**FR-7 CE/EE split**
- `packages/scheduling/` (CE-safe) calls the Teams helpers only via a dynamic EE import guarded by an edition check. CE builds must not require the `ee/packages/microsoft-teams` package.
- Pattern: a thin `resolveTeamsMeetingService()` in scheduling that returns no-op handlers when EE is not available.

**FR-8 Approval schema update**
- `approveAppointmentRequestSchema` adds `generate_teams_meeting: boolean` (default false).

**FR-9 `approveAppointmentRequest` action**
- After schedule_entry insert, if `input.generate_teams_meeting === true`, call `createTeamsMeeting()`.
- On success: `UPDATE appointment_requests SET online_meeting_provider='teams', online_meeting_url=..., online_meeting_id=... WHERE appointment_request_id = ?`.
- Pass `onlineMeetingUrl` into the approved email template payload.
- Pass `url` into the ICS generator input.
- On failure: populate `teamsMeetingWarning` in response; do not fail the approval.

**FR-10 `updateAppointmentRequestDateTime` action**
- If the request has `online_meeting_id` and provider is `teams`, call `updateTeamsMeeting()` with the new start/end.
- On failure: surface `teamsMeetingWarning`.

**FR-11 Cancel / delete flow**
- `cancelAppointmentRequest` (client portal) and MSP-side deletion: when `online_meeting_id` present and provider is `teams`, call `deleteTeamsMeeting()`.
- UI: cancel/delete confirmation dialogs show the warning text about removing the Teams meeting when the appointment has one.
- After-the-fact warning toast on Graph failure.

**FR-12 UI: Approval form toggle**
- `AppointmentRequestsPanel.tsx` and the pending branch of `EntryPopup.tsx` render the toggle only when `getTeamsMeetingCapability` says available. Default checked.

**FR-13 UI: Join button on MSP entry view**
- `EntryPopup.tsx` approved banner includes a "Join Teams Meeting" button when `appointmentRequestData.online_meeting_url` is present.

**FR-14 UI: Join button on client portal**
- `packages/client-portal/src/components/appointments/AppointmentRequestDetailsPage.tsx` renders a primary button when URL is present.

**FR-15 Admin UI: Teams Meetings tab in Availability Settings**
- Conditional `<TabsTrigger>` + `<TabsContent>` in `AvailabilitySettings.tsx`.
- Form: single UPN input + Save + optional Verify button.
- Backing server action: `setDefaultMeetingOrganizer({ tenant, upn })` writes to `teams_integrations.default_meeting_organizer_upn` (requires `tenant_integrations:update` or equivalent permission).
- Optional `verifyMeetingOrganizer({ tenant, upn })` that calls Graph `/users/{upn}` and returns `{ valid: boolean, displayName?: string, reason?: string }`.

**FR-16 Email templates**
- Update the two template migrations (or add a new migration) to add a conditional "Join Teams Meeting" section rendered via `{{#if onlineMeetingUrl}}...{{/if}}`.
- Templates updated: `appointment-request-approved-client`, `appointment-assigned`.

**FR-17 ICS generator integration**
- Pass `url: online_meeting_url` and `location: 'Microsoft Teams Meeting'` into `ICSEventData` when a meeting was created.

**FR-18 i18n**
- New keys under `entryPopup`, `requests.approval`, `availabilitySettings.tabs`, `availabilitySettings.teamsMeetings.*`, and client-portal appointment translations. Add to English; regenerate pseudo locales.

### Non-functional Requirements

- **EE gating**: All Graph-calling code lives under `ee/`. CE build continues to succeed.
- **Fail soft**: Any Graph call that fails must not fail the parent user action (approve, reschedule, cancel). Errors are logged with a structured message including `tenant`, `appointment_request_id`, `operation` (`create | update | delete`), and the Graph error code/body.
- **Audit trail**: Meeting creation/update/delete operations go through existing `publishEvent` logging — one new event: `APPOINTMENT_ONLINE_MEETING_ATTACHED` (optional MVP, only if cheap to add). If not emitted, the regular `SCHEDULE_ENTRY_UPDATED` event still fires.

## Data / API / Integrations

**Migrations**

1. `server/migrations/<timestamp>_add_online_meeting_columns_to_appointment_requests.cjs`
   - Adds three nullable text columns to `appointment_requests`.
   - Safe under Citus (adds to distributed table, no distribution key change).

2. `ee/server/migrations/<timestamp>_add_default_meeting_organizer_to_teams_integrations.cjs`
   - Adds nullable `default_meeting_organizer_upn text` column.

**Microsoft Graph endpoints**

- Create: `POST https://graph.microsoft.com/v1.0/users/{upn}/onlineMeetings`
  - Body: `{ subject, startDateTime, endDateTime }` (ISO 8601, UTC).
  - Requires app permission `OnlineMeetings.ReadWrite.All` + Application Access Policy authorising the app for the organizer user.
- Update: `PATCH /users/{upn}/onlineMeetings/{id}` with `{ startDateTime, endDateTime }`.
- Delete: `DELETE /users/{upn}/onlineMeetings/{id}`.
- Verify user (optional): `GET /users/{upn}` returns `{ displayName, userPrincipalName, id }`.

**Reused infrastructure**

- `resolveTeamsMicrosoftProviderConfigImpl` at `ee/packages/microsoft-teams/src/lib/auth/teamsMicrosoftProviderResolution.ts`.
- `fetchMicrosoftGraphAppToken` at `ee/packages/microsoft-teams/src/lib/notifications/teamsNotificationDelivery.ts` (or extract to a shared auth module if preferred).
- `getTeamsIntegrationExecutionStateImpl` at `ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts`.
- `generateICSBuffer` / `ICSEventData` at `packages/scheduling/src/utils/icsGenerator.ts` (already supports `url` and `location`).

## Security / Permissions

- **Tenant isolation**: Meeting creation always scoped to the tenant's own Microsoft profile; no cross-tenant Graph calls possible.
- **Organizer UPN update permission**: reuse `tenant_integrations:update` (or the existing permission covering `teams_integrations`).
- **Secret handling**: Graph tokens are short-lived and fetched per-call — not persisted. Existing `fetchMicrosoftGraphAppToken` path is already battle-tested.
- **Meeting URL exposure**: join URLs are visible to anyone who receives the email or can view the appointment in the client portal. This matches the current Teams meeting access model — Graph-issued links require the user to be allowed by the tenant's meeting policies.

## Observability

- Structured log lines for every Graph call at INFO on success and WARN on failure, including `tenant`, `appointment_request_id`, `operation`, and Graph response status/code.
- No new metrics or dashboards in this plan. (Out of scope per the "no gold-plating" principle.)

## Rollout / Migration

**Phase 1 — Ship dark (no behaviour change)**
- Apply both migrations. No code path reads the new columns yet, so CE + EE tenants are unaffected.

**Phase 2 — EE code + admin UI**
- Ship the helpers, server actions, availability-settings tab, approval-form toggle, email template update, and client-portal button.
- The toggle is only visible if the tenant has set `default_meeting_organizer_upn` — so the feature is inert until an admin opts in.

**Phase 3 — Documentation**
- Add an Azure admin runbook: how to grant `OnlineMeetings.ReadWrite.All` application permission and how to create the Application Access Policy authorizing the organizer user. Include the PowerShell snippets.
- Location: `docs/integrations/teams-meetings-setup.md`.

**Feature flag**
- Reuse existing PostHog flag `teams-integration-ui` for the UI surfaces. No new flag unless we want to gate meetings separately; the existing gate is enough.

**Backout**
- If issues arise, setting `default_meeting_organizer_upn = NULL` instantly hides the toggle and disables new meeting creation, without requiring a deploy. Existing appointments with stored URLs continue to work.

## Open Questions

1. Should `verifyMeetingOrganizer` also check that an Application Access Policy exists, or just that the user exists? Graph doesn't expose policy membership directly; a working test-call is the only true check. **Tentative answer:** the Verify button performs a dry-run `POST /users/{upn}/onlineMeetings` with a throwaway meeting and deletes it if successful. Heavier but truthful. If rejected, show the Azure admin runbook link.
2. When reschedule fires, should we also update `subject` or only times? **Tentative answer:** only times. If the approver wants to change the subject they can do it in Teams.
3. Do we need to update the EE edition check module, or does `ee/packages/microsoft-teams` have an existing ambient export that CE can safely call (returning no-op)? **Verify before implementation.**

## Acceptance Criteria (Definition of Done)

- [ ] Both migrations applied; columns present in dev + staging DBs.
- [ ] `createTeamsMeeting`, `updateTeamsMeeting`, `deleteTeamsMeeting` helpers return correctly shaped results against a fixture tenant (manual QA).
- [ ] `getTeamsMeetingCapability` returns `{ available: false, reason: 'not_configured' }` for a tenant with no `teams_integrations` row; returns `{ available: false, reason: 'no_organizer' }` when UPN is null; returns `{ available: true }` when all prerequisites are met.
- [ ] Approval form toggle is hidden when capability is unavailable and visible (default ON) when available.
- [ ] Approving a request with the toggle on creates a Teams meeting, stores the three columns, injects the join URL into the approval email, and adds it to the ICS file.
- [ ] Approval still succeeds if Graph returns a 403/404/5xx; warning toast is shown; appointment is approved without meeting columns populated.
- [ ] Rescheduling an appointment with `online_meeting_id` patches the Graph meeting; times on the join link match the new time.
- [ ] Cancelling/declining an appointment with `online_meeting_id` deletes the Graph meeting; confirmation dialog warns about the deletion.
- [ ] Client-portal detail page shows the "Join Teams Meeting" button for appointments with a URL.
- [ ] Availability Settings → Teams Meetings tab appears only when `install_status = 'active'`; organizer UPN can be saved and verified.
- [ ] CE builds pass (`npm run build` without `ee`).
- [ ] EE builds pass (`npm run build:ee`).
- [ ] Translation validator (`node scripts/validate-translations.cjs`) reports 0 errors after pseudo-locale regeneration.
- [ ] Azure admin runbook exists at `docs/integrations/teams-meetings-setup.md`.
