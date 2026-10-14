# EventBus NOGROUP loop after appliance Redis restart: plan

- Card: 48d26371-43e8-4d61-871d-ac00dff46f53
- PSA ticket: alga-2026-0002688 (reported by Todd / YourColo)
- Branch: `feature/eventbus-nogroup-loop-after-appliance-redis-rest`
- Base: `a65fccb78c` (origin/main)

## The failure

When appliance Redis restarts, it comes back empty. The appliance Redis has a 20Gi PVC mounted at `/data`, but its config sets `save ''` and does not enable AOF, so nothing is ever written to that volume.

alga-core's `EventBus` keeps a static set of consumer groups it has already created. Nothing clears that set except `close()`, so the bus never re-runs `XGROUP CREATE`. Every `XREADGROUP` then fails with `NOGROUP`. The loop logs an error and retries every second until the process restarts. During that time no ticket or project email, and nothing else on the bus, gets consumed.

workflow-worker's `RedisStreamClient` has the same defect. Its loop retries every 100 ms, so it logs about ten errors a second.

Two independent fixes:

- **A.** Consumers recreate a missing group by themselves.
- **B.** Appliance Redis persists its data.

A is required even after B ships. Redis can still lose a group in other ways: a corrupt or truncated AOF, a manual `DEL` or `FLUSHALL`, or the restart that rolling out B itself causes (see Risks).

## What the code does today

### `packages/event-bus/src/eventBus.ts` (alga-core's process-wide bus; `server/src/lib/eventBus/index.ts` re-exports it)

| Line | What |
|---|---|
| 186 | `private static createdConsumerGroups = new Set<string>()`, one per process |
| 276-301 | `ensureStreamAndGroup(stream)` returns early if the stream is in the set. Otherwise it runs `XGROUP CREATE <stream> event-processors 0 MKSTREAM`. On success or `BUSYGROUP` it adds the stream to the set. |
| 305-318 | `initialize()` ensures every `EventSchemas` type on the default channel |
| 384-388 | Each loop iteration ensures every subscribed stream. After the first pass this does nothing because of the set. |
| 394-410 | A single multi-stream `XREADGROUP ... STREAMS s1 s2 ... > > ...`. Redis fails the whole command on the first stream that has no group. |
| 481 | `claimPendingMessages()` runs after every successful read |
| 483-503 | Loop `catch`: a connection error waits 2 s and logs at warn. Anything else, NOGROUP included, gets `logger.error('Error in event processing loop')` and a 1 s retry, forever. |
| 619-684 | `claimPendingMessages`. `XPENDING` on a missing group throws NOGROUP and is logged at error (line 682). |
| 759 | `subscribe()` also calls `ensureStreamAndGroup` |
| 955-973 | `close()` is the only place the set is cleared (line 970) |

The publish path also goes through the cached `ensureStreamAndGroup`, so after a Redis wipe the publisher skips group creation and its `XADD` recreates the stream key but not the group, so the key can exist while the group does not. That is the exact state in the customer log.

### `shared/workflow/streams/redisStreamClient.ts` (workflow-worker v2 consumer of `workflow:events:global`; publisher via `shared/events/publisher.ts`)

| Line | What |
|---|---|
| 67 | `private static createdConsumerGroups`, keyed `${stream}::${group}` |
| 171-201 | `ensureStreamAndGroup` uses the same cache-and-early-return shape |
| 297-370 | `readGroupMessages`: ensure, then `XPENDING` (this is where NOGROUP surfaces first), then `XREADGROUP` |
| 387-418 | `claimPendingMessages`: `XPENDING` and `XAUTOCLAIM`, both NOGROUP-capable |
| 660-680 | `startConsumer` loop. The per-execution catch logs an error (669) and the loop re-arms after 100 ms (675). |
| 955-964 | `close()` does **not** clear the set |

### Other `xReadGroup` / `xGroupCreate` sites (from `git grep`)

- `packages/core/src/lib/events/redisStreamClient.ts`: publisher only, no consumer groups. **Not affected.**
- `server/src/test/e2e/utils/e2e-test-context.ts:491`: test setup. **Not affected.**
- `tools/smoke-sim/redis-smoke-sim.mjs`: fake Redis server. **Not affected.**
- email-service does not import `@alga-psa/event-bus` and owns no consumer group, so it needs no code change. It benefits indirectly because alga-core consumes and dispatches the email events.

