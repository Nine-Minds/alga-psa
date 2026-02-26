# SLA (Service Level Agreement) System

The SLA system provides automated tracking of ticket response and resolution times against configurable service level targets. It measures two milestones per ticket — first response and resolution — calculates deadlines using business hours schedules, and triggers notifications and escalations when configurable thresholds are reached.

## Core Features

### Policy Management

SLA policies define service level targets and notification rules:
- Named policies with descriptions, one marked as tenant default
- Per-priority targets specifying response and resolution time in minutes
- Optional 24x7 override per target (bypasses business hours schedule)
- Escalation thresholds per target (default: 70% level 1, 90% level 2, 110% level 3)
- Notification thresholds at configurable percentages (e.g., 50%, 75%, 90%, 100%)
- Linked to a business hours schedule for deadline calculation

### Policy Resolution Hierarchy

When a ticket is created, the system resolves which SLA policy applies using a three-level hierarchy:

1. **Client-level** (`clients.sla_policy_id`) — if the ticket's client has a policy assigned, use it
2. **Board-level** (`boards.sla_policy_id`) — if the ticket's board has a policy assigned, use it
3. **Tenant default** (`sla_policies.is_default = true`) — fall back to the default policy

Once resolved, the policy's per-priority target is looked up for the ticket's priority. If no target exists for that priority, the policy is applied but no deadlines are set.

### Business Hours and Holidays

Business hours schedules define when SLA time counts:
- Named schedules with IANA timezone support (e.g., `America/New_York`, `Europe/London`)
- Per-day entries with start and end times and enabled/disabled flag (day_of_week 0=Sunday through 6=Saturday)
- Holiday calendar with named dates — can be one-time or recurring (annual)
- 24x7 mode that bypasses all day/time constraints
- DST-aware calculations via `date-fns-tz` — correctly handles spring-forward and fall-back transitions

The business hours calculator provides:
- `calculateDeadline(schedule, startTime, targetMinutes)` — compute a UTC deadline from a business-minutes budget
- `calculateElapsedBusinessMinutes(schedule, from, to)` — count business minutes between two timestamps
- `isWithinBusinessHours(schedule, datetime)` — check if a moment falls within working hours
- `getRemainingBusinessMinutes(schedule, from, to)` — remaining business time until a deadline
- `formatRemainingTime(minutes)` — human-readable format (e.g., "2h 30m", "-45m")

### SLA Timer Lifecycle

The SLA lifecycle is driven by ticket events through the event bus:

1. **Start** — On `TICKET_CREATED`, `startSlaForTicket()` resolves the policy, looks up the per-priority target, calculates response and resolution deadlines using the business hours schedule, and stores them on the ticket. The ticket's `due_date` is synced to the resolution deadline.

2. **First Response** — On `TICKET_COMMENT_ADDED`, if the comment is public and from an internal user, `recordFirstResponse()` records the response time and marks whether the response SLA was met.

3. **Resolution** — On `TICKET_CLOSED`, `recordResolution()` records the resolution time and marks whether the resolution SLA was met.

4. **Priority Change** — On `TICKET_UPDATED` with a priority change, `handlePriorityChange()` recalculates deadlines using the new priority's targets.

5. **Policy Change** — When a ticket's SLA policy changes, the existing backend tracking is cancelled and restarted with the new policy's targets.

### Pause/Resume Mechanics

SLA timers can be paused and resumed. Two triggers exist:

1. **Status-based pause** — Administrators configure which ticket statuses pause SLA via `status_sla_pause_config`. When a ticket moves to a pausing status, the SLA timer pauses. Moving to a non-pausing status resumes it.

2. **Awaiting client** — When a ticket's response state changes to `awaiting_client`, the SLA pauses automatically. This is controlled by the tenant-level setting `sla_settings.pause_on_awaiting_client` (default: true).

On pause:
- `sla_paused_at` is set to the current timestamp
- An `sla_paused` audit log entry is created

On resume:
- The pause duration is calculated and added to `sla_total_pause_minutes`
- `sla_paused_at` is cleared
- Both response and resolution deadlines are shifted forward by the pause duration (only for unfulfilled milestones)
- The ticket's `due_date` is kept in sync with the resolution deadline

### Notification System

Notifications are threshold-based and configurable per policy:
- Each policy has notification thresholds (e.g., 50%, 75%, 90%, 100%) that define when and who to notify
- **Recipient targets**: assignee, board manager, escalation manager — each independently togglable per threshold
- **Channels**: `in_app` and/or `email` per threshold
- Notification type is `warning` for thresholds below 100% and `breach` for 100%+
- Duplicate prevention via `sla_notifications_sent` table (one notification per ticket per threshold)
- Delivery is event-driven: the timer publishes `TICKET_SLA_THRESHOLD_REACHED` events, and the `slaNotificationSubscriber` dispatches actual notifications

