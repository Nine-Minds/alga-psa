# SLA escalation timing draft

Ticket: `alga-2026-0002687`

This draft schedules each configured escalation threshold independently from SLA notification thresholds. Escalation wake points use the same SLA clock origin, business-hours schedule, and pause adjustment as the existing phase deadlines. Coincident escalation levels share a wake point but are checked independently. After response breach, pending response escalations remain eligible during resolution only while response remains outstanding; a response completion signal cancels them.

Temporal histories without the `sla-escalation-configured-wakepoints-v1` patch marker follow the legacy notification-point command sequence. Histories that record the marker use the configured wake-point path. The marker is the compatibility boundary; reviewers should verify both sides against production history retention and deployment sequencing.

Historical missed escalations remain excluded. Replaying events from September 28 through October 22 could trigger stale operational actions. The reported population of 264 tickets across 20 tenants has not been independently verified. This draft changes ongoing scheduling only and must not execute a historical backfill.

Reviewer decision: confirm whether the historical escalation population should remain permanently excluded, or whether a separately approved, bounded remediation is wanted after validating the population and stale-action risks. Do not include that remediation in this change.
