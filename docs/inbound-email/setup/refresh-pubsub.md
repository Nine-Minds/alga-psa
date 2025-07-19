# Refresh Pub/Sub – Admin Guide

If a Gmail provider stops receiving webhook notifications (e.g. after 7-day Gmail watch expiry or if the push endpoint URL changed) run a **Refresh Pub/Sub**.  This will:

1. Re-initialise the Pub/Sub topic & subscription (bypassing the 24-hour guard).
2. Register a fresh Gmail `users.watch` subscription.

## Using the UI

Settings → Email Providers → ••• → **Refresh Pub/Sub**

The action shows a spinner and writes an audit log entry on completion.

## Using the API

```bash
curl -X POST \
     -H "Authorization: Bearer <admin-token>" \
     https://<host>/api/email-providers/<providerId>/refresh-pubsub
```

`200 OK` signals success.

## When to Use

* “Not receiving emails” but OAuth tokens are valid.
* Google Cloud Console shows the subscription in a **deleted** state.
* After changing the application base URL in production.

> Running the refresh multiple times in a row is safe; the operation is idempotent.

