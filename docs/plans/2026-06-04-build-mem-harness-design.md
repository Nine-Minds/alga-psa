# Build memory measurement harness — design

**Date:** 2026-06-04
**Branch:** `improve/build-memory-consumption`
**Goal:** A repeatable tool that runs `npm run build`, verifies the build works, and
measures **peak memory consumption** of the whole build — so we can drive a
build-memory optimization loop with before/after numbers.

## Background / what the build is

`npm run build` (from repo root) is a three-stage chain:

1. `build:assemblyscript` — `node scripts/build-assemblyscript-if-needed.mjs`
2. `npx nx build-deps server` — builds shared/dependent workspace packages
3. `cd server && next build --turbo` — the heavy stage
   (`NODE_OPTIONS=--max-old-space-size=8192`, Next.js 16, community edition)

The build is a **process tree** (npm → nx → next → worker processes), so a
meaningful peak must cover the whole tree, not a single process.

## Key findings that shaped the design

- **`node` on this host is a snap** (`/snap/bin/node` → `snap run`). snap
  **relocates every node process into its own `snap.node.node-*.scope` cgroup**,
  escaping any `systemd-run --user --scope` wrapper. So the clean "wrap the build
  in one scope, read its `memory.peak`" approach does **not** work on the host —
  the build's node processes scatter across snap-managed cgroups.
- Running the snap-internal node ELF directly (`/snap/node/current/bin/node`)
  avoids relocation but does **not** run node correctly (needs snap's runtime env).
- **Docker fixes this cleanly.** Inside a container, `node` is a normal ELF (no
  snap), and the entire container runs in **one cgroup** that exposes
  `memory.peak` on cgroup v2. Verified on this box: a 300 MB allocation in a
  container registered as `memory.peak` ≈ 313 MB even after `memory.current` fell
  back — i.e. `memory.peak` captures the true whole-tree high-water mark with no
  sampling. This is also the *representative* number: CI builds images in
  containers, so the container peak is what OOMs under a memory limit.
- **Host node is v24; project pins node 20 for runtime.** The host
  `node_modules` (≈3.8 GB) has native addons built for node 24's ABI, so they
  will not load under node 20. Decision: use a **`node:24-bookworm`** container
  and **reuse the host `node_modules` as-is** (zero install, fast loop). This
  reproduces the *host* build exactly, isolated in a container for clean cgroup
  measurement. Verified the host `node_modules` load in `node:24-bookworm`
  (container glibc 2.36 < host 2.43, but the prebuilt addons target old glibc):
  `next/dist/build/swc` requires OK, `next --version` → 16.2.6, `esbuild` works.
  (CI uses node:20; absolute numbers may differ slightly from CI — acceptable for
  a relative before/after optimization loop.)

## Architecture

Two files, siblings of the existing `scripts/build-perf-harness.mjs`:

### `scripts/build-mem.sh` — host wrapper (bash)
Host `node` is snap, so the wrapper is bash and only shells out to docker:

```
docker run --rm -v <repo>:/work -w /work [--memory <limit>] <image> \
    node scripts/build-mem-harness.mjs <flags>
```

- Default image `node:24-bookworm`; `--image` to override.
- `--memory` (optional) passes through to docker to test a memory ceiling
  (e.g. `--memory 8g` → "does the build fit in 8 GB?"). Unset = all host RAM.
- All other flags pass through to the harness.
- cgroupns is docker's default (private), so the container's `/sys/fs/cgroup` is
  its own cgroup root and `memory.peak` is the whole-container high-water mark.

### `scripts/build-mem-harness.mjs` — runs inside the container
1. **Clear** (default; `--skip-clear`): remove `server/.next` and
   `server/tsconfig.tsbuildinfo` for a representative cold build.
2. **Build**: spawn `bash -lc '<build-cmd>'` (default `npm run build`) from
   `/work`, tee stdout/stderr to `.build-mem/build-<label>.log`.
3. **Sampler** (~150 ms; `--interval-ms`): BFS the build's `/proc` descendant
   tree, sum **PSS** (`/proc/<pid>/smaps_rollup`, avoids double-counting shared
   pages), tag each sample by stage (precedence next-build > build-deps >
   assemblyscript, detected from cmdlines). Tracks per-stage peak, the
   global-peak sample's per-process snapshot, and a timeline.
4. **Headline**: on build exit, read `/sys/fs/cgroup/memory.peak` (bytes) — the
   authoritative whole-container peak. Container is fresh per run, so it reflects
   only this build (the harness/clear steps are negligible vs an 8 GB build).
5. **Verify** (exit 0 + artifacts): build must exit 0 **and** produce
   `server/.next/BUILD_ID` (+ best-effort manifest checks). Non-zero on any
   failure so a loop driver detects regressions.
6. **Output**: human summary (cgroup peak headline + per-stage PSS breakdown +
   top processes at peak + duration + verify table), a single
   `[BUILD-MEM RESULT] {json}` line, and `.build-mem/result-<label>.json` +
   `.build-mem/timeline-<label>.csv` for before/after diffing.

### Division of labor
- **cgroup `memory.peak`** (container) = rock-solid headline number.
- **PSS sampler** = attribution only (which stage/process drives the peak —
  what you actually optimize). Sampling can miss sub-150 ms spikes, but build
  peaks are sustained over seconds, so the sampler's role as *attribution* (not
  the headline) makes this immaterial.

## Flags
`--build-cmd <cmd>`, `--label <name>`, `--skip-clear`, `--interval-ms <n>`,
`--json-only` (harness); `--image <ref>`, `--memory <limit>` (wrapper).

## Out of scope (covered elsewhere / YAGNI)
- Booting the server / route smoke test — the existing `build-perf-harness.mjs`
  already does that (needs postgres/redis).
- Per-stage *cgroup-isolated* peaks (running each stage as its own container) —
  the PSS sampler covers per-stage attribution; revisit only if sampler
  attribution proves too coarse.

## Artifacts
`.build-mem/` (gitignored): `build-<label>.log`, `result-<label>.json`,
`timeline-<label>.csv`.
