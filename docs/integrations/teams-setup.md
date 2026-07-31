# Microsoft Teams Integration Setup

This runbook takes a tenant from zero to a verified, working Microsoft Teams integration: personal tab, bot, message extension, activity-feed notifications, and Teams meetings with recording/transcript capture. Meeting-organizer specifics (Exchange and Teams application access policies, organizer mailbox scoping) live in [Microsoft Teams Meetings Setup](teams-meetings-setup.md); this document links there rather than repeating them.

The Teams integration is an Enterprise Edition add-on. The setup wizard in `Settings -> Integrations -> Microsoft Teams` walks through the same steps and links back to the sections below.

## Overview

The integration authenticates on two separate planes. Understanding this split prevents the most common failure: a bot that never replies.

```
Plane 1: Microsoft Graph (per tenant)
  Alga PSA --client_credentials--> login.microsoftonline.com/<profile tenant_id>
           --app token-----------> graph.microsoft.com
  Credentials: the tenant's Microsoft profile
  (client ID, directory/tenant ID, client secret; selected in Teams settings)
  Used for: meetings, recordings/transcripts, activity-feed notifications

Plane 2: Bot Framework (global, per deployment)
  Teams ----activity + JWT-------> <base-url>/api/teams/bot/messages
  Alga PSA --client_credentials--> login.microsoftonline.com/<TEAMS_BOT_APP_TENANT_ID>
           --bot token-----------> Bot Framework serviceUrl (replies, proactive messages)
  Credentials: TEAMS_BOT_APP_ID, TEAMS_BOT_APP_TENANT_ID, TEAMS_BOT_APP_PASSWORD
  (environment variables on the Alga PSA server)
  Used for: bot commands, message extension, quick actions, bot DM notifications
```

Every inbound Teams request (bot messages, message-extension queries, quick actions) carries a Bot Framework JWT. Alga PSA verifies the token against `TEAMS_BOT_APP_ID` as the audience and rejects the request otherwise. When the `TEAMS_BOT_APP_*` variables are unset, Alga PSA rejects all inbound Teams traffic with `403`. There is no unauthenticated fallback.

The generated Teams app manifest registers the bot under the tenant's Microsoft profile client ID. Teams addresses all activities to that manifest bot ID. This is why the manifest bot ID and `TEAMS_BOT_APP_ID` must be the same app registration; see [step 3](#3-register-the-azure-bot-and-set-bot-credentials).

## Prerequisites

- Alga PSA Enterprise Edition with the Microsoft Teams add-on enabled for the tenant.
- An Alga PSA deployment reachable over public HTTPS. `NEXT_PUBLIC_BASE_URL` (or `NEXTAUTH_URL`) must be set to that URL; the Teams app package and webhook URLs are derived from it.
- Admin access to the Microsoft Entra admin center and the Azure portal.
- Permission to upload custom apps in the Teams admin center (or a Teams custom-app policy that allows sideloading).
- An Alga PSA user with `system_settings` update permission for the configuration steps.
- For meetings: the prerequisites in [Microsoft Teams Meetings Setup](teams-meetings-setup.md).

## 1. Create the Entra app registration

In the Microsoft Entra admin center:

1. Open `App registrations` and create a new registration (or reuse an existing one already used by the tenant's Microsoft profile).
2. Under `Authentication`, add these **Web** redirect URIs. Replace `<base-url>` with your deployment URL:
   - `<base-url>/api/auth/callback/azure-ad`
   - `<base-url>/api/teams/auth/callback/tab`
   - `<base-url>/api/teams/auth/callback/bot`
   - `<base-url>/api/teams/auth/callback/message-extension`
3. Under `Expose an API`, set the Application ID URI to:
   - `api://<base-url-host>/teams/<client-id>`

   For example, with base URL `https://psa.acme.com` and client ID `11111111-2222-3333-4444-555555555555`, the value is `api://psa.acme.com/teams/11111111-2222-3333-4444-555555555555`. This value must match the `webApplicationInfo.resource` in the generated manifest; Alga PSA computes it from the deployment base URL and the profile client ID.
4. Under `Certificates & secrets`, create a client secret and record it.

`Settings -> Integrations -> Microsoft` shows the exact redirect URIs and the Teams application ID URI for each profile under `Microsoft app registration guidance`, so you can copy them instead of assembling them by hand.

The first redirect URI serves Microsoft sign-in for the MSP portal; the three `api/teams/auth/callback/*` URIs are where the Teams tab, bot, and message-extension sign-in popups land. Users must sign in with Microsoft at least once so Alga PSA can map their Microsoft account to their PSA user; notifications and bot commands depend on that mapping.

## 2. Grant Graph application permissions

Still in the app registration, open `API permissions` and add these Microsoft Graph **application** permissions:

| Permission | Used for |
|---|---|
| `Calendars.ReadWrite` | Create, update, and delete calendar-backed Teams meetings on the organizer mailbox (`/users/{organizer}/events`) |
| `OnlineMeetings.Read.All` | Resolve the online meeting behind an event's join link (`/users/{organizer}/onlineMeetings`) |
| `OnlineMeetingRecording.Read.All` | Recording change-notification subscriptions and downloads |
| `OnlineMeetingTranscript.Read.All` | Transcript change-notification subscriptions and downloads |
| `TeamsActivity.Send` | Activity-feed notifications (`/users/{id}/teamwork/sendActivityNotification`) |
| `User.Read.All` | Resolve and verify the meeting organizer account (`/users/{upn}`) |

Then click `Grant admin consent`.

Notes:

- `OnlineMeetingRecording.Read.All` and `OnlineMeetingTranscript.Read.All` are protected APIs; Microsoft may require an approval flow before they work in production tenants.
- The [meetings runbook](teams-meetings-setup.md#1-grant-graph-application-permission) additionally lists `OnlineMeetings.ReadWrite.All`, which its legacy verification round-trip uses.
- The generated Teams app manifest also declares the resource-specific application permission `TeamsActivity.Send.User`; Teams grants it when the app is installed, so there is nothing to configure for it here.

App-only calendar and meeting access must also be scoped and allowed on the Microsoft 365 side. Follow the meetings runbook for the [Exchange Application Access Policy](teams-meetings-setup.md#2-scope-calendar-access-to-the-organizer-mailbox) and the [Teams Application Access Policy](teams-meetings-setup.md#3-create-a-teams-application-access-policy). Without them, meeting creation returns `403` even with the Graph permissions above.

## 3. Register the Azure Bot and set bot credentials

### One app registration, three places

> **This is the most common way a Teams bot setup fails.** Three values must all refer to the **same** app registration:
>
> 1. The **manifest bot ID** in the generated Teams app package. Alga PSA sets it to the selected Microsoft profile's client ID.
> 2. The **Microsoft App ID** of the Azure Bot resource.
> 3. The **`TEAMS_BOT_APP_ID`** environment variable on the Alga PSA server.
>
> Teams addresses activities to the manifest bot ID and presents tokens issued for it. Alga PSA only accepts inbound tokens whose audience equals `TEAMS_BOT_APP_ID`, and signs outbound replies as `TEAMS_BOT_APP_ID`. If the values differ, every inbound request is rejected with `401` and the bot never replies. The `bot_id_consistency` diagnostics step ([step 7](#7-verify)) detects this mismatch.

The two supported ways to satisfy this:

- **Self-hosted / single tenant.** Use the app registration from [step 1](#1-create-the-entra-app-registration) for everything: the tenant's Microsoft profile, the Azure Bot, and the `TEAMS_BOT_APP_*` variables. One registration carries both the Graph permissions and the bot identity.
- **Hosted / multiple tenants on one deployment.** The `TEAMS_BOT_APP_*` variables are global to the deployment, so all tenants share one bot app registration owned by the hosting operator. Register it as a multi-tenant application. Every tenant's Teams-selected Microsoft profile must use that shared application (client) ID, with the profile's directory (tenant) ID set to the customer's own Entra tenant and admin consent granted there. A tenant whose selected profile has any other client ID generates a manifest addressed to a bot this deployment will never answer.

### Create the Azure Bot resource

In the Azure portal:

1. Create an **Azure Bot** resource.
2. Under `Type of App`, match the app registration (single tenant or multi tenant), choose `Use existing app registration`, and enter the app registration's client ID as the Microsoft App ID.
3. Under `Configuration`, set the messaging endpoint to:
   - `<base-url>/api/teams/bot/messages`
4. Under `Channels`, enable the **Microsoft Teams** channel.

The message extension and quick actions authenticate through this same bot registration; only the messaging endpoint above needs to be registered.

### Set the environment variables

Set these in the Alga PSA server environment and restart:

```bash
TEAMS_BOT_APP_ID=<app registration client ID>
TEAMS_BOT_APP_TENANT_ID=<directory (tenant) ID that owns the app registration>
TEAMS_BOT_APP_PASSWORD=<a client secret of that app registration>
```

All three are required. With any of them missing, Alga PSA fails closed: inbound Teams requests get `403`, and outbound bot sends are skipped with reason `teams_bot_credentials_not_configured`.

## 4. Configure and activate Teams in Alga PSA

In the MSP app, go to `Settings -> Integrations -> Microsoft`:

1. Create a Microsoft profile with the client ID, directory (tenant) ID, and client secret from step 1, or confirm the existing profile is ready.

Then go to `Settings -> Integrations -> Microsoft Teams`:

2. Select that Microsoft profile for Teams.
3. Enable the capabilities you want: personal tab, personal bot, group chat bot, message extension, activity notifications. Diagnostics expects at least `personal_bot` and `activity_notifications`.
4. Choose the notification categories (assignments, customer replies, approval requests, escalations, SLA risk) and, per category, the delivery channel: activity feed, bot DM, or both.
5. Decide whether `Send calendar invites to participants` stays on. When on, meeting attendees receive real Outlook/Teams calendar invites from the organizer account; when off, meetings are created without attendees and participants only get the join link.
6. For meetings, set the default meeting organizer UPN as described in the [meetings runbook](teams-meetings-setup.md#4-save-the-organizer-in-alga-psa).
7. Save, then activate the integration.

## 5. Generate and upload the Teams app package

Still in `Settings -> Integrations -> Microsoft Teams`:

1. Click `Generate` to build the app package metadata. This records the manifest bot ID (the selected profile's client ID) and the deployment base URL.
2. Download the package. You get `alga-psa-teams-<tenant-id>.zip` containing `manifest.json`, `color.png`, and `outline.png` (manifest schema `1.24`, package version `1.0.1`).
3. Upload it to Teams:
   - **Org-wide (recommended):** Teams admin center -> `Teams apps -> Manage apps -> Upload new app`. Then allow the app for the users who need it. Users find it under `Apps -> Built for your org`.
   - **Sideload (testing):** in the Teams client, `Apps -> Manage your apps -> Upload an app -> Upload a custom app`. This requires a custom-app policy that permits sideloading.

Regenerate and re-upload the package whenever the deployment base URL or the selected Microsoft profile changes. A stale package points Teams at the wrong host or the wrong bot; the `package_metadata` and `bot_id_consistency` diagnostics steps flag this.

## 6. Configure the recordings webhook

Recording and transcript capture relies on Microsoft Graph change notifications delivered to a public webhook. Alga PSA resolves the webhook URL from the first of these that is set:

1. `TEAMS_RECORDINGS_WEBHOOK_URL`
2. `TEAMS_WEBHOOK_BASE_URL`
3. `PUBLIC_WEBHOOK_BASE_URL`
4. `NEXT_PUBLIC_BASE_URL`
5. `NEXTAUTH_URL`

If the value is a base URL, Alga PSA appends `/api/teams/webhooks/recordings`. The resulting URL must be HTTPS and publicly reachable; Microsoft Graph validates it when the subscription is created and refuses non-HTTPS endpoints. If your server sits behind a proxy or non-public hostname, set `TEAMS_RECORDINGS_WEBHOOK_URL` explicitly.

Alga PSA subscribes to `communications/onlineMeetings/getAllRecordings` and `communications/onlineMeetings/getAllTranscripts`. Subscriptions live for 60 hours; the `renew-teams-meeting-artifact-subscriptions` job renews them, and meeting creation also ensures they exist. You do not create them by hand; verify them in the next step.

## 7. Verify

### Run diagnostics

In `Settings -> Integrations -> Microsoft Teams`, click `Run diagnostics`. The report runs these steps:

| Step id | Checks |
|---|---|
| `addon_entitlement` | The Teams add-on is active for the tenant |
| `integration_status` | The integration is saved and `active` |
| `capabilities` | `personal_bot` and `activity_notifications` are enabled |
| `microsoft_profile` | The selected profile exists, is not archived, and has credentials |
| `recording_permissions` | An organizer is configured with a resolved object ID; lists the required recording permissions |
| `package_metadata` | The app package was generated with a resolvable base URL |
| `bot_connector` | `TEAMS_BOT_APP_*` variables are configured |
| `bot_id_consistency` | The generated manifest bot ID equals `TEAMS_BOT_APP_ID` |
| `artifact_subscriptions` | Recording/transcript subscriptions exist and are not expired or about to expire |
| `webhook_reachability` | The recordings webhook URL resolves and answers an HTTPS probe |
| `user_linkage` | The current admin has a linked Microsoft account |
| `conversation_reference` | The current admin has messaged the bot at least once |
| `recent_delivery_health` | The most recent Teams delivery did not fail |

Fix any `fail` results before moving on; each step includes a recommendation.

### Send a test message

1. In Teams, open the Alga PSA app and send the bot any message. This stores the conversation reference the test needs.
2. Back in Teams settings, click `Send test message`. A hero card titled `Alga PSA Teams test message` should arrive as a bot DM within seconds.

The result records a delivery row you can inspect in the delivery log in the Teams settings area, alongside the audit log.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Bot never replies to anything; server logs show `403` with `bot_connector_not_configured` | `TEAMS_BOT_APP_*` variables are unset. Alga PSA rejects all inbound Teams traffic when bot credentials are missing | Set all three variables ([step 3](#3-register-the-azure-bot-and-set-bot-credentials)) and restart. Confirm with the `bot_connector` diagnostics step |
| Bot never replies; server logs show `401` rejections on `/api/teams/bot/messages` | The manifest bot ID (selected profile client ID) differs from `TEAMS_BOT_APP_ID`, so inbound token audiences fail verification. Or the Azure Bot's Microsoft App ID is a third, different app | Run diagnostics; `bot_id_consistency` names both IDs. Make the profile client ID, Azure Bot Microsoft App ID, and `TEAMS_BOT_APP_ID` the same app registration, then regenerate and re-upload the package if the manifest side changed |
| Bot receives commands but replies fail; logs show `Failed to acquire Bot Framework token` | Wrong `TEAMS_BOT_APP_PASSWORD` or `TEAMS_BOT_APP_TENANT_ID`, or the client secret expired | Issue a new client secret on the bot app registration and update the environment |
| Test message skipped with `missing_conversation_reference` | The admin has never messaged the bot, so there is no conversation to post into | Open the Alga PSA bot in Teams, send it any message, retry |
| Test message skipped with `missing_user_linkage`; deliveries show `user_not_mapped` | The recipient has not signed in to Alga PSA with Microsoft, so no account mapping exists | Have the user sign in with Microsoft (MSP portal SSO or the Teams tab sign-in) |
| Approval succeeds but the appointment has no Teams join link | Graph meeting creation failed or was skipped; the approval itself does not fail. Common causes: missing organizer UPN, missing `Calendars.ReadWrite` consent, missing access policies | Check `Settings -> Integrations -> Microsoft Teams` for the organizer, re-check [step 2](#2-grant-graph-application-permissions) and the [meetings runbook](teams-meetings-setup.md); server logs carry `[TeamsMeetings]` entries with the Graph error. Use the retry action on the approved request to generate the meeting again |
| Recordings or transcripts never appear | Subscriptions were never created or expired, or Microsoft Graph cannot reach the webhook | Run diagnostics: `artifact_subscriptions` and `webhook_reachability`. Set `TEAMS_RECORDINGS_WEBHOOK_URL` to a public HTTPS URL ([step 6](#6-configure-the-recordings-webhook)) and confirm the renewal job runs |
| A recording is listed but the download/play button returns `404` or `403` | Graph can enumerate the recording but not stream its content: the organizer's mailbox is not covered by the Teams/Exchange application access policy, or `OnlineMeetingRecording.Read.All` lacks admin consent. (Downloads use the Graph `/recordings/{id}/content` endpoint, not the AMS `recordingContentUrl`, so a policy gap surfaces here.) | Re-check [step 2](#2-grant-graph-application-permissions) consent and the [Teams Application Access Policy](teams-meetings-setup.md#3-create-a-teams-application-access-policy) scoping the organizer mailbox. Server logs carry the Graph status |
| Recordings play but you want them stored in Alga rather than proxied live | `Download recordings` is off, so Alga streams from Graph on each request instead of persisting a copy | Enable `Download recordings` in Teams settings. Newly captured recordings are then stored via the file service (and survive a later Graph content outage); enable `Expose recordings in client portal` if client-portal users should see them |
| Activity notifications not arriving; delivery log shows `graph_unauthorized` | `TeamsActivity.Send` application permission not consented, or the Graph token was rejected (`401`/`403`) | Re-check [step 2](#2-grant-graph-application-permissions) and grant admin consent |
| Delivery log shows `graph_not_found` | The Teams app is not installed for the recipient, so Graph cannot target them | Install (or org-allow) the app for that user ([step 5](#5-generate-and-upload-the-teams-app-package)) |
| Delivery log shows `addon_inactive` | The Teams add-on expired or was disabled; sends are skipped but configuration is preserved | Renew the add-on |
| Delivery log shows `package_misconfigured` | The app package was never generated, or delivery prerequisites (app ID, base URL) are missing | Generate the package in Teams settings, then retry |
| Delivery log shows `graph_throttled` or `graph_server_error` | Microsoft Graph throttling (`429`) or a Graph outage (`5xx`); these retry | Wait; investigate only if they persist |
| Calendar invites not received by participants | `Send calendar invites to participants` is off, or the invite landed in spam | Turn the toggle on in Teams settings. Give the organizer mailbox a clear display name (for example `Acme Scheduling`) so invites read sensibly and pass spam filtering |

## References

- [Microsoft Teams Meetings Setup](teams-meetings-setup.md) — organizer account, access policies, and meeting behavior
- Azure Bot creation: https://learn.microsoft.com/en-us/azure/bot-service/abs-quickstart
- Upload custom apps in the Teams admin center: https://learn.microsoft.com/en-us/microsoftteams/upload-custom-apps
- Graph activity-feed notifications: https://learn.microsoft.com/en-us/graph/teams-send-activityfeednotifications
- Graph change notifications for meeting recordings/transcripts: https://learn.microsoft.com/en-us/graph/teams-changenotifications-callrecording-and-calltranscript
