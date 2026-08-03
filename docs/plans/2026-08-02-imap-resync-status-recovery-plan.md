# IMAP resync status recovery plan

## Goal

After IMAP resync starts, present the intentional disconnect as temporary reconnecting work and refresh until the backend reconnects, without a reload or disabled-looking card.

## Code findings

- `resyncImapProvider` clears cursor/lease fields and writes `status='disconnected'`; it never changes `is_active`.
- `handleResyncProvider` does one immediate `loadProviders()`, exposing that temporary disconnected value but never following recovery.
- `EmailProviderList` owns busy state only while the callback runs. `EmailProviderCard` renders persisted status and dims only when `isActive` is false.
- The service reconnects on a 60-second refresh cycle, so the UI window must exceed one cycle.

## Design and order

1. Track provider ids in a local reconnecting set in `EmailProviderConfiguration.tsx`. On success, add the id before the first reload so the card never flashes bare Disconnected.
2. Poll fresh `getEmailProviders` results every 3-5 seconds for at most 90 seconds. Replace the list on successful reads and stop when the target status leaves `disconnected`. Cancel on unmount and supersede older work for the same provider.
3. Clear reconnecting on recovery or timeout. Announce Connected only from freshly persisted status. On timeout, warn that reconnect is still pending and leave manual Refresh available.
4. Thread an explicit provider-scoped `reconnecting` prop through the list to the card; do not mutate the persisted status union. Show a yellow/secondary Reconnecting badge with accessible text, retain normal opacity while active, and block duplicate resync.
5. Add reconnecting/recovered/timeout copy to the email-provider locale catalogs.
6. Add behavioral component coverage with fake timers and mocked actions: immediate Reconnecting, automatic Connected without remount, no dimming, cancellation on unmount, honest timeout, and no poll after failed resync.
7. Run focused tests and package typecheck/lint. Smoke the wired UI and capture transient Reconnecting plus automatic Connected within 90 seconds.

## Non-goals and risks

- Do not change backend resync, cursor, lease, refresh-loop, `is_active`, Test Connection, or non-IMAP behavior.
- Do not add a persisted status solely for presentation.
- Prevent stale updates with cancellation plus a generation token; bound request pressure to one multi-second poll per provider.
- Treat only fresh persisted status as recovery, and timeout as ambiguity rather than failure.
- Rebase/restack if the nearby middleware card changes the same component; preserve its semantics.

## Mitigation override and natural-recovery smoke

Live GreenMail and worktree-built email-service smoke superseded the original 90-second polling limit. Resync invalidates the active worker's lease; one refresh can stop that worker and the next refresh recreates it. The observed natural recovery took 102.6 seconds, so the UI must keep the provider-scoped Reconnecting presentation after 90 seconds. Poll every 5 seconds through 2 minutes, every 15 seconds through 5 minutes, then cap at every 30 seconds until fresh provider state leaves `disconnected` or the component unmounts/supersedes the poll.

The follow-up smoke must use the production-default 60-second email-service refresh with real GreenMail and no provider-status edit, page reload, worker restart, or other intervention after clicking Resync. Keep the email-provider page mounted and untouched while collecting:

1. A transient screenshot showing Reconnecting with active (not dimmed/inactive) styling.
2. Email-service timestamps for the resync, lease-lost worker stop, later worker recreation, and persisted `connected` transition.
3. A database observation confirming `status='connected'` and `is_active=true` after natural recovery.
4. A final screenshot from the same untouched page showing Connected, plus browser console/network checks.

Record the exact timing and all fidelity compromises in a fresh evidence-directory README so another reviewer can correlate the two screenshots, service log, and database observation without relying on an earlier failed smoke run.
