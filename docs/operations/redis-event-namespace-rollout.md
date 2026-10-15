# Redis event namespace rollout

## Worktree routing

Every server publisher and EventBus subscriber in one development environment
must use the same `REDIS_PREFIX`. Give each worktree a stable, unique prefix in
that worktree's ignored `server/.env.local`, for example:

```dotenv
REDIS_PREFIX=alga-psa-feature-my-branch:
```

`REDIS_PREFIX` is applied by `packages/event-bus` to individual event stream
names and to both `processed_events` and `processed_event_handlers` idempotency
sets. The legacy `server/src/lib/eventBus/index.ts` re-exports this package
implementation, so it has the same routing boundary. The
`REDIS_EVENT_STREAM_PREFIX` and `REDIS_EVENT_CONSUMER_GROUP` settings must also
agree within the environment.
Keep the consumer group name shared between replicas of one environment: they
compete to process a logical event once. A unique consumer name per process
does not isolate separate worktrees that share a stream and group.

The workflow stream remains `workflow:events:global`, independent of
`REDIS_PREFIX`; this preserves the current workflow consumer contract. The
prefix isolates individual event streams and their idempotency sets used by
subscribers such as calendar sync. Old unprefixed idempotency sets are left in
place to expire under their existing TTL; changing prefixes starts a fresh
idempotency namespace and can permit a fresh delivery on the new route.

## Activation and pending events

Set the prefix only in the affected worktree's environment, then let the board's
authorized startup load it for both event publishers and subscribers. Do not
change another worktree's settings or delete/flush shared Redis data. A new
prefix creates distinct individual streams and consumer groups while leaving
the old shared route intact. Existing messages in that old route may already
have been acknowledged by another worktree; do not replay or delete them in
bulk. To retry a known missing calendar delivery, edit and save that specific
schedule entry after the affected app is running so it publishes a fresh update
through the isolated route.

To inspect routing safely, report only the selected database number, stream
names, consumer-group names, and aggregate consumer/pending counts. Never print
Redis credentials or full environment dumps. Avoid `XDEL`, `XGROUP DESTROY`,
`FLUSHDB`, and broad replay operations during activation.
