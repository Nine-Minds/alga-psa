# Tactical RMM Webhook Contract (Alert Actions)

Endpoint:
- `POST /api/webhooks/tacticalrmm?tenant=<TENANT_UUID>`

Auth:
- Header name: `X-Alga-Webhook-Secret`
- Header value: per-tenant secret generated/stored by Alga (see Tactical settings UI).

JSON Body (minimal):
```json
{
  "agent_id": "123"
}
```

JSON Body (recommended):
```json
{
  "agent_id": "123",
  "alert_id": "abc-123",
  "event": "trigger",
  "severity": "critical",
  "message": "Disk space low",
  "alert_time": "2026-02-13T18:25:43.511Z",
  "client_id": "1",
  "site_id": "10"
}
```

Notes:
- `agent_id` is required.
- `event` controls alert status: values containing `resolve` are treated as resolved; all others are treated as active.
- If `alert_id` is omitted, Alga generates a best-effort external alert id from `(agent_id, event, alert_time)`.