### Helm: `helm/templates/redis/statefulSet.yaml`

- Line 38: `printf "requirepass ${REDIS_PASSWORD}\nsave ''\n" > /etc/redis/redis.conf && redis-server /etc/redis/redis.conf`. This means no RDB and no AOF.
- Lines 49-53 and 61-70: when `redis.persistence.enabled`, the PVC (`<fullname>-redis-data` or `existingClaim`) is mounted at `/data`. **This mount is already correct**, so B only needs to point Redis at it.
- `helm/templates/redis/pvc.yaml` creates the PVC under the same condition.
- `*.bak` files in `helm/templates/redis/` (`pvc.yaml.bak`, `service.yaml.bak`, `statefulSet.yaml.bak`): `helm/.helmignore:15` lists `*.bak`, so **they are never rendered**. Nothing references them, so they are dead.

### Who renders this StatefulSet (checked in `~/nm-kube-config` and this repo)

| Consumer | `redis.enabled` | `persistence.enabled` | Notes |
|---|---|---|---|
| `helm/values.yaml` (chart default) | true | **true** | |
| `ee/appliance/.../alga-core.single-node.yaml` | true | true (20Gi local-path) | the target |
| nm-kube-config `alga-psa/hosted.values.yaml` | true | **true** | hosted, ephemeral by design today |
| nm-kube-config `alga-psa/sebastian.shared.values.yaml` | true | default (true) | hosted shared Redis |
| `hosted.{blue,green}`, `sebastian.{blue,green}` | false | n/a | |

**Consequence:** we cannot key AOF off `redis.persistence.enabled`, because hosted has it set to true as well. And because any change to the pod template's `command` string rolls `redis-0` (which wipes its data), the hosted render must stay **byte-identical**.

## Decisions

1. **Recovery trigger is the NOGROUP error itself, not reconnect events.** I considered clearing the cache on the client's `ready` after a reconnect. A Redis restart always drops sockets, so that would catch most cases. It misses `DEL`, `FLUSHALL`, `XGROUP DESTROY`, and a restart that happens between reads. NOGROUP is the one observable fact that covers all of them, and it gives a single recovery path that is easy to test. One mechanism only.
2. **On NOGROUP, invalidate every active subscription stream, not only the one named in the message.** A Redis wipe removes every group, but a multi-stream `XREADGROUP` reports only the first missing one. Invalidating one stream per iteration would take N iterations (one per event type) to heal. Re-running `XGROUP CREATE` on streams whose group still exists just returns `BUSYGROUP`, which is already tolerated and costs one round trip per stream on a rare path. The stream named in the error is parsed only for the log line.
3. **Recreate at id `0` (unchanged).** Entries `XADD`ed after the restart but before the group existed are still delivered. Duplicates are already guarded by the `processed_events:*` / `processed_event_handlers:*` sets and the consumer ledgers.
4. **Logging: warn once per recovery, never an error per tick.** In `ensureStreamAndGroup`, a recreate that follows a NOGROUP invalidation logs `warn('[EventBus] consumer group missing, recreating', { stream, group })`. A normal first-time create still logs at info. The loop catch logs NOGROUP at warn on the first occurrence of a streak. Later consecutive NOGROUPs (if recreate keeps failing) log at most once every 60 occurrences, and the streak resets on the next successful read.
5. **Retry timing:** the first NOGROUP of a streak re-arms immediately (`setImmediate`). Consecutive NOGROUPs fall back to the existing 1 s delay so a persistently broken group cannot hot-loop.
6. **Fix both consumers inline. Do not extract a shared helper now.** The two sites live in different packages (`@alga-psa/event-bus` and `@alga-psa/shared`). The only common dependency is `@alga-psa/core`, which ships through a dist build with per-subpath exports. Two inline copies of about 15 lines, each marked `// LEVERAGE: pattern redis-consumer-group-ensure`, is the honest state. Extraction (a `ConsumerGroupRegistry` with `ensure` / `invalidate` / `isNoGroupError` in core) is a follow-up for the `leverage` skill, not this hotfix.
7. **Appliance Redis gets AOF through a new, explicit opt-in key: `redis.persistence.aof.enabled`.** The chart default is `false` and the appliance profile sets it to `true`. With the key off, line 38 renders unchanged, so hosted `redis-0` does not roll.
8. **AOF only, with RDB snapshots kept off (`save ''` stays).** Redis 7+ AOF rewrites already use an RDB preamble (`aof-use-rdb-preamble yes`, the default). `appendfsync everysec` loses at most about 1 s of writes on a crash, which is well inside what handler idempotency tolerates. Adding RDB `save` points would mean a second fork/write cycle on a single-node local-path disk for no recovery benefit.
9. **`maxmemory-policy noeviction` is written explicitly, inside the AOF branch only.** It is already Redis's default, so behaviour does not change. Writing it explicitly documents that streams must never be evicted, and guards against a future image default or an operator `CONFIG SET`. I don't set `maxmemory`: the pod has no memory limit, and picking a byte cap is a separate sizing decision. Out of scope.
10. **Delete the three `helm/templates/redis/*.bak` files.** They are ignored by `.helmignore` and referenced nowhere. Other `*.bak` files under `helm/templates/` are left alone because they are outside this card.

