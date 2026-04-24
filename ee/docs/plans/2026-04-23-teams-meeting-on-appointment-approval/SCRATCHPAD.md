# Scratchpad — Teams Meeting Link on Appointment Approval

## Key file paths

**Scheduling (CE-safe)**
- Approval action: `packages/scheduling/src/actions/appointmentRequestManagementActions.ts` (`approveAppointmentRequest` ~L386-824; email dispatch ~L703-814; schedule-entry creation ~L470-639)
- Approval schema: `packages/scheduling/src/schemas/appointmentRequestSchemas.ts` (`approveAppointmentRequestSchema` ~L34-41)
- Approval panel UI: `packages/scheduling/src/components/schedule/AppointmentRequestsPanel.tsx`
- Entry popup UI: `packages/scheduling/src/components/schedule/EntryPopup.tsx`
- Availability Settings UI: `packages/scheduling/src/components/schedule/AvailabilitySettings.tsx` (tabs at L778-784, total ~1371 lines)
- Availability Settings action: `packages/scheduling/src/actions/availabilitySettingsActions.ts`
- ICS generator: `packages/scheduling/src/utils/icsGenerator.ts` (interface `ICSEventData` L6-18; already supports `url` L101-102 and `location` L97-99)
- CE shim: `packages/scheduling/src/lib/teamsMeetingService.ts`

**Client portal**
- Detail page: `packages/client-portal/src/components/appointments/AppointmentRequestDetailsPage.tsx`
- Cancel action: `packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts`

**EE — Microsoft Teams**
- Profile + secret resolver: `ee/packages/microsoft-teams/src/lib/auth/teamsMicrosoftProviderResolution.ts` (`resolveTeamsMicrosoftProviderConfigImpl` L30-79)
- Shared Graph auth utility: `ee/packages/microsoft-teams/src/lib/graphAuth.ts`
- Integration state: `ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts` (`getTeamsIntegrationStatusImpl`, `getTeamsIntegrationExecutionStateImpl`)
- Meeting helpers: `ee/packages/microsoft-teams/src/lib/meetings/createTeamsMeeting.ts`, `ee/packages/microsoft-teams/src/lib/meetings/meetingConfig.ts`
- New actions target dir: `ee/packages/microsoft-teams/src/lib/actions/meetings/`
- Capability action: `ee/packages/microsoft-teams/src/lib/actions/meetings/meetingCapabilityActions.ts`

**Migrations**
- Appointment requests: `server/migrations/20251110223310_create_appointment_requests.cjs` (base), `server/migrations/20260416210000_add_requester_timezone_to_appointment_requests.cjs`
- Added meeting columns migration: `server/migrations/20260423130000_add_online_meeting_columns_to_appointment_requests.cjs`
- Teams integrations: `ee/server/migrations/20260307153000_create_teams_integrations.cjs`
- Added organizer migration: `ee/server/migrations/20260423131000_add_default_meeting_organizer_to_teams_integrations.cjs`
- Email templates: `server/migrations/20251111123313_add_appointment_request_email_templates.cjs` + `server/migrations/20251209175019_update_appointment_email_templates_modern_styling.cjs` (both seed `system_email_templates`)

**Email**
- Service: `@alga-psa/email` package — `SystemEmailService.sendAppointmentRequestApproved(data, options)` and `.sendAppointmentAssignedNotification`
- Current approved template fields: `serviceName, appointmentDate, appointmentTime, duration, technicianName, technicianEmail, technicianPhone, minimumNoticeHours, contactEmail, contactPhone, calendarLink`
- Template language: Handlebars via `replaceVariables()`
- Will add: `onlineMeetingUrl` (and probably `onlineMeetingProvider` for future-proofing)

**i18n**
- Schedule namespace: `server/public/locales/<lang>/msp/schedule.json` (human locales: en, de, es, fr, it, nl, pl, pt; pseudo: xx, yy)
- Pseudo generator: `scripts/generate-pseudo-locales.cjs`
- Validator: `scripts/validate-translations.cjs`

## Decisions

