# API Reference – Inbound Email

Canonical reference for all HTTP endpoints and callback payloads used by the inbound-email feature.

## 1. OAuth

### Initiate OAuth

`POST /api/email/oauth/initiate`

| Body              | Type   | Description |
|-------------------|--------|-------------|
| providerId        | string | Draft provider record ID |
| successRedirect   | string | URL to redirect popup on success |

### Callback

`GET /api/email/oauth/google/callback`

Upon success the endpoint stores tokens, then calls
`configureGmailProvider(providerId, { tenant, force:false })`.

#### Query Parameters

| Param | Desc |
|-------|------|
| code  | OAuth grant code |
| state | Encrypted JSON with tenant, user, nonce |

## 2. Refresh Watch (Pub/Sub + Gmail Watch)

`POST /api/email/refresh-watch`

Triggers `configureGmailProvider({ force:true })` for a specific Gmail provider.

| Body       | Type   | Description |
|------------|--------|-------------|
| providerId | string | Gmail provider record ID |

## 3. skipAutomation Flag

`upsertEmailProvider` and `updateEmailProvider` now accept an **optional** JSON key :

```json
{
  "skipAutomation": true
}
```

When true, Pub/Sub orchestration is skipped; used by UI **Save** button to avoid extra initialisations.