Email templates are stored in `server/migrations/utils/templates/email/sla/`:
- `slaWarning.cjs` — SLA approaching deadline
- `slaBreach.cjs` — SLA deadline exceeded
- `slaEscalation.cjs` — Ticket escalated to manager

Internal notification subtypes: `sla-warning`, `sla-breach`, `sla-response-met`, `sla-resolution-met`, `sla-escalation`.

### Escalation System

Escalation is a three-level system tied to SLA thresholds:
- Each board can have up to 3 escalation managers configured (one per level) via `escalation_managers`
- Escalation thresholds are defined on policy targets: `escalation_1_percent` (default 70%), `escalation_2_percent` (90%), `escalation_3_percent` (110%)
- When a threshold is crossed, the system checks if escalation is needed for that level
- On escalation:
  - The escalation manager is added as a ticket resource with role `escalation_manager_L{level}`
  - In-app and email notifications are sent to the manager
  - The ticket's `escalated`, `escalation_level`, and `escalated_at` fields are updated
  - An audit log entry is created
- Escalation is idempotent — the system won't re-escalate to the same or lower level

### Reporting Dashboard

The settings page includes an SLA dashboard tab with:
- **Compliance rates** — overall, response-only, and resolution-only compliance percentages
- **Average times** — average response and resolution times vs. target
- **Breach rates by dimension** — grouped by priority, technician, or client
- **Trend data** — daily compliance rate over a configurable date range (7d, 14d, 30d, 90d)
- **Recent breaches table** — ticket list with breach details
- **Tickets at risk** — tickets approaching their SLA deadline

## Database Schema

### sla_policies

```sql
CREATE TABLE sla_policies (
    tenant                     UUID NOT NULL REFERENCES tenants,
    sla_policy_id              UUID DEFAULT gen_random_uuid() NOT NULL,
    policy_name                TEXT NOT NULL,
    description                TEXT,
    is_default                 BOOLEAN DEFAULT false,
    business_hours_schedule_id UUID,  -- FK to business_hours_schedules
    created_at                 TIMESTAMPTZ DEFAULT now(),
    updated_at                 TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tenant, sla_policy_id)
);
```

### sla_policy_targets

One row per priority within a policy. Defines response/resolution time budgets and escalation thresholds.

```sql
CREATE TABLE sla_policy_targets (
    tenant                  UUID NOT NULL REFERENCES tenants,
    target_id               UUID DEFAULT gen_random_uuid() NOT NULL,
    sla_policy_id           UUID NOT NULL,  -- FK to sla_policies
    priority_id             UUID NOT NULL,  -- FK to priorities
    response_time_minutes   INTEGER,
    resolution_time_minutes INTEGER,
    escalation_1_percent    INTEGER DEFAULT 70,
    escalation_2_percent    INTEGER DEFAULT 90,
    escalation_3_percent    INTEGER DEFAULT 110,
    is_24x7                 BOOLEAN DEFAULT false,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tenant, target_id),
    UNIQUE (tenant, sla_policy_id, priority_id)
);
```

### sla_settings

Global SLA settings per tenant.

```sql
CREATE TABLE sla_settings (
    tenant                    UUID NOT NULL REFERENCES tenants,
    pause_on_awaiting_client  BOOLEAN DEFAULT true,
    created_at                TIMESTAMPTZ DEFAULT now(),
    updated_at                TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tenant)
);
```

### status_sla_pause_config

Maps ticket statuses to SLA pause behavior.

```sql
CREATE TABLE status_sla_pause_config (
    tenant      UUID NOT NULL REFERENCES tenants,
    config_id   UUID DEFAULT gen_random_uuid() NOT NULL,
    status_id   UUID NOT NULL,  -- FK to statuses
    pauses_sla  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tenant, config_id),
    UNIQUE (tenant, status_id)
);
```

### business_hours_schedules

```sql
CREATE TABLE business_hours_schedules (
    tenant        UUID NOT NULL REFERENCES tenants,
    schedule_id   UUID DEFAULT gen_random_uuid() NOT NULL,
    schedule_name TEXT NOT NULL,
    timezone      TEXT NOT NULL DEFAULT 'America/New_York',
    is_default    BOOLEAN DEFAULT false,
    is_24x7       BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tenant, schedule_id)
);
```

### business_hours_entries

