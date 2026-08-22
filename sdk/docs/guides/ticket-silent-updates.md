# Silent Ticket Updates

Ticket mutations that normally notify people can suppress those notifications for one operation. Add the following optional fields to the JSON request body:

- `suppressContactNotifications`: suppress customer-facing email and portal notifications.
- `suppressInternalNotifications`: also suppress agent and watcher email, in-app, and push notifications. This field is only valid when `suppressContactNotifications` is `true`.

Silent updates still create the normal audit and activity records, and they continue to run workflows and webhooks.

Both flags are available for these endpoints:

- `PUT /api/v1/tickets/{id}`
- `PUT /api/v1/tickets/{id}/status`
- `PUT /api/v1/tickets/{id}/assignment`
- `POST /api/v1/tickets/{id}/comments`
- `POST /api/v1/tickets/{id}/agents`
- `PUT /api/v1/tickets/{id}/team`

For example, this status change updates the ticket without notifying either customers or staff:

```http
PUT /api/v1/tickets/9c5352d2-f12c-41a4-a433-18472b79580f/status
Content-Type: application/json

{
  "status_id": "e4cad10c-2e16-4cd3-8c79-77e63e7f9cdb",
  "suppressContactNotifications": true,
  "suppressInternalNotifications": true
}
```

These fields are also included in the generated MCP tool inputs, so an MCP client can request the same per-operation behavior.
