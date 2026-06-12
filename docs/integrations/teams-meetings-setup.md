# Microsoft Teams Meetings Setup

This runbook enables calendar-backed Teams meeting creation and recording/transcript capture.

## Prerequisites

- A tenant with the Teams integration installed and `install_status = active`.
- A Microsoft app registration already used by the tenant's Teams integration.
- A dedicated organizer account, for example `scheduling@acme.com`.
- PowerShell access to Microsoft Teams / Skype for Business Online cmdlets for Teams Application Access Policy management.
- Exchange Online PowerShell access for mailbox-scoping the app's calendar permission.

## 1. Grant Graph application permission

In Microsoft Entra admin center:

1. Open `App registrations`.
2. Select the app used by the tenant's Teams integration.
3. Open `API permissions`.
4. Add these Microsoft Graph **application** permissions:
   - `Calendars.ReadWrite`
   - `OnlineMeetings.ReadWrite.All`
   - `OnlineMeetingRecording.Read.All`
   - `OnlineMeetingTranscript.Read.All`
5. Grant admin consent.

`OnlineMeetingRecording.Read.All` and `OnlineMeetingTranscript.Read.All` are protected/metered APIs. Microsoft may require an approval flow before they work in production tenants.

Without these permissions, Graph meeting creation or recording/transcript refresh returns `403`.

## 2. Scope calendar access to the organizer mailbox

`Calendars.ReadWrite` is tenant-wide Graph application consent. Scope it on the Exchange side so the app can only read/write the dedicated organizer mailbox.

Use Exchange Application Access Policy or Exchange RBAC for Applications, depending on the tenant's Microsoft 365 configuration. Example Application Access Policy flow:

```powershell
Connect-ExchangeOnline

$appId = "<your-app-registration-client-id>"
$organizerUpn = "scheduling@acme.com"

New-ApplicationAccessPolicy `
  -AppId $appId `
  -PolicyScopeGroupId "Alga-Teams-Meeting-Organizers@acme.com" `
  -AccessRight RestrictAccess `
  -Description "Restrict Alga PSA calendar access to Teams meeting organizer mailboxes"

Test-ApplicationAccessPolicy `
  -Identity $organizerUpn `
  -AppId $appId
```

The scoped group should contain only the organizer mailbox account(s). Teams Application Access Policy does not scope calendar access.

## 3. Create a Teams Application Access Policy

App-only meeting creation must be explicitly allowed for the organizer account.

```powershell
Connect-MicrosoftTeams

$appId = "<your-app-registration-client-id>"
$organizerUpn = "scheduling@acme.com"
$organizerObjectId = (Get-CsOnlineUser -Identity $organizerUpn).ExternalDirectoryObjectId

New-CsApplicationAccessPolicy `
  -Identity "Alga-Appointment-Meetings" `
  -AppIds $appId `
  -Description "Allow Alga PSA to create appointment meetings"

Grant-CsApplicationAccessPolicy `
  -PolicyName "Alga-Appointment-Meetings" `
  -Identity $organizerObjectId
```

Wait up to 30 minutes for policy propagation before verification.

## 4. Save the organizer in Alga PSA

In the MSP app:

1. Go to `Settings -> Integrations -> Microsoft Teams`.
2. Enter the organizer UPN in `Default meeting organizer UPN`.
3. Enable `Download recordings to internal storage` only if the tenant wants Alga PSA to copy recording blobs into tenant storage.
4. Enable `Show recordings and transcripts in the client portal` only if client users should see meeting artifacts. This is off by default.
5. Save Teams settings.

Saving resolves and stores the organizer's Microsoft Entra object ID for Graph recording/transcript calls.

## 5. Run diagnostics

In `Settings -> Integrations -> Microsoft Teams`, click `Run diagnostics`.

The diagnostics panel reports:

- Whether the Teams add-on and integration are active.
- Whether a Microsoft profile and Teams package are configured.
- Whether the organizer can be resolved for recording/transcript capture.
- The recording/transcript permission checklist: `Calendars.ReadWrite`, `OnlineMeetingRecording.Read.All`, `OnlineMeetingTranscript.Read.All`, and Exchange mailbox scoping.

## 6. Legacy verification

Older builds exposed a verify button in `Scheduling -> Availability Settings -> Teams Meetings`.

If you are running that build:

1. Enter the organizer's Microsoft Entra user object ID.
2. Click `Save`.
3. Click `Verify`.

Verification does two checks:

- `GET /users/{id}` to confirm the Microsoft user exists.
- A short create/delete meeting round-trip to confirm the Application Access Policy is actually allowing app-only meeting creation.

## 7. Expected behavior after setup

- MSP approvers see the `Generate Microsoft Teams meeting link` toggle during approval.
- Approved-client and assigned-technician emails include a Teams join button when the toggle stays enabled.
- ICS attachments include:
  - `LOCATION: Microsoft Teams Meeting`
  - `URL: <join link>`
  - `DESCRIPTION: Join Teams Meeting: <join link>`
- Rescheduling PATCHes the same Teams meeting.
- Cancel / delete attempts to remove the Teams meeting as well.
- After a recorded meeting ends, `Refresh recordings` can populate transcript documents and recording proxy links.

## Troubleshooting

### Verify says the user was not found

- Confirm the value in Teams settings is the organizer UPN and that saving Teams settings resolved an object ID.
- Test the account directly in Graph:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/users/<organizer-object-id>"
```

### Verify says the policy is missing

- Re-run `Grant-CsApplicationAccessPolicy` for the organizer account.
- Confirm the policy references the same app registration client ID used by the tenant's Teams integration.
- Wait for propagation and try `Verify` again.

### Approvals succeed but no meeting is attached

- Check app permission consent for `OnlineMeetings.ReadWrite.All`.
- Check the tenant's `default_meeting_organizer_upn`.
- Review server logs for `[TeamsMeetings]` entries with `operation=create`.

### Refresh recordings returns no artifacts or 403

- Confirm admin consent for `OnlineMeetingRecording.Read.All` and `OnlineMeetingTranscript.Read.All`.
- Confirm `Calendars.ReadWrite` is granted and scoped to the organizer mailbox through Exchange Application Access Policy or RBAC for Applications.
- Confirm the meeting was created by Alga PSA as a calendar-backed event. Legacy standalone meetings cannot reliably return artifacts.
- Confirm the tenant's Teams recording policies allow recording/transcript generation.

## References

- Microsoft Graph events: https://learn.microsoft.com/en-us/graph/api/user-post-events
- Microsoft Graph online meetings: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings
- Application Access Policy: https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy
- Exchange Application Access Policy: https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access