One row per day of week per schedule.

```sql
CREATE TABLE business_hours_entries (
    tenant       UUID NOT NULL REFERENCES tenants,
    entry_id     UUID DEFAULT gen_random_uuid() NOT NULL,
    schedule_id  UUID NOT NULL,  -- FK to business_hours_schedules
    day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time   TIME NOT NULL,
    end_time     TIME NOT NULL,
    is_enabled   BOOLEAN DEFAULT true,
    PRIMARY KEY (tenant, entry_id),
    UNIQUE (tenant, schedule_id, day_of_week)
);
```

### holidays

Schedule-specific or global holidays.

```sql
CREATE TABLE holidays (
    tenant        UUID NOT NULL REFERENCES tenants,
    holiday_id    UUID DEFAULT gen_random_uuid() NOT NULL,
    schedule_id   UUID,  -- FK to business_hours_schedules (null = global)
    holiday_name  TEXT NOT NULL,
    holiday_date  DATE NOT NULL,
    is_recurring  BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tenant, holiday_id)
);
```

### sla_notification_thresholds

Configures notification recipients and channels per threshold percentage.

```sql
CREATE TABLE sla_notification_thresholds (
    tenant                     UUID NOT NULL REFERENCES tenants,
    threshold_id               UUID DEFAULT gen_random_uuid() NOT NULL,
    sla_policy_id              UUID NOT NULL,  -- FK to sla_policies
    threshold_percent          INTEGER NOT NULL,
    notification_type          TEXT NOT NULL DEFAULT 'warning',
    notify_assignee            BOOLEAN DEFAULT true,
    notify_board_manager       BOOLEAN DEFAULT false,
    notify_escalation_manager  BOOLEAN DEFAULT false,
    channels                   TEXT[] DEFAULT ARRAY['in_app'],
    created_at                 TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tenant, threshold_id),
    UNIQUE (tenant, sla_policy_id, threshold_percent)
);
```

### sla_notifications_sent

Duplicate prevention — tracks which threshold notifications have already been sent per ticket.

```sql
CREATE TABLE sla_notifications_sent (
    tenant            UUID NOT NULL REFERENCES tenants,
    ticket_id         UUID NOT NULL,  -- FK to tickets
    threshold_percent INTEGER NOT NULL,
    sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant, ticket_id, threshold_percent)
);
```

### sla_audit_log

Complete event history for SLA compliance tracking.

```sql
CREATE TABLE sla_audit_log (
    tenant        UUID NOT NULL REFERENCES tenants,
    log_id        UUID DEFAULT gen_random_uuid() NOT NULL,
    ticket_id     UUID NOT NULL,      -- FK to tickets (ON DELETE CASCADE)
    event_type    VARCHAR(50) NOT NULL,
    event_data    JSONB,
    triggered_by  UUID,               -- FK to users (ON DELETE SET NULL)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant, log_id)
);
```

Event types: `sla_started`, `sla_paused`, `sla_resumed`, `threshold_warning`, `sla_breach`, `response_recorded`, `resolution_recorded`, `priority_changed`, `policy_changed`, `manual_override`.

### escalation_managers

Per-board, per-level escalation contacts.

```sql
CREATE TABLE escalation_managers (
    config_id         UUID NOT NULL,
    tenant            UUID NOT NULL REFERENCES tenants,
    board_id          UUID NOT NULL,           -- FK to boards
    escalation_level  INTEGER NOT NULL CHECK (escalation_level BETWEEN 1 AND 3),
    manager_user_id   UUID,                    -- FK to users
    notify_via        TEXT[] DEFAULT '{in_app,email}',
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (config_id, tenant),
    UNIQUE (tenant, board_id, escalation_level)
);
```

### Ticket Table Additions

```sql
ALTER TABLE tickets ADD COLUMN sla_policy_id          UUID;       -- FK to sla_policies
ALTER TABLE tickets ADD COLUMN sla_started_at          TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_response_due_at     TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_response_at         TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_response_met        BOOLEAN;    -- null = not yet responded
ALTER TABLE tickets ADD COLUMN sla_resolution_due_at   TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_resolution_at       TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_resolution_met      BOOLEAN;    -- null = not yet resolved
ALTER TABLE tickets ADD COLUMN sla_paused_at           TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_total_pause_minutes INTEGER NOT NULL DEFAULT 0;
```

### Board and Client Additions

```sql
ALTER TABLE boards  ADD COLUMN sla_policy_id    UUID;  -- FK to sla_policies (board-level SLA)
ALTER TABLE boards  ADD COLUMN manager_user_id  UUID;  -- FK to users (board manager for notifications)
ALTER TABLE clients ADD COLUMN sla_policy_id    UUID;  -- FK to sla_policies (client-level SLA)
```

