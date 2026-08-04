# Appliance update interruption recovery plan

Date: 2026-08-03

## Goal and invariant

Recover app-channel updates interrupted by a control-plane restart without allowing concurrent mutations.

Persisted update-queued or *-running text records intent, not proof of a live owner. Boot-time reconciliation must land before the 409 guard; reversing that order would preserve the current permanent wedge.

## Current implementation

- ee/appliance/host-service/server.mjs owns POST /api/updates. It writes update-queued and queueUpdateWorkflow(channel) launches an unobserved detached update-engine.mjs child.
- ee/appliance/host-service/update-engine.mjs writes running phases and terminal update-complete/update-blocked. Its CLI catch handles ordinary exceptions, but not SIGKILL, pod loss, or host restart.
- ee/appliance/host-service/manage-engine.mjs maps install state to the Manage API and suppresses some blocked state when live Helm readiness proves convergence.
- ee/appliance/status-ui/app/manage/ManageView.tsx starts updates, polls while locally busy, and renders terminal messages.
- ee/docs/appliance/architecture.md and ee/appliance/docs/registry-metadata-design.md establish durable host-path state, explicit operator updates, signed channel resolution, and pinned manifest digests. Recovery must preserve those boundaries.
- Existing behavioral coverage lives in tests/update-engine.test.mjs, tests/manage-engine.test.mjs, and status UI smoke tests.
- package-lock.json is already modified by Wire Up. Do not stage, revert, or reformat it.

## 1. Explicit owner generation

Add ee/appliance/host-service/update-ownership.mjs with pure, injected helpers:

- isUpdateInProgressStatus(status): recognize only update-queued, update-running, release-config-running, and storage-install-running; never setup states.
- classifyUpdateOwner(state, { nowMs, isPidAlive, maxAgeMs }): return none, live, dead, aged, or invalid plus a reason.
- interruptedUpdateState(state, classification, nowIso): build the canonical retry-safe terminal state.

Every queued/running state carries update.owner = { pid, startedAt }, alongside requestedChannel and scope. Use both fields as the generation identity. process.kill(pid, 0) success or EPERM means present; ESRCH means dead. Missing/non-positive PID or invalid/future timestamp is invalid. A live PID older than configurable ALGA_APPLIANCE_UPDATE_OWNER_MAX_AGE_MS is aged; default well beyond the existing 15-minute Flux envelope. Terminal states clear owner.

Change queueUpdateWorkflow to generate startedAt, spawn first, return child.pid, and pass --started-at to the child. Publish update-queued only after a real PID exists. A spawn failure must not create a running state.

## 2. Boot-time reconciliation first

Add reconcileInterruptedUpdate() using shared atomic state helpers. Invoke it synchronously during server.mjs initialization before server.listen.

For an in-progress state:

1. Fresh verified owner: preserve it and log adoption.
2. Dead, aged, missing, or invalid owner: atomically replace it (temporary sibling plus rename) with status update-blocked, phase update-interrupted, preserved requested channel/scope, no owner, current updatedAt, and a failure containing:
   - category update-interrupted
   - phase update
   - step recover-update-owner
   - a clear interruption message
   - classifier reason as suspectedCause
   - retry instruction as suggestedNextStep
   - retrySafe true
3. Append the same event to update history through a shared exported history writer.

Do not auto-resume at boot. Reconciliation unlocks an explicit retry; it does not repeat registry or rollout work.

## 3. Live-owner-only 409 guard

In POST /api/updates, after auth/method validation and before overwriting state:

- Re-read and classify state using the same helper.
- Return 409 only for a fresh live owner, with structured JSON: error, code update_in_progress, retryable true, and requestedChannel/startedAt/status.
- For dead, aged, or invalid ownership, reconcile immediately to close the post-boot race, then permit a new generation.
- Never reject solely because the stored status string is queued/running.
- Serialize start decisions in-process so simultaneous requests produce one spawn and one 409.

## 4. Engine ownership and terminal failure plumbing

In update-engine.mjs:

- Extend parseRunArgs with --started-at. Build owner from process.pid plus that timestamp (generate one only for direct CLI use).
- Thread owner through runAppChannelUpdate and setup-engine helpers that write release-config-running or storage-install-running. The longest phases must not erase ownership.
- Centralize transitions and terminal failure writes. Validation, storage, registry, and Flux failures retain detailed causes but clear owner.
- Success preserves channel/version/digest results, writes update-complete, clears owner, and appends history.
- Best-effort SIGTERM/SIGINT handlers write update-blocked/update-interrupted. Boot reconciliation remains authoritative for uncatchable exits.

## 5. Manage API and UI

In manage-engine.mjs, include optional code/category, retrySafe, startedAt, and requestedChannel beside update status/message.

Do not erase update-interrupted merely because HelmRelease is Ready: readiness proves serving health, not transaction completion. Retain current readiness suppression only for rollout/convergence failures it disproves.

In ManageView.tsx:

- Treat 409/update_in_progress neutrally: show already running since startedAt, keep polling, and do not label the start failed.
- Render update-interrupted as actionable blocked state with backend detail and Retry enabled.
- Keep other 4xx/5xx responses as errors.
- Never infer PID liveness in React.

## Behavioral regression tests

Add tests/update-ownership.test.mjs for exact status recognition, fresh live PID, ESRCH dead, EPERM live, aged owner, malformed/missing/future owner, and canonical interrupted state preserving intent while clearing owner.

Refactor startup/route logic into exported dependency-injected helpers, or launch the server with temp files, to test:

- boot dead-owner running state becomes interrupted before traffic;
- boot live owner remains running;
- live-owner POST returns 409 without spawn/write;
- stale text plus dead owner reconciles then starts a new generation;
- concurrent POSTs produce one child and one 409;
- spawn failure leaves no orphaned running state;
- setup-running state is ignored by the app-update guard.

Extend update-engine.test.mjs and manage-engine.test.mjs:

- owner survives initial, release-config, and storage phases;
- success and every failure clear owner and preserve cause;
- CLI exception becomes retry-safe terminal state;
- interrupted remains blocked despite Ready HelmRelease;
- a genuine recovered convergence failure is still suppressed.

Use a React behavioral test only if a DOM harness is practical. Otherwise manually validate start, duplicate 409, process/control-plane interruption, restart, interrupted message, retry, and a new owner generation. Do not add source-string tests.

## Delivery order

1. Ownership and atomic transition helpers plus unit tests.
2. Boot reconciliation plus integration tests.
3. PID and startedAt propagation through every running phase.
4. Live-owner-only guard plus concurrency and spawn-failure tests.
5. Manage API structured plumbing.
6. UI handling and manual restart/retry validation.
7. Operational documentation.

Boot reconciliation and the guard must not ship in the opposite order.

## Deliberate non-goals

No automatic resume, distributed lock or Kubernetes Lease, rollback of already-applied Flux work, setup-workflow ownership redesign, registry signature/channel changes, OS/k3s update changes, host-agent protocol changes, or unrelated lockfile cleanup.

## Risks and mitigations

- PID reuse: pair PID with timestamp and a conservative age ceiling.
- Start race: serialize classify/spawn/persist.
- Crash between spawn and parent write: pass generation to the child and have it write immediately; centralize transitions.
- Helper overwrites: assert owner at every running phase.
- False aging: configurable ceiling and explicit failure reason.
- Corrupt state: atomic writes.
- Misleading readiness: never erase transaction interruption using serving readiness.
- Retry side effects: rely on existing declarative release-selection, storage, and Flux reconciliation, then exercise restart/retry manually.
