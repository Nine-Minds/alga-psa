# SCRATCHPAD — nx modularity to cut the turbopack compile floor

## Context (from the build-mem campaign, PR #2629)

- `npm run build` peak, after R1+R2 (externalize deps + cap static-gen workers to 4),
  is **10937 MB median** (was 14175). Build ~58s. Committed on branch
  `improve/build-memory-consumption`.
- Post-R2 the peak is **one process: `next build --turbo` at ~9 GB**, mostly
  turbopack **native (Rust) compile memory**. Confirmed via harness cmdline capture.
- Harness: `scripts/build-mem.sh -- --label X [--json-only]`
  (node:24 container, cgroup memory.peak; results in `.build-mem/result-X.json`).
  Forwards `NEXT_BUILD_CPUS`, `NODE_OPTIONS`. Run >=3x; **run-to-run variance ~= 1 GB**
  (sigma~400 MB), so a win must beat ~1 GB to be unambiguous.
- Levers already proven sub-noise/worse: NODE_OPTIONS heap, `turbopackMemoryLimit`,
  webpack (13.3 GB / 316 s - worse), client-lib `ssr:false` (~0.5% server-side compile only).

## The hypothesis

`server/next.config.mjs` `turbopack.resolveAlias` forces ~20 workspace packages to
resolve to their **`src/`** (e.g. `'@alga-psa/ui': '../packages/ui/src'`). So turbopack
**recompiles all that TS/TSX from source** every build. nx already models these as
separate buildable projects. If turbopack consumed each package's **prebuilt `dist`**
instead, it would skip that compilation -> lower the ~9 GB native compile peak.

**MUST validate cheaply before the big rollout** - turbopack still parses/bundles the
dist JS, so the saving may be smaller than hoped. Spike first, measure, then commit.

## Hard blockers found (why prior team reverted "USE_PREBUILT dist")

1. **tsup emits only barrel index entries.** `packages/ui/tsup.config.ts` `entry` =
   `{ index, components/index, ui-reflection/index, keyboard-shortcuts/index, lib/index,
   hooks/index }`. But consumers use **deep sub-paths**:
   `@alga-psa/ui/components/Button` x3488, `.../lib/*` x894, `.../ui-reflection/*` x138,
   hooks x53, editor x27, context x27, keyboard-shortcuts x26, services x6, **presence x4**.
   dist has no `components/Button.mjs` -> those imports won't resolve from dist.
2. **`@alga-psa/ui` build currently FAILS:** esbuild can't resolve
   `/fonts/DigitalNumbers-Regular.ttf` & `/fonts/Inter-VariableFont*.ttf` referenced in
   `src/editor/TicketDetails.module.css`.
3. **`exports` map gaps:** has `./components/*`, `./lib/*`, etc. but missing some used
   segments (e.g. `./presence`, `./context/*`). `exports` types->src, import->`./dist/*.mjs`.
4. All src-aliased packages currently have **empty dist** (nx build-deps doesn't build them
   while src-aliased).

## Key decisions

- **Spike-gated.** Phase 0 spike on the 1-2 biggest-footprint packages to confirm a
  >noise compile-peak drop BEFORE doing the per-subpath build work for all packages.
- **Don't touch the 3488 import sites.** Make `dist` expose the sub-paths (glob tsup
  entries + complete `exports`), keep app imports as-is.
- **Budget guard:** total `npm run build` wall-clock must not regress beyond variance
  (added nx build time must be < turbopack savings). Measure end-to-end via the harness.
- **Runtime validation is mandatory** (build-pass != runtime-correct): live env via
  alga env skill + algadev browser pane smoke of high-`@alga-psa/ui`-traffic flows
  (login, MSP dashboard, tickets list+detail (editor), clients, settings).

## Commands / paths

- Harness: `cd ~/alga-psa.worktrees/improve/build-memory-consumption && scripts/build-mem.sh -- --label X --json-only`
- Config aliases to remove: `server/next.config.mjs` `turbopack.resolveAlias` (grep `'/src'`)
- Package builds: `packages/*/tsup.config.ts`, `packages/*/package.json` (`exports`)
- nx: `npx nx build @alga-psa/<pkg>` ; `npx nx build-deps server`

## Open questions / TODO
- (Phase 0) Which packages have the biggest src compile footprint? (LOC/file count)
- Does tsup `entry: ['src/**/*.{ts,tsx}']` glob + `splitting:false` produce resolvable per-file dist? Build-time cost?
- Will removing src aliases break the `@`/`server/src`/EE aliases that must stay? (only remove `@alga-psa/*` -> src ones)