- **Organizer model: option (a)** — one designated tenant-level UPN stored on `teams_integrations`. All meetings created as that user. Requires Azure admin to set up an Application Access Policy granting `OnlineMeetings.ReadWrite.All` for this specific user.
- **Admin UI home: Availability Settings → Teams Meetings tab** (not a dedicated integrations page). Rationale: tab only appears after Teams is active; it's tightly coupled to the appointment-approval flow, which lives in Scheduling. Avoids standing up a new integrations-hub surface.
- **Toggle default: ON** when capability is available. Approver can uncheck per-appointment (e.g., on-site visits).
- **Reschedule: PATCH** via Graph. Only times updated; subject left alone.
- **Cancel/delete: DELETE** via Graph + confirmation dialog warning the user the Teams meeting will go away.
- **Client portal: show Join button.** Clients don't need SSO to join — anonymous join still works.
- **Failure UX: warning toast.** Action return shape gains `teamsMeetingWarning?: string`.
- **Out of scope MVP:** retries, orphaned-meeting janitor, per-user delegated OAuth, per-service auto-toggle, recording settings.

## Azure setup (for admin runbook)

Tenant admin must do once in Azure:
1. Grant the Microsoft profile's app registration the **application permission** `OnlineMeetings.ReadWrite.All` (admin consent required).
2. Create an **Application Access Policy** and assign the designated organizer user to it:
   ```
   New-CsApplicationAccessPolicy -Identity Alga-Meetings -AppIds "<clientId>" -Description "Alga PSA appointment meetings"
   Grant-CsApplicationAccessPolicy -PolicyName Alga-Meetings -Identity "scheduling@acme.com"
   ```
3. Wait ~5-10 min for policy propagation.
4. Enter the organizer UPN in Availability Settings → Teams Meetings tab and click Verify.

## Open questions / verification needed before implementation

- Verify CE shim pattern already used elsewhere in the codebase for EE features — look at how calendar or activity notifications are consumed from CE-safe packages today. Mirror that pattern.
- Decide whether `APPOINTMENT_ONLINE_MEETING_ATTACHED` is worth a new event type or if `SCHEDULE_ENTRY_UPDATED` is sufficient.

## Commands

```bash
# CE build
npm run build

# EE build
npm run build:ee

# Run migrations
npm run migrate

# Regenerate pseudo-locales after adding new English keys
node scripts/generate-pseudo-locales.cjs

# Validate translations
node scripts/validate-translations.cjs

# Test Graph call manually (after setting up Azure policy)
curl -X POST "https://graph.microsoft.com/v1.0/users/scheduling@acme.com/onlineMeetings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Test","startDateTime":"2026-04-24T10:00:00Z","endDateTime":"2026-04-24T10:30:00Z"}'
```

## Gotchas

- **`/me/onlineMeetings` vs `/users/{upn}/onlineMeetings`** — `/me` requires a delegated user token; we use app-only auth so we must use `/users/{upn}`. Mistakenly using `/me` is a common Graph pitfall for server-side integrations.
- **`OnlineMeetings.ReadWrite.All` is application permission, not delegated.** Delegated has a subtly different name.
- **Timezone conversion:** `requested_date` + `requested_time` on appointment_requests is the requester's local wall-clock. Graph requires ISO 8601 UTC. Must convert using `fromZonedTime(local, requester_timezone)` before POST.
- **Citus distribution:** `appointment_requests` is distributed by `tenant`; all three new columns are non-key data columns, so migration is fine.
- **Email template storage:** templates are DB rows in `system_email_templates`, not files. Adding the Handlebars `{{#if onlineMeetingUrl}}` block requires a new migration that does an UPDATE, not a code change. Use the pattern from `20251209175019_update_appointment_email_templates_modern_styling.cjs`.
- **Client portal `appointmentRequestActions.ts`** is where unauthenticated-to-authenticated appointment handling lives; public-API created appointments still come through `/server/src/app/api/public/appointment-request/route.ts` and must not regress.
- **`/updateAppointmentRequestDateTime` already exists for pending requests**; for approved requests the analogous update happens through a different path (schedule-entry edit). Need to check both entry points emit the PATCH.

## Related prior context

