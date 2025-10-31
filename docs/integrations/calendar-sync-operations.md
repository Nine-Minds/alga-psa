# Calendar Sync Operations Runbook

This runbook covers the day-to-day operational tasks for the Google and Microsoft calendar integrations. It pairs with the UI updates delivered in Phase 4 so operators can onboard tenants, monitor sync health, and respond to incidents without engineering support.

## Prerequisites
- Tenants must have OAuth apps configured and approved by the vendor (Client ID, Client Secret, redirect URI).
- Background jobs MUST be running so webhook renewals and delta token updates proceed automatically.
- Verify Redis and the `CALENDAR_OAUTH_ENCRYPTION_KEY`/`NEXTAUTH_SECRET` variables are present in the environment.

## Connecting A Provider
1. Navigate to **Settings → Calendar Integrations**.
2. Select either **Add Google Calendar** or **Add Outlook Calendar**.
3. Complete the configuration form:
   - Give the provider an operator-friendly name.
   - Supply the external calendar identifier (use `primary` for the default Google calendar or `calendar` for Outlook).
   - Choose the desired sync direction and enable the provider.
4. Press **Authorize**. A vendor popup appears; complete the OAuth consent flow.
5. After a successful callback you will see the `OAuth Complete` badge. Save the form to persist changes.

## Monitoring Sync Health
- Each provider card now shows **Connection Status**, **OAuth badge**, **Last Sync**, and **Sync Direction** at a glance.
- Trigger a manual sync with **Sync Now**. While the job executes the button displays `Syncing…` and a spinner badge appears.
- Successful runs emit a green confirmation banner; any issues surface as a red alert and the provider status flips to `Error` until the next healthy sync.
- Error text in the card mirrors backend status details, making it easy to copy into incident tickets.

## Conflict Handling
- When both systems edit the same entry the subscriber marks the mapping as `Conflict` and emits a notification event.
- UI surfaces show `Conflict` badges and direct users back to Calendar Settings to resolve.
- Operators should review the mapping, decide which side wins, and re-run the manual sync once conflict remediation is complete.

## Deleting A Provider
1. Select **Delete** in the provider card.
2. A confirmation dialog explains the blast radius (webhooks removed, sync halted). Confirm to proceed.
3. The provider is removed and a toast confirms success. Any scheduled jobs referencing the provider will skip automatically.

## Troubleshooting Checklist
- **Authorization failures**: ensure the OAuth popup is not blocked and that tenant secrets are valid.
- **Stale last sync**: run a manual sync to force a pass; if the timestamp does not advance check webhook subscriptions.
- **Webhook errors**: consult the `calendar-webhook-maintenance` job logs. Renew subscriptions via the job handler and re-queue any stuck messages.
- **Multi-tenant bleed**: confirm the provider belongs to the active tenant. All actions enforce tenant scoping; mismatches result in `Forbidden` errors.
- **Conflicts stuck**: if repeated conflicts appear, reset the mapping’s `sync_status` through the conflict resolution workflow and retry.

## Escalation
- Pager duty rotation: **Platform Integrations**.
- Slack channel: `#calendar-sync-ops` (monitor for automated alerts from the webhook maintenance job).
- Include provider name, tenant, last sync timestamp, and any alert messages when escalating.