## Changes, in order

### Step 1: EventBus self-heal (`packages/event-bus/src/eventBus.ts`)

1. Add a module-level `isNoGroupError(error: unknown): boolean`, true when the message contains `NOGROUP`. Add `extractNoGroupKey(message)` that parses `No such key '<key>'` for logging. Put a `// LEVERAGE: pattern redis-consumer-group-ensure` marker here.
2. Next to `createdConsumerGroups` (line 186), add `private static recoveringConsumerGroups = new Set<string>()` and an instance field `private consecutiveNoGroup = 0`.
3. Add `private invalidateConsumerGroups(streams: string[])`. It deletes each stream from `createdConsumerGroups` and adds it to `recoveringConsumerGroups`.
4. `ensureStreamAndGroup` (276-301):
   - When creation succeeds and the stream is in `recoveringConsumerGroups`, log `warn('[EventBus] consumer group missing, recreating', { stream, group })` instead of info, then delete it from `recoveringConsumerGroups`.
   - On `BUSYGROUP`, delete from `recoveringConsumerGroups` and log at debug if the stream was recovering (some other consumer or replica already recreated it).
5. Loop catch (483-503): check `isNoGroupError` **before** the connection-error branch:
   - Call `invalidateConsumerGroups(this.getActiveSubscriptions().map(s => s.stream))`.
   - Increment `consecutiveNoGroup`. If it is 1, log a warn with `{ stream: extractNoGroupKey(msg), group, streams: n }` and call `setImmediate(processEvents)`. Otherwise, log a warn only when `consecutiveNoGroup % 60 === 0`, and call `setTimeout(processEvents, 1000)`.
   - Reset `consecutiveNoGroup = 0` after a successful read, just before `claimPendingMessages` at line 481.
6. `claimPendingMessages` catch (682): if `isNoGroupError`, invalidate the subscription streams and log at warn instead of error. The next loop iteration recreates them.
7. `close()` (970): also clear `recoveringConsumerGroups`.
8. `xAck` NOGROUP failures inside `processStreamMessage` (523/536/597/608/727) need no change. The message stays unacked in a group that no longer exists. The next read hits NOGROUP and recreates the group at `0`, and idempotency skips the redelivery.

### Step 2: EventBus tests (`packages/event-bus/src/eventBus.nogroup.test.ts`, new)

Model on `index.hardTimeout.test.ts`: `vi.doMock('redis')` with a fake client, using `executeIsolated` for the reader.

- **T1, recover and deliver.** Subscribe a handler to `TICKET_CREATED`. Make the fake reader's `xReadGroup` throw `new Error("NOGROUP No such key '<stream>' or consumer group 'event-processors' in XREADGROUP with GROUP option")` once, then return one message for that stream. Assert:
  - `xGroupCreate` is called again for **every** subscribed stream, with id `'0'` and `{ MKSTREAM: true }`, after the throw.
  - The handler receives the event.
  - `xAck` is called for it.
- **T2, no error spam.** Make `xReadGroup` throw NOGROUP on every call and let N ≥ 5 iterations run with fake timers. Assert:
  - `logger.error` is never called with `'[EventBus] Error in event processing loop:'`.
  - `logger.warn` with the "consumer group missing" text is called once per stream recovery, not once per tick.
  - The loop keeps a ≥ 1 s cadence after the first immediate retry (no hot loop).
