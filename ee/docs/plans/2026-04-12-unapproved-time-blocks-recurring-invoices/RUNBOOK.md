# Runbook — Unapproved Time Blocks Recurring Invoices

## Operator Expectations

- Automatic Invoices separates recurring windows into **Needs Approval** and **Ready to Invoice**.
- A window in **Needs Approval** is blocked because it contains billable time entries that are not approved yet.
- The whole invoice window is blocked until the billable time is approved; there is no partial recurring invoice for fixed or other non-time charges in that same window.

## Troubleshooting

- If a user reports a stale Ready window, retry generation: the server re-checks approval blockers immediately before invoice creation.
- Generation errors should include the blocked entry count (for example: `Blocked until approval: 3 unapproved entries.`).
- Use the **Review Approvals** action from Needs Approval rows to navigate to `/msp/time-sheet-approvals`.
