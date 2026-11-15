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
`schedule_config` (JSON object), and `next_maintenance` (ISO 8601 UTC
datetime). `description` is optional and nullable; `is_active` defaults to true.

`next_maintenance` must carry a `Z` suffix, for example
`2026-11-01T13:00:00.000Z`. Timestamps with a numeric offset such as
`2026-11-01T09:00:00-04:00` are rejected with `400 VALIDATION_ERROR`; convert
to UTC before sending.

Maintenance types: `preventive`, `corrective`, `inspection`, `calibration`,
`replacement`. Frequencies: `daily`, `weekly`, `monthly`, `quarterly`, `yearly`,
`custom`. `frequency_interval` multiplies the frequency, so monthly with
interval 6 represents every six months.

### Custom recurrence

`frequency: "custom"` requires a rule at `schedule_config.recurrence`. The
multiplier is still `frequency_interval`; the rule chooses the unit and,
optionally, which weekdays or days of the month the schedule lands on:

```json
{
  "frequency": "custom",
  "frequency_interval": 2,
  "schedule_config": {
    "recurrence": { "unit": "weeks", "weekdays": [1, 4] }
  }
}
```

| Field | Meaning |
| --- | --- |
| `unit` | `days`, `weeks`, `months`, or `years`; multiplied by `frequency_interval`. |
| `weekdays` | `weeks` only. Integers 0 (Sunday) to 6 (Saturday), unique, at least one. |
| `days_of_month` | `months` only. Integers 1 to 31, unique, at least one. |

When maintenance is recorded, the next due date is computed from the actual
completion date:

- `days` / `years`, and `weeks` / `months` without a selector: add
  `frequency_interval` units. Month and year arithmetic clamps to the end of the
  target month (Jan 31 + 1 month = Feb 28).
- `weeks` with `weekdays`: the next listed weekday later in the same week
  (weeks start on Sunday); after the last listed weekday, jump
  `frequency_interval` weeks to the first listed weekday. Example: every 2 weeks
  on Mon/Thu, completed Thursday 2026-09-03, is next due Monday 2026-09-14.
- `months` with `days_of_month`: the next listed day later in the same month;
  after the last listed day, jump `frequency_interval` months to the first
  listed day. Listed days are clamped to the month length, so `[31]` falls on
  Feb 28 and Apr 30.

The rule is validated on create, and on update against the merged row, so
switching an existing schedule to `custom` without a rule, or removing the rule
from a `custom` schedule, returns `400 VALIDATION_ERROR`. Other keys in
`schedule_config` (for example `checklist`) are stored unchanged. Schedules
stored as `custom` without a rule (created before this support existed) cannot
be completed until a rule is added via `PUT`.

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
- Response-only fields (`schedule_id`, `asset_id`, `tenant`, `created_by`,
  `created_by_name`, `created_at`, `updated_at`, `last_maintenance`,
  `archived_at`) are accepted and ignored on update, so a row returned by `GET`
  can be modified and sent back as-is. Legacy and unknown fields still return
  `400`.
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
legacy names above, return HTTP 400 `VALIDATION_ERROR` (on update, response-only
fields are the one exception and are ignored). Update API/MCP clients to
send the corrected names and required fields. Regenerate OpenAPI and the CE/EE
MCP registries when changing this contract.