- **T3, a claim-path NOGROUP heals.** `xPending` throws NOGROUP once. Assert a warn (not an error) and that `xGroupCreate` runs on the next iteration.
- **Optional (if a Redis is reachable).** A real-Redis variant: subscribe, `DEL <stream>`, `XADD` an event, and assert delivery. Gate it on `REDIS_URL` like the other Redis-dependent suites. The mock tests are the required 80%.

Run with `npx vitest run packages/event-bus` (the package `test` script is `vitest run`). Re-run `server/src/lib/eventBus/*.test.ts` too, because they exercise the same class through the re-export.

### Step 3: workflow RedisStreamClient (`shared/workflow/streams/redisStreamClient.ts`)

1. Add the same `isNoGroupError` and a `// LEVERAGE: pattern redis-consumer-group-ensure` marker.
2. `readGroupMessages` (297-370) catch: on NOGROUP, `createdConsumerGroups.delete(\`${streamName}::${group}\`)`, warn once ("consumer group missing, recreating"), and return `[]` instead of throwing. The next tick (100 ms later) re-ensures the group with `XGROUP CREATE ... 0 MKSTREAM`.
3. `claimPendingMessages` (387-418) catch: on NOGROUP, invalidate the same way and return `[]`.
4. Gate the warn with a per-stream "already warned" flag that is cleared after a successful read, so a persistent failure does not log ten times a second.
5. `close()` (955): clear `createdConsumerGroups`, to match EventBus.
6. Test (`shared/workflow/streams/redisStreamClient.nogroup.test.ts`, or next to the existing workflow-worker test harness, `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts`): the fake client's `xPending` throws NOGROUP once. Assert `xGroupCreate` is called again, the registered handler later receives an event, and there is no `logger.error`.

### Step 4: Appliance Redis AOF (`helm/`)

1. `helm/values.yaml` (`redis.persistence`, line 303): add
   ```yaml
   aof:
     # Appliance only. Turning this on changes the pod command and rolls redis-0 once.
     enabled: false
   ```
2. `helm/templates/redis/statefulSet.yaml` line 38: build the config in a template variable. The `requirepass` and `save ''` lines stay exactly as today. Only when `and .Values.redis.persistence.enabled .Values.redis.persistence.aof.enabled`, append:
   ```
   dir /data
   appendonly yes
   appendfsync everysec
   maxmemory-policy noeviction
   ```
   **Hard requirement:** with `aof.enabled=false` the rendered `command` must be byte-identical to the current output. If `aof.enabled` is set while `persistence.enabled` is false, `fail` with a clear message rather than writing AOF into the container filesystem.
3. `ee/appliance/flux/profiles/single-node/values/alga-core.single-node.yaml` (lines 74-79): add `aof: { enabled: true }` under `redis.persistence`.
4. Delete `helm/templates/redis/{pvc,service,statefulSet}.yaml.bak`.
5. Test: `ee/appliance/flux/tests/redis-persistence.helm.test.mjs` (new). `scripts/lib/test-discovery.mjs:isApplianceNodeTest` picks it up, and `node-tests.yml` runs it with helm installed. Follow the pattern in `ee/appliance/ubuntu-iso/tests/t002-pinned-db-image.test.mjs`.
   - With the appliance profile values: the redis StatefulSet command contains `appendonly yes`, `appendfsync everysec`, `dir /data` and `maxmemory-policy noeviction`, and still contains `requirepass`. The container mounts `redis-data` at `/data`, and the volume's `claimName` is the redis-data PVC.
   - With chart defaults: the command string equals the current literal exactly. This regression-locks hosted.
   - With `persistence.enabled=false,aof.enabled=true`: `helm template` fails.

### Step 5: Verify on the appliance VM (with the `alga-appliance-local` skill)

