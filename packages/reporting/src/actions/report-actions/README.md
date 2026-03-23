# Report Actions

This directory contains server actions specifically designed for generating data for various reports within the application.

Group report-related server actions here to maintain organization and separation of concerns.

## Recurring Billing Date Basis

Recurring billing reporting is no longer allowed to assume that invoice header dates are the only recurring timing truth.

- Canonical recurring service periods come from cadence ownership and persisted recurring detail metadata.
- Invoice headers and client billing schedules remain grouping metadata for invoice windows.
- When report actions summarize recurring billing intent, they should prefer canonical `service_period_start` / `service_period_end` values when those detail rows exist.
- Historical or manual rows that do not yet have canonical recurring detail metadata may still fall back to invoice-date semantics.

## Current Rollout Default

The staged rollout still defaults existing recurring lines to client cadence.

- Client billing schedule previews should be described as invoice-window previews for client-cadence lines.
- Contract-anniversary cadence remains a later capability and should not be described as already live unless the caller is explicitly handling that staged path.
