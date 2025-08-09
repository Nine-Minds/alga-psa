# Gmail Provider Setup Guide

This guide walks an administrator through connecting a Gmail mailbox to the system using OAuth and the new single-initialisation Pub/Sub mechanism.

> For background on why Pub/Sub is now initialised once, see `../architecture/pubsub.md`.

## Prerequisites

* Google Cloud project with Pub/Sub API enabled.
* Service-account JSON uploaded to tenant secrets (`google_service_account_key`).
* OAuth client ID & secret created in Google Cloud Console.

## End-to-End Flow

```mermaid
flowchart TD
    A[User clicks 'Authorize with Google'] --> B[Provider draft saved]
    B --> C[Backend: upsertEmailProvider(skipAutomation=false)]
    C --> D[OAuth popup opens]
    D --> E[User grants permissions]
    E --> F[OAuth callback]
    F --> G[configureGmailProvider → setupPubSub]
    G --> H[GmailWebhookService.registerWatch]
    H --> I[Provider ready]
```

Only one call to `setupPubSub` happens at step **G**.

## Step-by-Step

1. Open **Settings → Email Providers → + Add Gmail**.
2. Fill **display name** and the **Google Cloud `project_id`**.
3. Click **Authorize with Google**.
4. Complete the OAuth consent. The window closes automatically.
5. Back in the form click **Save** – notice this no longer touches Pub/Sub; it only updates friendly metadata.

### Refreshing Pub/Sub

If the subscription expires or the webhook URL changes, use the **Refresh Pub/Sub** button or call the API:

```bash
curl -X POST \
     -H "Authorization: Bearer <admin-token>" \
     https://<host>/api/email-providers/<providerId>/refresh-pubsub
```

This bypasses the 24-hour cool-down by setting `force=true`.

## Troubleshooting

* **No messages arriving** – check `google_email_provider_config.pubsub_initialised_at` and ensure it is recent. Use *Refresh Pub/Sub* if older than 7 days.
* **Google Cloud “rate limit” errors** – indicates multiple initialisation attempts; verify only one backend node is running migrations or redeploys.