1. Deploy the branch chart and image to the local libvirt appliance.
2. `redis-cli CONFIG GET appendonly` returns `yes`, and `CONFIG GET dir` returns `/data`.
3. Create a ticket that triggers an email. `XINFO GROUPS alga-psa:event-stream:emailservice::v7:TICKET_CREATED` shows `event-processors`.
4. `kubectl -n msp delete pod redis-0` and wait for it to be Ready. The stream and the group are both still present, and `uptime_in_seconds` is small.
5. Create another ticket. The email arrives **without** restarting alga-core, and alga-core logs show no `Error in event processing loop`.
6. Part A check on the same VM: `redis-cli DEL <stream>` (or `XGROUP DESTROY`). Within one loop iteration alga-core logs a single warn, "consumer group missing, recreating". A new ticket email is delivered.

## Shipping order

1. **Part A first** (alga-core image, plus workflow-worker for the `RedisStreamClient` fix): nightly, then stable.
2. **Part B** (chart in the appliance config bundle): nightly. It must not reach an appliance ahead of Part A. Turning AOF on changes the pod command, so the upgrade itself restarts `redis-0` once with an empty dataset. If alga-core does not have A yet, that restart reproduces this incident on every appliance that upgrades. If the bundle ships chart and images together, both land in the same release and A self-heals the one-time wipe.
3. The control plane is not involved.

## Out of scope

- Turning on AOF or persistence for hosted Redis (`hosted.values.yaml`, `sebastian.shared.values.yaml`). That needs its own decision, and its rollout would roll the hosted `redis-0`.
- Setting `maxmemory` or pod resource limits for Redis.
- Pinning `redis:latest` / `imagePullPolicy: Always` in the chart and appliance profile. This is a real risk (an unplanned major-version jump on any pod restart) and should get its own card.
- Recovering events lost before this fix ships. Events published before a non-persistent restart are gone. The runbook below covers the customer.
- Extracting a shared consumer-group registry (decision 6). It is tracked by the `LEVERAGE` markers.
- Other `*.bak` files under `helm/templates/`.
- Changing the publish path. `XADD` recreating the stream without a group is fine once consumers heal.

## Risks

| Risk | Mitigation |
|---|---|
| The B rollout restarts `redis-0` once with an empty dataset (see Shipping order) | Ship A before or with B. Step 5 verifies it. |
| Hosted Redis accidentally rolls | The opt-in key, plus a byte-identical render test against the chart defaults |
| Recreating at `0` after a stream survived but its group did not (for example `XGROUP DESTROY`) redelivers up to `MAXLEN` old entries | Handler-level `processed_events` and `processed_event_handlers` sets plus the consumer ledgers. Note that those sets have a 3-day TTL, so entries older than that could be reprocessed. Streams are trimmed, and this scenario needs manual group deletion. Accepted. |
| A multi-stream `XGROUP CREATE` sweep on every NOGROUP | It only runs on NOGROUP. It is one round trip per subscribed stream, and `BUSYGROUP` is cheap. |
| AOF disk growth on the 20Gi local-path volume | Auto-rewrite defaults (`auto-aof-rewrite-percentage 100`, `min-size 64mb`) and stream `MAXLEN` trimming keep it bounded |
| AOF fsync latency on a slow appliance disk | `everysec` runs fsync off the main thread. The worst case is about 1 s of loss on a crash. |
| A truncated AOF after a hard power loss stops Redis from starting | Redis 7 loads truncated AOF tails by default (`aof-load-truncated yes`). Corrupt mid-file data still needs `redis-check-aof`. Add this to the runbook. |
| The `sh -c` command bypasses the image entrypoint, so Redis runs as root | No change from today. Root can write to `/data` on local-path. |

## Operator runbook (customer appliance now, and for the PR description)

On the appliance host (`K="kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml -n msp"`):

1. Confirm Redis restarted more recently than alga-core:
   - `$K get pods -o wide | grep -E 'redis|alga-core|email-service'`
   - `$K exec redis-0 -- sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO server | grep uptime_in_seconds'`
2. Confirm the group is missing: `... XINFO GROUPS "alga-psa:event-stream:emailservice::v7:TICKET_CREATED"`.
3. Workaround until A ships: `$K rollout restart deployment/alga-core-sebastian` (or whichever deployment logs the error). Restarting clears the in-memory cache and recreates the groups at id 0. Events published since Redis came back are delivered; events from before the Redis restart are lost.
4. After B ships, if Redis will not start and logs a bad AOF: run `redis-check-aof --fix` against `/data/appendonlydir/*.incr.aof`.
