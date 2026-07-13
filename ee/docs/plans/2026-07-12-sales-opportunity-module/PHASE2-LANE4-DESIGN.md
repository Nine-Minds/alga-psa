# Phase 2 Lane 4 — Discipline Engine Backend

## Decisions

- The work queue is the current owner's personal docket. It never includes another owner's opportunities.
- Queue assembly uses a fixed number of tenant-scoped queries: base opportunities, linked quote/evidence facts, and pending suggestions. It does not query per opportunity.
- Tenant day boundaries use the existing effective-timezone resolver and Temporal. Invalid or missing timezones fall back to UTC through the house helper.
- Staleness and overdue delivery are polling jobs with timestamp-defined episodes. A marker is eligible again only after the relevant activity or due date is newer than the marker.
- The daily discipline job and weekly digest are separate jobs so their retry and cadence boundaries remain independent.
- Opportunity settings use a dedicated tenant-scoped `opportunity_settings` singleton row, matching other module-specific settings tables. Defaults are 14 nudge days, 21 interrupt days, and solo escalation.
- Solo escalation creates a private 30-minute `ad_hoc` schedule entry at the next configured business-hours opening, falling back to 09:00 in the owner's effective timezone on the next weekday.
- Team escalation targets `users.reports_to`; when absent, it targets active users with an Admin or Owner role.
- Internal and email notifications use the existing preference-aware template systems. The weekly digest is default-on and users opt out through its notification subtype preference.
- The workflow catalog events remain customization hooks, but methodology delivery is implemented by the jobs. The current workflow runtime has system definitions, but no clean default-on per-tenant provisioning contract suitable for this CE behavior.
- User Activities receives an `opportunity` activity source in the shared activity contract and aggregator only. No activity UI components are changed in this lane.

## Data flow

The queue action resolves the current session user and tenant timezone, reads tenant opportunity settings and billing currency, loads the owner's open opportunities and their batched facts, and maps them through `composeWhy`. Due items are ordered by due time and only the first due item is primary. Quiet items exclude all due-today IDs.

The discipline job locks eligible opportunity rows in a tenant transaction, publishes the relevant opportunity events after commit, advances episode markers, and records delivery work. Notification and calendar side effects run from the selected work after the state transaction, with idempotency protected by the marker update.

The weekly digest aggregates owner-specific counts for the current week and previous week, creates a preference-aware in-app notification, and sends the preference-aware email template to each active owner.

## Verification

- Queue tests cover owner scoping, due/quiet bucketing, ordering, and exactly one primary item.
- Discipline tests cover one nudge per activity episode, overdue episode behavior, solo calendar escalation, and team escalation routing.
- Digest and activity aggregation receive focused behavioral coverage where their boundaries are practical.
- Typecheck the Opportunities, server, User Activities, Types, Notifications, Jobs, and touched Temporal workspace packages; run the Opportunities test suite and focused server tests.
