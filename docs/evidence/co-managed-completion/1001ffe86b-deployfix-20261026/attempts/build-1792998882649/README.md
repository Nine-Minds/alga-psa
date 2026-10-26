# Superseded build build-1792998882649 (source 415019b46c)

- `12-privacy-probe/` and `10-departure-sponsor/` passed on this build; both were re-run on the final build.
- `10-departure-ended-workspace-probe-writes/`: the Kansas Farms admin's Entry and Grid offered no write
  control, ticket delete and createComment were refused read-only, but direct POSTs of
  `addChecklistItem`, `addExternalLink` and `addTicketCommentWithCache` from the ended workspace
  **succeeded** (see `direct-server-action-writes.json`). `cleanup-kansas-probe-writes.sql` removed the
  checklist item, link, comment/thread and their audit/outbox rows (workflow events kept as the trail).
  Ticket creation, asset association, document link/create and vault attach were found unguarded by code
  review. All were fixed in 9f87789071 before the final build.

Not attributed; the ledger uses the final build only.
