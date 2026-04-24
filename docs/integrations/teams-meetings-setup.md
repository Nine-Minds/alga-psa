# Microsoft Teams Meetings Setup

This runbook enables automatic Teams meeting creation for approved appointment requests.

## Prerequisites

- A tenant with the Teams integration installed and `install_status = active`.
- A Microsoft app registration already used by the tenant's Teams integration.
- A dedicated organizer account, for example `scheduling@acme.com`.
- PowerShell access to Microsoft Teams / Skype for Business Online cmdlets for Application Access Policy management.

## 1. Grant Graph application permission

In Microsoft Entra admin center:

1. Open `App registrations`.
2. Select the app used by the tenant's Teams integration.
3. Open `API permissions`.
4. Add the Microsoft Graph **application** permission `OnlineMeetings.ReadWrite.All`.
5. Grant admin consent.

Without this permission, Graph meeting creation returns `403`.

## 2. Create an Application Access Policy

App-only meeting creation must be explicitly allowed for the organizer account.

```powershell
Connect-MicrosoftTeams

$appId = "<your-app-registration-client-id>"
$organizerUpn = "scheduling@acme.com"

New-CsApplicationAccessPolicy `
  -Identity "Alga-Appointment-Meetings" `
  -AppIds $appId `
  -Description "Allow Alga PSA to create appointment meetings"

Grant-CsApplicationAccessPolicy `
  -PolicyName "Alga-Appointment-Meetings" `
  -Identity $organizerUpn
```

Wait roughly 5 to 10 minutes for policy propagation before verification.

## 3. Save the organizer in Alga PSA

In the MSP app:

1. Go to `Scheduling -> Availability Settings -> Teams Meetings`.
2. Enter the organizer UPN or Microsoft user ID.
3. Click `Save`.
4. Click `Verify`.

Verification does two checks:

- `GET /users/{upn}` to confirm the Microsoft user exists.
- A short create/delete meeting round-trip to confirm the Application Access Policy is actually allowing app-only meeting creation.

## 4. Expected behavior after setup

- MSP approvers see the `Generate Microsoft Teams meeting link` toggle during approval.
- Approved-client and assigned-technician emails include a Teams join button when the toggle stays enabled.
- ICS attachments include:
  - `LOCATION: Microsoft Teams Meeting`
  - `URL: <join link>`
  - `DESCRIPTION: Join Teams Meeting: <join link>`
- Rescheduling PATCHes the same Teams meeting.
- Cancel / delete attempts to remove the Teams meeting as well.

## Troubleshooting

### Verify says the user was not found

- Confirm the value in Availability Settings is the organizer's UPN or Microsoft user ID.
- Test the account directly in Graph:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/users/scheduling@acme.com"
```

### Verify says the policy is missing

- Re-run `Grant-CsApplicationAccessPolicy` for the organizer account.
- Confirm the policy references the same app registration client ID used by the tenant's Teams integration.
- Wait for propagation and try `Verify` again.

### Approvals succeed but no meeting is attached

- Check app permission consent for `OnlineMeetings.ReadWrite.All`.
- Check the tenant's `default_meeting_organizer_upn`.
- Review server logs for `[TeamsMeetings]` entries with `operation=create`.

## References

- Microsoft Graph online meetings: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings
- Application Access Policy: https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy
