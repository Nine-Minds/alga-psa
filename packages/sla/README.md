# @alga-psa/sla

SLA (Service Level Agreement) management module for Alga PSA. Provides policy definitions, business hours scheduling, SLA timer lifecycle, pause/resume mechanics, threshold-based notifications, escalation management, and compliance reporting.

## Overview

The SLA system tracks two milestones per ticket: **first response** and **resolution**. Each milestone has configurable time targets per priority level, measured against business hours schedules with timezone and holiday awareness. When configured thresholds are reached (e.g., 50%, 75%, 90%, 100%), notifications are sent and escalations triggered automatically.

The system supports two timer backends:
- **Community Edition (CE):** PgBoss-based polling (every 5 minutes)
- **Enterprise Edition (EE):** Temporal workflows with per-ticket durable timers

## Package Structure

```
packages/sla/
├── src/
│   ├── index.ts                          — Package entry point
│   ├── types/
│   │   └── index.ts                      — All SLA type definitions
│   ├── services/
│   │   ├── slaService.ts                 — SLA lifecycle (start, response, resolution)
│   │   ├── slaPauseService.ts            — Pause/resume with deadline shifting
│   │   ├── businessHoursCalculator.ts    — Timezone-aware time calculations
│   │   ├── slaNotificationService.ts     — Threshold notifications (in-app + email)
│   │   ├── escalationService.ts          — 3-level escalation management
│   │   ├── itilSlaService.ts             — ITIL standard auto-configuration
│   │   ├── index.ts                      — Service exports
│   │   └── backends/
│   │       ├── ISlaBackend.ts            — Backend interface
│   │       ├── PgBossSlaBackend.ts       — CE implementation (polling)
│   │       ├── SlaBackendFactory.ts      — Singleton factory (CE/EE routing)
│   │       └── index.ts
│   ├── actions/
│   │   ├── slaActions.ts                 — Policy CRUD server actions
│   │   ├── businessHoursActions.ts       — Schedule CRUD server actions
│   │   ├── slaPauseConfigActions.ts      — Pause configuration actions
│   │   ├── escalationManagerActions.ts   — Escalation config actions
│   │   ├── slaReportingActions.ts        — Dashboard/reporting queries
│   │   └── index.ts
│   └── components/
│       ├── SlaPolicyList.tsx             — Policy list with edit/delete/default
│       ├── SlaPolicyForm.tsx             — Policy create/edit with targets + thresholds
│       ├── BusinessHoursSettings.tsx     — Schedule management with holidays
│       ├── SlaPauseSettings.tsx          — Status-based pause configuration
│       ├── EscalationManagerSettings.tsx — Per-board escalation config
│       ├── SlaStatusBadge.tsx            — Badge + compact indicator for tickets
│       ├── index.ts
│       └── dashboard/
│           ├── SlaMetricsCards.tsx        — KPI summary cards
│           ├── SlaComplianceGauge.tsx     — Compliance rate gauge
│           ├── SlaTrendChart.tsx          — Daily trend line chart
│           ├── SlaBreachChart.tsx         — Breach distribution chart
│           ├── SlaBreachesTable.tsx       — Recent breaches table
│           ├── SlaTicketsAtRisk.tsx       — At-risk ticket listing
│           └── index.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

## Exports

### Main entry (`@alga-psa/sla`)

Re-exports all types, services, and components.

### `@alga-psa/sla/actions`

Server actions (all wrapped with `withAuth()` and `withTransaction()`):
- `slaActions` — Policy CRUD, target management, notification thresholds
- `businessHoursActions` — Schedule CRUD, entries, holidays
- `slaPauseConfigActions` — Status pause rules, SLA settings
- `escalationManagerActions` — Per-board escalation manager assignments
- `slaReportingActions` — Compliance rates, breach analysis, trend data

### `@alga-psa/sla/components`

- `SlaPolicyList`, `SlaPolicyForm` — Policy management UI
- `BusinessHoursSettings` — Schedule and holiday management
- `SlaPauseSettings` — Pause rule configuration
- `EscalationManagerSettings` — Escalation manager setup
- `SlaStatusBadge`, `SlaIndicator` — Ticket SLA status display
- Dashboard: `SlaMetricsCards`, `SlaComplianceGauge`, `SlaTrendChart`, `SlaBreachChart`, `SlaBreachesTable`, `SlaTicketsAtRisk`

### `@alga-psa/sla/types`

All SLA domain types: `ISlaPolicy`, `ISlaPolicyTarget`, `ISlaStatus`, `SlaTimerStatus`, `IBusinessHoursSchedule`, `IEscalationManager`, `ISlaReportingFilters`, etc.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@alga-psa/auth` | `withAuth()` wrapper for server actions |
| `@alga-psa/core` | Logger, feature flag detection (`isEnterprise`) |
| `@alga-psa/db` | `createTenantKnex`, `withTransaction` |
| `@alga-psa/notifications` | Email and in-app notification delivery |
| `@alga-psa/reference-data` | Priority, board, and user lookups |
| `@alga-psa/types` | Shared type definitions (`ITicket`, `IBoard`, etc.) |
| `@alga-psa/ui` | UI primitives (Button, Card, DataTable, etc.) |
| `date-fns-tz` | Timezone conversions for business hours calculations |
| `zod` | Schema validation for actions and types |

## Development

### Running Tests

```bash
# Unit tests
cd packages/sla && npx vitest run

# Watch mode
cd packages/sla && npx vitest
```

Tests are located in `src/services/__tests__/` and cover business hours calculation, SLA lifecycle, pause/resume, escalation, notifications, and backend abstractions.

### Building

```bash
cd packages/sla && npm run build
```

### Type Checking

```bash
cd packages/sla && npm run typecheck
```

## Integration with Other Packages

- **`packages/tickets`** — `SlaStatusBadge` and `SlaIndicator` in ticket list columns and detail views; SLA filter on ticket list
- **`server/src/lib/eventBus/subscribers/`** — `slaSubscriber.ts` drives SLA lifecycle from ticket events; `slaNotificationSubscriber.ts` delivers threshold notifications
- **`server/src/lib/jobs/handlers/`** — `slaTimerHandler.ts` polls active tickets every 5 minutes (CE backend)
- **`ee/temporal-workflows/`** — `sla-ticket-workflow.ts` and `sla-activities.ts` provide the EE Temporal backend
- **`server/src/app/msp/settings/sla/`** — Settings page consuming components and actions from this package

## Further Reading

- [SLA Feature Documentation](../../docs/features/sla.md)
- [SLA Architecture](../../docs/architecture/sla.md)
- [Temporal Workflow PRD](../../ee/docs/plans/2026-02-03-sla-temporal-workflow-architecture/PRD.md)