## Implementation Phases

### Phase 1: Policy and Business Hours
- SLA policy CRUD (create, update, delete, set default)
- Per-priority target management
- Business hours schedule CRUD with daily entries
- Holiday management (one-time and recurring)
- Timezone picker integration

### Phase 2: SLA Timer Engine
- `startSlaForTicket()` with policy resolution hierarchy
- `recordFirstResponse()` and `recordResolution()`
- Event bus subscribers for ticket lifecycle events
- Deadline calculation using business hours calculator
- Auto-sync of `due_date` with resolution deadline

### Phase 3: Pause/Resume
- Status-based pause configuration UI
- `pauseSla()` / `resumeSla()` with deadline shifting
- Awaiting-client pause (tenant-level opt-in)
- `handleStatusChange()` and `handleResponseStateChange()` handlers

### Phase 4: Notifications and Escalation
- Notification threshold configuration per policy
- Threshold crossing detection (timer job or Temporal workflow)
- In-app and email notification delivery
- Email template creation (warning, breach, escalation)
- 3-level escalation manager configuration per board
- Automatic escalation with manager resource assignment

### Phase 5: Reporting Dashboard
- Compliance rate calculations (overall, response, resolution)
- Breach rate analysis by priority, technician, client
- Daily trend data aggregation
- At-risk ticket detection
- Settings page dashboard tab with charts and tables

### Phase 6: Temporal Workflow Backend (EE)
- `ISlaBackend` interface and `SlaBackendFactory`
- `PgBossSlaBackend` for CE (delegates to polling)
- `TemporalSlaBackend` for EE (real Temporal workflows)
- `slaTicketWorkflow` with threshold-based sleep/wake
- 5 activities: calculate, notify, escalate, status update, audit log
- Signal handlers: pause, resume, completeResponse, completeResolution, cancel
- State query for real-time SLA status

## Integration Points

- **Event Bus** — `slaSubscriber` handles `TICKET_CREATED`, `TICKET_UPDATED`, `TICKET_CLOSED`, `TICKET_COMMENT_ADDED`, `TICKET_RESPONSE_STATE_CHANGED`; `slaNotificationSubscriber` handles `TICKET_SLA_THRESHOLD_REACHED`
- **Job Scheduler** — `slaTimerHandler` runs every 5 minutes (CE) to poll active tickets for threshold crossings
- **Email Notifications** — Template-based delivery via `@alga-psa/notifications` for warnings, breaches, and escalations
- **Internal Notifications** — In-app alerts via the notification system for SLA events
- **Ticket System** — SLA status badge in ticket list and detail views; SLA filter on list page
- **ITIL Auto-Configuration** — `configureItilSlaForBoard()` creates standard ITIL policy with default targets (Critical: 15m/1h, High: 30m/4h, Medium: 1h/24h, Low: 4h/72h, Planning: 8h/1w)

## Security Considerations

- All tables use composite primary keys with `tenant` for Citus-compatible multi-tenant isolation
- All server actions are wrapped with `withAuth()` for authentication
- Database mutations use `withTransaction()` for atomicity
- Full audit log (`sla_audit_log`) for compliance reporting and debugging
- Foreign key constraints enforce referential integrity across all SLA tables

## Business Value

- **SLA compliance tracking** — Automated measurement of response and resolution times against targets
- **Proactive alerting** — Threshold notifications prevent SLA breaches before they happen
- **Tiered service levels** — Client-specific policies support differentiated service agreements
- **Fair measurement** — Business hours and pause mechanics ensure SLA time only counts during working hours
- **Escalation automation** — Automatic manager notification and assignment reduces manual oversight
- **Compliance reporting** — Dashboard and audit log support contractual SLA reporting

## ITIL Standard Auto-Configuration

When a board uses ITIL priority mode, the system can auto-create a standard ITIL SLA policy with:

| Priority | Response Time | Resolution Time | 24x7 |
|----------|--------------|----------------|-------|
| Critical (Level 1) | 15 minutes | 1 hour | Yes |
| High (Level 2) | 30 minutes | 4 hours | No |
| Medium (Level 3) | 1 hour | 24 hours | No |
| Low (Level 4) | 4 hours | 72 hours | No |
| Planning (Level 5) | 8 hours | 1 week | No |

Default notification thresholds: 50% (assignee, in-app), 75% (assignee + board manager, in-app), 90% (all, in-app + email), 100% breach (all, in-app + email).
