# Storage reconcile lock: make it impossible to wedge — design

Card: `0e04bf28` — Appliance install: storage reconcile lock held by a zombie PID is never reclaimed (DSI alga-2026-0003233)
Step: Design Session (conn, delegated desk work), 2026-11-17
Ticket: alga-2026-0003233 (Digital Systems Integration Inc., Oscar Nuñez)

## Problem

`install-storage.sh` serialises reconciles with an **atomic symlink whose target is the owner's PID**
(`ee/appliance/scripts/install-storage.sh:47-61`, `:63-88`). Ownership is decided by
`kill -0 "$owner"` alone. Three things follow, and all three are the same defect:

1. A **zombie** owner still satisfies `kill -0`, so the lock is never reclaimed and every wizard retry
   burns the full 150 × 2 s budget and fails again (the reported symptom).
2. A PID written by a **previous container instance** can match an unrelated live process in the next
   instance (PID namespaces restart at low numbers), so the lock blocks just as permanently.
3. The lock file outlives the container while the PID is only meaningful *inside* one instance
   (`/var/lib/alga-appliance/storage-reconcile.lock` is host-shared storage), which is exactly how a
   stale PID comes to be read by a different namespace.

Every one of these is a *hand-rolled liveness test standing in for a mutual-exclusion primitive the
kernel already provides*. Adding a zombie check and a process-identity check would fix today's report
and leave the next variant of it (PID reuse by a same-named process, a container restarted mid-run, a
stale symlink surviving a reinstall) to be discovered by a customer.

## Decision

**Replace the PID-symlink lock with a `flock(2)` advisory lock on a regular file.** The kernel holds
the lock; it is released when the holding process exits for any reason — normal exit, `SIGKILL`, and a
zombie is *already* exited. Ownership is not keyed on PIDs at all, so zombie state, PID reuse and
container-instance changes stop being cases to reason about. `flock` is guaranteed present: the
runtime image is `node:22-alpine` with `apk add ... util-linux`
(`ee/appliance/control-plane/Dockerfile:17`; `/usr/bin/flock` verified). On the ISO host (Ubuntu 24.04
noble server-minimal, `ee/appliance/ubuntu-iso`) `util-linux` is a Debian `Essential: yes` package, so
`flock` is always present and no host package change is needed.

This is the general mechanism, not the narrow fix: it makes the entire class of "the lock's owner
record went stale" impossible rather than enumerating the ways it can go stale.

### Change 1 — installer lock

`ee/appliance/scripts/install-storage.sh`:

- Keep `LOCK_PATH` and `LOCK_WAIT_ATTEMPTS` exactly as they are (same env names, same 2 s cadence, same
  timeout message: the wizard, the log and the customer's mental model stay identical).
- **Migration, before acquiring:** if `$LOCK_PATH` is a symlink or a directory (the two shipped
  schemes — the symlink scheme and the older mkdir scheme), remove it. A *live* old-build holder is
  indistinguishable from a stale one on disk and now can only exist during a mixed-version upgrade;
  because reconciliation is idempotent `kubectl apply` (already relied on by the existing best-effort
  reclaim comment at `:49-53`), overlapping one legacy run is safe, and permanently wedging the box is
  not. Record the removal in the log line so it is diagnosable.
- **Acquire:** `exec 9>"$LOCK_PATH"`, then `flock -n 9` in the existing attempt loop; on timeout
  print the current message and exit 1. `flock` is checked with `command -v` first and a missing binary
  fails loudly (no PID-lock fallback).
- **Migration race (inode check):** a process may remove the legacy symlink while another still has the
  old path open. After `flock` succeeds, the device:inode of fd 9 (`stat -L /proc/self/fd/9`) must equal
  that of `$LOCK_PATH`; if not, close fd 9 and reopen/retry. This keeps "one holder" true across the
  migration. This is the only `/proc` read besides the diagnostic `boot_id`.
- **Diagnostics, not correctness:** after acquiring, truncate and write `pid hostname instance startedAt`
  into the file (`/proc/sys/kernel/random/boot_id` as the instance token) so an operator reading
  `storage-reconcile.log` can see who held it last. Nothing ever reads this to decide ownership.
- **Release:** delete the `trap ... rm -f "$LOCK_PATH"` line. No cleanup is needed or wanted: the fd
  closes on exit and the kernel drops the lock. Deleting the file would be actively wrong — it races a
  waiter that already has the inode open (unlink + recreate lets two holders exist), which is a second,
  independent bug in the current scheme.
- Delete `lock_reclaimed_if_stale()`; it has no remaining caller.

### Change 2 — reaping the orphans that produced the zombie

`ee/appliance/scripts/control-plane-entrypoint.sh:44-64` backgrounds two repair jobs and then
`exec node .../server.mjs`, making node **PID 1 of the container**. PID 1 does not reap orphans, so
every finished background child becomes a zombie for the life of the container. The lock no longer
cares, but the class of bug does (it also hides `wait`-free failure reporting and burns PIDs).

`ee/appliance/control-plane/Dockerfile`: add `tini` to the runtime `apk add` and set
`ENTRYPOINT ["/sbin/tini", "--"]` (Alpine's tini installs to `/sbin/tini`, verified; the existing `CMD` is unchanged). tini runs as PID 1, so node is a
normal child, and every orphaned grandchild is reaped. One line of package, one line of ENTRYPOINT,
and no script change — deliberately *not* "make the entrypoint wait", which would serialise startup
behind a 5 s-delayed repair and still leaves node as PID 1 for anyone else's orphans.

### Change 3 — what deliberately does NOT change

- **`setup-engine.mjs` `installStorage()` (`:732-770`)** keeps running the installer synchronously and
  keeps recording `storage-install-blocked` on failure. It gets **no lock handling**: with a
  kernel-owned lock there is nothing stale for the wizard to clear, and a second place that deletes
  lock files would reintroduce exactly the race this design removes. This answers the card's open
  question — the retry path must *retry*, not repair.
- **No PID/zombie/identity heuristics anywhere.** No `/proc/<pid>/stat` state parsing, no cmdline
  matching, no "is this really a storage process" check. Those are the reasoning this change deletes.
- **Lock semantics unchanged:** one reconcile at a time, waiters wait, the wait budget and message are
  the same, and the reconcile itself stays idempotent.

## Acceptance mapping

| Acceptance criterion | Covered by |
| --- | --- |
| Zombie-PID lock is reclaimed and setup completes | new scheme: the zombie holds no `flock`; the legacy symlink is removed at acquire |
| Lock pointing at a live, unrelated (reused) PID is reclaimed | same — ownership is no longer a PID |
| A genuinely running reconciliation still blocks a second run | `flock -n` fails → existing wait loop and timeout message |
| Fresh ISO install passes storage setup without hand-deleting the lock | no staleness path remains; the container's first run creates the file |
| Tests for zombie and reused-PID cases alongside the existing three | Change 4 |

## Tests

`ee/appliance/host-service/tests/install-storage.test.mjs` (existing harness, `createHarness()` with
`ALGA_APPLIANCE_STORAGE_LOCK_PATH` in a temp dir):

1. **Legacy symlink at a zombie** → installer succeeds; the symlink is gone and a regular file lock was
   used. Create a real zombie in the test (`spawn` a child, do not `wait` it, let it exit) rather than
   asserting a mock, so the regression is the customer's actual shape.
2. **Legacy symlink at a live, unrelated PID** (the test runner's own PID, i.e. today's "live holder"
   case inverted) → reclaimed, installer succeeds.
3. **Legacy mkdir directory** → reclaimed (existing test, kept).
4. **Genuine holder still blocks** → replace the current symlink-at-runner-PID test: a holder process
   takes the `flock` on the same path (`bash -c 'exec 9>"$1"; flock 9; sleep 5'`), and the installer
   with `ALGA_APPLIANCE_STORAGE_LOCK_ATTEMPTS=1` must fail with the unchanged timeout message and must
   **not** delete the lock file.
5. **Release on hard kill** → start an installer (or a holder), `SIGKILL` it, then assert the next run
   acquires immediately. This is the property that replaces the old "cleanup trap never ran" test.
6. **Serialisation** → two installers started together both succeed and their bodies do not interleave
   (marked by the fake kubectl, which the harness already controls).

The harness's `lockAbsent()` helper must be re-expressed as "no flock is held" (try to take it) — with
this design the lock *file* legitimately remains on disk.

## Risks / implementation notes

- **`flock` must exist wherever the script runs.** The control-plane image already installs
  `util-linux`; the ISO also bakes these scripts onto the host, so the implementation must confirm the
  host path gets them from a base image that ships `util-linux` (the same check the existing script
  makes for `kubectl`/`k3s` via `command -v`). Do not add a silent PID-lock fallback — a missing
  `flock` must fail loudly at acquire with the command it needs.
- **Upgrade window:** a control-plane update can replace the container while an old-build run holds the
  symlink lock. The migration removal covers it; note it in the release notes on the ticket.
- `set -euo pipefail` plus `exec 9>` and `flock -n 9` inside a `while` loop: `flock -n` failing must not
  trip `set -e` — guard it (`if flock -n 9; then break; fi`), as the existing loop already does for
  `ln -s`.
- Bash 4 `{fd}` redirection is unavailable on the entrypoint's `sh`; the installer is `#!/usr/bin/env
  bash` and the image ships bash, so a fixed fd 9 is fine — state it in the code comment rather than
  probing for `bash`.
- Follow-up, out of scope: the card's open question about which process wrote PID 13 (the entrypoint
  background run vs the wizard's synchronous run) becomes moot for the lock, and is only needed for the
  ticket reply; the change 2 reaping fix removes the zombie source either way.
