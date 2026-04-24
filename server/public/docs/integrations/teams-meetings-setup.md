# Microsoft Teams Meetings Setup

This is the browser-served copy of the Teams meetings runbook.

Canonical source:

- `docs/integrations/teams-meetings-setup.md`

## Quick setup

1. Grant Microsoft Graph application permission `OnlineMeetings.ReadWrite.All`.
2. Create an Application Access Policy for the organizer account.
3. Save the organizer in `Scheduling -> Availability Settings -> Teams Meetings`.
4. Click `Verify` after policy propagation.

## PowerShell example

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

## References

- Microsoft Graph online meetings: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings
- Application Access Policy: https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy
