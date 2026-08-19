# Gmail Provider Setup Guide

This guide walks an administrator through connecting a Gmail mailbox to the system using tenant-owned Google OAuth + Pub/Sub.

> For background on why Pub/Sub is now initialised once, see `../architecture/pubsub.md`.

## Prerequisites

Set these up first — see [Google Cloud Prerequisites for Gmail Inbound Email](./gmail-google-cloud-prerequisites.md) for the details, including the consent-screen setting that otherwise kills the connection after seven days.

* Google Cloud project with the **Gmail API** and **Pub/Sub API** enabled.
* A tenant-owned OAuth client (Client ID + Client Secret) created in Google Cloud Console.
* A **published** OAuth consent screen.
* A tenant-owned service account key JSON (for Pub/Sub provisioning) available for upload/paste, with permission to set IAM policy on the topic.
* A publicly reachable HTTPS address for this instance. Setup fails rather than provisioning a subscription Google could never deliver to.

## End-to-End Flow

```mermaid
flowchart TD
    A[Admin configures Google integration settings] --> B[User clicks 'Authorize Access' on Gmail provider]
    B --> C[Provider draft saved (upsertEmailProvider)]
    C --> D[OAuth popup opens]
    D --> E[User grants permissions]
    E --> F[OAuth callback]
    F --> G[configureGmailProvider → setupPubSub]
    G --> H[GmailWebhookService.registerWatch]
    H --> I[Provider ready]
```

Only one call to `setupPubSub` happens at step **G**.

## Step-by-Step

1. Open **Settings → Integrations → Providers**.
2. Create (or select) a Google Cloud project and OAuth client, then configure the **redirect URI** shown in the UI.
3. Paste **Project ID**, **OAuth Client ID**, **OAuth Client Secret**, and the **service account key JSON** into the Google integration screen and save.
4. Open **Settings → Email Providers → + Add Gmail**.
5. Fill **display name**, **mailbox**, and any label filtering.
6. Click **Authorize Access** and complete the OAuth consent. The window closes automatically and setup continues.

### Refreshing Pub/Sub

If the subscription/watch expires or the webhook URL changes, use the **Refresh Watch** button or call the API:

```bash
curl -X POST \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"providerId":"<providerId>"}' \
     https://<host>/api/email/refresh-watch
```

Every run re-provisions and re-verifies: the topic, the publisher binding, the subscription's push endpoint and audience, and the Gmail watch. A response with `success: false` carries the specific failure in `error`.

## Troubleshooting

Start with **Run Gmail Delivery Diagnostics** in the provider card menu. It checks live Google state against what this instance expects and names the failing step.

* **OAuth fails** – confirm the tenant’s OAuth client includes the redirect URI shown in **Settings → Integrations → Providers**.
* **No messages arriving** – the watch expires seven days after registration and is renewed on a schedule only in Enterprise Edition. The provider card warns before and after expiry; *Refresh Pub/Sub & Watch* re-registers it.
* **Deliveries rejected as unauthorized** – the subscription's OIDC audience no longer matches this instance's address, usually after a hostname change. Diagnostics prints both values; *Refresh Pub/Sub & Watch* rewrites the push configuration.
* **Pub/Sub provisioning fails** – confirm the uploaded service account has the required IAM permissions, including `pubsub.topics.setIamPolicy`, on the tenant’s Google Cloud project.