- Improvement 1 (requester info display) was shipped in the same working session in `AppointmentRequestsPanel.tsx` and `EntryPopup.tsx` — the patterns for conditional rendering on `appointmentRequestData` are now established there and should be reused for the Join button.
- Improvement 1 locale keys added under `requests.detail.labels.requester` and `entryPopup.appointmentRequest.requesterInfo.*` — new Teams keys follow the same neighborhood.

## Links / references

- Microsoft Graph docs: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings
- Application Access Policy: https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy
- Our Teams integration data model (this repo): `ee/server/migrations/20260307153000_create_teams_integrations.cjs`

## Progress log

- 2026-04-23: PRD, features.json, tests.json, SCRATCHPAD created in `ee/docs/plans/2026-04-23-teams-meeting-on-appointment-approval/`. No implementation yet.
- 2026-04-23: Completed `F001` by adding `server/migrations/20260423130000_add_online_meeting_columns_to_appointment_requests.cjs`. Used guarded `hasColumn` checks so the migration is idempotent and safe to re-run in local/dev environments.
- 2026-04-23: Completed `F002` by adding `ee/server/migrations/20260423131000_add_default_meeting_organizer_to_teams_integrations.cjs`. Kept it EE-local and nullable so tenant setup remains opt-in.
- 2026-04-23: Completed `F003` by adding `createTeamsMeeting()` plus shared meeting config and Graph auth helpers under `ee/packages/microsoft-teams/src/lib/meetings/`. The helper reads `teams_integrations.default_meeting_organizer_upn`, resolves the tenant Microsoft profile, POSTs to Graph, logs success/failure, and returns `null` on any soft failure.
- 2026-04-23: Completed `F004` by adding `updateTeamsMeeting()` in the same EE meetings module. It reuses the shared tenant readiness/config resolver, PATCHes Graph with the new ISO datetimes, returns `false` on soft failure, and emits structured update logs.
- 2026-04-23: Completed `F005` by adding `deleteTeamsMeeting()` in the EE meetings module. It issues a Graph DELETE against the organizer-scoped online meeting endpoint, logs failures without throwing, and returns `false` on any soft failure.
- 2026-04-23: Completed `F006` by adding `getTeamsMeetingCapability(tenantId)` under `ee/packages/microsoft-teams/src/lib/actions/meetings/`. Capability follows the PRD contract: `ee_disabled` outside EE, `not_configured` when Teams is inactive or missing a selected profile, `no_organizer` when the organizer UPN is blank, otherwise `available: true`.
- 2026-04-23: Completed `F007` by adding `packages/scheduling/src/lib/teamsMeetingService.ts`. The scheduling package now uses a local EE dynamic-import boundary that returns CE-safe no-op handlers when enterprise code is unavailable or fails to load.

## Working notes

- Migration pattern for `appointment_requests` follows the existing guarded `alterTable` style from `20260416210000_add_requester_timezone_to_appointment_requests.cjs`.
- `teams_integrations` migration does not need a Citus redistribution step for a nullable non-key column; guarded `alterTable` is sufficient.
- Extracted Graph app-token acquisition into `ee/packages/microsoft-teams/src/lib/graphAuth.ts` so meeting helpers and notification delivery share the same OAuth client-credentials flow.
- Added `resolveTeamsMeetingExecutionConfig()` as the central place for readiness checks needed by create/update/delete helpers: install status must be `active`, `selected_profile_id` must exist, organizer UPN must be set, and the Microsoft profile must resolve as `ready`.
- Scheduling-side EE boundary mirrors the calendar-actions pattern: memoized dynamic import of `@alga-psa/ee-microsoft-teams/lib`, fallback logging on load failure, and CE no-op implementations instead of hard EE imports.
- Runbook command used for validation so far: `node -c server/migrations/20260423130000_add_online_meeting_columns_to_appointment_requests.cjs`
- Additional validation command: `node -c ee/server/migrations/20260423131000_add_default_meeting_organizer_to_teams_integrations.cjs`
- Additional validation command: `npm -w ee/packages/microsoft-teams run typecheck`
- Additional validation command: `npm -w packages/scheduling run typecheck`
