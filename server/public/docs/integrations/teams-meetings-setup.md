# Microsoft Teams Meetings Setup

This is the browser-served copy of the Teams meetings runbook.

Canonical source:

- `docs/integrations/teams-meetings-setup.md`

## Quick setup

1. Grant Microsoft Graph application permissions `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite.All`, `OnlineMeetingRecording.Read.All`, and `OnlineMeetingTranscript.Read.All`.
2. Scope `Calendars.ReadWrite` to the organizer mailbox with Exchange Application Access Policy or Exchange RBAC for Applications.
3. Create a Teams Application Access Policy for the organizer account.
4. Save the organizer UPN in `Settings -> Integrations -> Microsoft Teams`.
5. Run Teams diagnostics after policy propagation. Microsoft says Teams policy changes can take up to 30 minutes to affect Graph calls.

Recording and transcript APIs are protected/metered Microsoft Graph APIs. Complete any Microsoft approval flow required for production tenants before enabling artifact capture.

## Exchange mailbox scope example

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

Teams Application Access Policy does not scope calendar access; mailbox scoping is configured in Exchange.

## Teams Application Access Policy example

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

## References

- Microsoft Graph events: https://learn.microsoft.com/en-us/graph/api/user-post-events
- Microsoft Graph online meetings: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings
- Application Access Policy: https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy
- Exchange Application Access Policy: https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access
