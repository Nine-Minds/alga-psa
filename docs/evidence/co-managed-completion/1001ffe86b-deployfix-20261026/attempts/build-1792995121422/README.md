# Superseded build build-1792995121422 (source 238627579d)

Runs on this build found two Grid-audit gaps that were then fixed in 22c832d4b4:

- `10-dry-run-ticket-deleted/`: a dry run of the guide 10 direct-write probe POSTed the compiled
  `deleteTicket` server action from the ended Kansas Farms session and **the ticket was deleted**
  (workflow event `TICKET_DELETED` at 2026-10-26T06:44:01Z). The browser delete path did not admit the
  co-managed lifecycle. The fixture ticket #000001, its creation audit row and its "Barn network" tag were
  restored with `restore-kansas-ticket.sql` (values from the original creation/tag events and the
  8c96987ab5 tag receipt). No other Kansas table changed.
- The Grid's empty Scheduled work tile still linked to Technician Dispatch.
- `12-privacy-probe/`: the privacy probe passed on this build; it was re-run on the final build.

These recordings are not attributed; the ledger uses the final build only.
