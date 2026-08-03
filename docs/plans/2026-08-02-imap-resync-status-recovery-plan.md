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
