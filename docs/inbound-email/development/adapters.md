# Email Provider Adapters – Developer Guide

This document explains how provider-specific adapters (e.g. `GmailAdapter`, `MicrosoftAdapter`) are structured and what **NOT** to do after the Pub/Sub refactor.

## Responsibilities

| Layer | Responsibilities | Must **not** |
|-------|------------------|--------------|
| Adapter (`GmailAdapter.ts`) | • Refresh & cache OAuth tokens  <br>• Fetch / send messages  <br>• Register or renew **Gmail watch** only | Create / modify Pub/Sub topics or subscriptions |
| Orchestrator (`configureGmailProvider.ts`) | • One-time call to `setupPubSub`  <br>• Calculate standard topic / subscription names  <br>• Call `GmailAdapter.registerWebhookSubscription()` | Talk directly to Gmail API for message operations |

## Adding / Modifying an Adapter

1. **Implement Base Methods** – extend `BaseEmailAdapter` and provide `connect`, `getMessage`, `sendMessage`, etc.
2. **Implement `registerWebhookSubscription`**
   * For Gmail this calls `gmail.users.watch()`.
   * For Microsoft this calls the Graph `subscriptions` endpoint.
   * Do *not* touch Google Pub/Sub or Azure EventGrid – the orchestrator handles infrastructure.
3. **Persist any IDs / expiration** into `<vendor>_email_provider_config`.

### Example: GmailAdapter.registerWebhookSubscription

```ts
async registerWebhookSubscription() {
  await this.ensureValidToken();
  const { project_id, pubsub_topic_name } = this.config.provider_config;
  const topic = `projects/${project_id}/topics/${pubsub_topic_name}`;

  await this.gmail.users.watch({
    userId: 'me',
    requestBody: { topicName: topic, labelIds: ['INBOX'] }
  });
  // Save historyId & expiration …
}
```

## Testing

See `development/testing.md` for unit and E2E recipes. The most important unit test is that **no adapter** invokes `setupPubSub`.

