# Ticket watcher compatibility during staggered deployments

New ticket-watcher code must continue processing inbound email when the database has not yet received `20261028140000_create_ticket_watchers.cjs`. Related incident: alga-2026-0002888.

## Behavior

The shared watcher service selects storage from the schema visible to its connection. With `ticket_watchers`, it keeps the table authoritative and mirrors watchers into ticket attributes. Without the table, it reads and writes the existing `tickets.attributes.watch_list` under the same ticket lock. All watcher operations retain normalization, validation, tenant isolation, deduplication, and change reporting. Unrelated attributes survive updates.

Check table existence before querying it. Do not catch missing-table errors inside a transaction, suppress unrelated database errors, or cache an absent table across operations. A later migration must backfill watchers accumulated in the legacy representation.

## Scope

Cover watcher seeding, reads, adds, recipient merges, pause/resume, removal, and mirror synchronization. No UI/API changes, production migrations, deployment, or message replay are included.

## Acceptance

Code review confirms that storage is selected before any watcher-table query, writes retain the ticket lock, and the relational path remains authoritative when the table exists. Commit and push a branch based on the deployed email-service revision for direct deployment.

Behavioral tests and execution are deferred at the user’s request. `tests.json` records the pending coverage; none of it is claimed as verified.
