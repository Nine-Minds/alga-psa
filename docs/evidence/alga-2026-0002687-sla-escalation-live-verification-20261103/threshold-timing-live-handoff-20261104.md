# SLA escalation threshold timing live handoff — 2026-11-04

Use the existing “Review 2687 Failure Surfacing” fixture and create a fresh ticket after deploying the Draft Implementation repair commit to the authorized smoke environment. This handoff is a verification recipe; no live ticket or workflow was created during Draft Implementation.

## Fixture

- Use the existing board, SLA policy, and configured L1/L2 managers from the Review 2687 fixture.
- Assign the fresh ticket to the configured L1 manager so the verified manager-as-assignee path is exercised.
- Use a 24x7 response window of 2 minutes; disable the resolution target for this timing check.
- Configure distinct escalation thresholds: L1 `70%`, L2 `90%`, L3 disabled. Keep notification thresholds at `50%` and `75%` to verify escalation wakes between notification wakes.
- Record the workflow's SLA start timestamp as `T` from the created ticket/workflow evidence.

## Expected timeline and persisted observations

| Relative time from `T` | Expected event |
| --- | --- |
| `T + 60s` | 50% notification threshold; neither escalation level is eligible. |
| Immediately before `T + 84s` | L1 has not escalated. |
| `T + 84s` | L1 becomes eligible at 70%; persist escalation level 1 and its `ticket_escalated` audit event. The manager notification should be present. |
| `T + 90s` | 75% notification threshold; L2 remains pending. |
| Immediately before `T + 108s` | L2 has not escalated. |
| `T + 108s` | L2 becomes eligible at 90%; persist escalation level 2 and its `ticket_escalated` audit event, with the corresponding manager notification. |

Inspect the Temporal history for separate scheduled wakes at the 70% and 90% deadlines, with no L2 activity at the L1 wake. Inspect persisted ticket escalation fields, both audit rows, and notification records. Confirm there is no additional `ticket_resources` row for the manager who is already the assignee. Capture the ticket, history, audit, and notification evidence under the existing Review 2687 evidence directory.

Live UI/Temporal verification remains pending and must run only in the subsequent smoke step with its authorized app environment.
