# Asset maintenance schedule API

The REST API uses the same columns as the asset maintenance UI and
`asset_maintenance_schedules`. This correction requires no database migration.

## Creating a schedule

`POST /api/v1/assets/{id}/maintenance`

```json
{
  "schedule_name": "Biannual server maintenance",
  "description": "Inspect fans, backups, storage health, and updates",
  "maintenance_type": "preventive",
  "frequency": "monthly",
  "frequency_interval": 6,
  "schedule_config": {},
  "next_maintenance": "2026-11-01T13:00:00.000Z",
  "is_active": true
}
```

Required fields are `schedule_name` (1-255 non-whitespace characters),
`maintenance_type`, `frequency`, `frequency_interval` (positive integer),
`schedule_config` (JSON object), and `next_maintenance` (ISO datetime).
`description` is optional and nullable; `is_active` defaults to true.

Maintenance types: `preventive`, `corrective`, `inspection`, `calibration`,
`replacement`. Frequencies: `daily`, `weekly`, `monthly`, `quarterly`, `yearly`,
`custom`. For example, monthly with interval 6 represents every six months.

The asset ID comes from the URL. The authenticated context supplies `tenant`
and `created_by`; clients cannot set or change them. The API checks that the
asset exists in that tenant. It stores the supplied next due date unchanged,
creates an upcoming notification, and creates an open occurrence if active,
all in one transaction. Creation returns 201 with the persisted schedule.

## Reading and updating

- `GET /api/v1/assets/{id}/maintenance` lists schedules with their database
  column names and `created_by_name`.
- `PUT /api/v1/assets/maintenance/{scheduleId}` accepts a partial set of the
  creation fields. Omitting `is_active` preserves its existing value.
- Changing `next_maintenance` updates the open occurrence and unsent
  notifications. Changing frequency alone does not move the existing due date;
  send `next_maintenance` explicitly to reschedule.
- Disabling a schedule cancels its open occurrence. Re-enabling an unarchived
  schedule creates an open occurrence. Changes are transactional.
- Missing or cross-tenant schedule IDs return 404 on update.

## Compatibility correction

Previously, the REST request schema advertised fields that do not exist in the
schedule table. The service inserted them verbatim, causing PostgreSQL error
42703 (`undefined_column`), surfaced as HTTP 500 `INTERNAL_CONFIGURATION`.
It also omitted required `schedule_name` and `created_by` values.

| Previously advertised field | Correct contract |
| --- | --- |
| `schedule_type` | `maintenance_type` |
| `notes` | `description` |
| `start_date` | Supply the actual next due date as `next_maintenance`; it is not advanced by a recurrence interval on creation |
| `end_date` | Unsupported; no existing column |
| `assigned_to` | Unsupported; `created_by` records the authenticated creator, not an assignee |

This intentionally corrects the broken request contract rather than adding
columns or silently translating obsolete fields. Unknown fields, including the
legacy names above, return HTTP 400 `VALIDATION_ERROR`. Update API/MCP clients to
send the corrected names and required fields. Regenerate OpenAPI and the CE/EE
MCP registries when changing this contract.
