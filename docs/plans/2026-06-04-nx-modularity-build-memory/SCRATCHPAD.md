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

## SPIKE RESULTS (2026-06-05) — hypothesis CONFIRMED

- **esbuild PRESERVES `'use server'`/`'use client'` directives** per file. The earlier
  "0 dist directives" was only because `bundle:false` + index-only entries never emitted
  the leaf files. Fix = **glob entries**.
- **Working tsup pattern** (billing): `entry: ['src/**/*.ts','src/**/*.tsx', '!**/*.test.*','!**/*.stories.tsx','!**/*.d.ts']`,
  `bundle:false`, `format:['esm']`, `external:[/^@alga-psa\//, react, next, ...]`.
  → 361 per-file `dist/*.mjs` mirroring src, **all 206 directives preserved**, build 161 ms.
- **Exports pattern** that resolves deep imports: add `"./*": { "types":"./src/*.ts","import":"./dist/*.mjs" }`
  alongside the exact barrel entries (exact wins for `./actions`; `./*` catches `./actions/invoiceGeneration`).
- **Removed** billing's 6 `resolveAlias` lines in next.config.mjs → turbopack falls through to exports→dist.
- **Measured (billing only):** peak **10937 → 9976 MB (−961 MB)**, build green (ok=true), no
  billing resolution errors, dur 58.3s (no regression). Main `next build` proc 9.1→8.5 GB.
  billing = 175K LOC of ~500K+ total src-aliased LOC → rollout to ui/projects/clients/auth/...
  should STACK to multi-GB. **GO.**
- Note: `"./*"` types→`./src/*.ts` won't match `.tsx` component types (type-check only;
  turbopack build uses the `import` condition → dist, so build is green). Revisit types later.
- Open: billing dist must be built before next build. Spike built it manually; rollout must
  wire packages into `nx build-deps server` (F014) so dist is always fresh.

## Wiring (2026-06-05)

- nx infers deps from imports, NOT package.json (no @alga-psa/* in server deps yet nx builds 46).
  billing/ui are leaf app-only imports nx build-deps doesn't reach -> NOT auto-built.
- Fix: added root `build:vertical-deps` = `nx run-many -t build -p @alga-psa/billing`,
  inserted into `build` and `build:ce` after `nx build-deps server`. Extend the `-p` list
  as more not-auto-built packages are dist-aliased (ui, client-portal, ...).
- Verified: removed manual billing dist, ran harness -> chain rebuilt billing dist,
  build green (ok=true, 10238 MB single run). billing dist-aliasing is self-contained + wired.

## RUNTIME VALIDATION plan (mandatory before merge)

- Production build consumes dist (via build:vertical-deps). `npm run dev` does NOT run
  build:vertical-deps -> billing dist must be built first for dev, OR validate via prod
  `next start`. Simplest: build billing dist (`npm run build:vertical-deps`) then bring up
  env, OR run a full `npm run build` + `next start`.
- Smoke (algadev browser): login -> MSP dashboard -> a billing/invoices page (exercises
  @alga-psa/billing/actions server actions via dist) -> tickets (editor). Watch console for
  module-resolution / 'use server' boundary / undefined-export errors.

## MATERIAL FINDING (2026-06-05): dev-mode tradeoff + fix

- Removing the `src` resolveAlias means turbopack resolves @alga-psa/billing -> exports -> **dist**
  in BOTH prod build AND `npm run dev`. But `dev:turbo` does NOT run `build:vertical-deps`, and
  dist-consumption loses package-**source hot-reload** (dev would serve stale dist). This is likely
  why the team kept src aliases.
- **FIX = conditional aliasing:** apply the @alga-psa/* -> src resolveAlias only when
  NODE_ENV !== 'production' (dev keeps src + hot-reload); for the production build the alias is
  absent so turbopack uses exports -> dist (memory win). `next build` sets NODE_ENV=production.
- Consequence: **runtime validation must use the PROD build path** (npm run build + next start),
  not the dev-from-source stack (which would still use src under conditional aliasing).
- TODO: implement conditional gate around the @alga-psa/* src aliases in next.config.mjs; re-run
  harness (prod) to confirm dist still consumed + win holds; confirm dev still resolves src.

## Rollout status
- DONE: billing (175K LOC) — tsup glob + ./* exports + alias removed + wired. -961MB (median spike).
- Next batch (already nx-built, just need tsup-glob + ./* exports + alias removal):
  projects(54K), clients(35K), scheduling(35K, NO tsup.config!), documents(27K, NO tsup!),
  auth(16K), assets(16K). Non-uniform builds -> handle individually.
- ui(39K): build BROKEN (fonts in TicketDetails.module.css) + deep imports -> needs build fix first.
- Skip long tail (types type-only/erased; teams/validation/portal-shared tiny).

## Open questions / TODO
- (Phase 0) Which packages have the biggest src compile footprint? (LOC/file count)
- Does tsup `entry: ['src/**/*.{ts,tsx}']` glob + `splitting:false` produce resolvable per-file dist? Build-time cost?
- Will removing src aliases break the `@`/`server/src`/EE aliases that must stay? (only remove `@alga-psa/*` -> src ones)

## KEY INSIGHT (2026-06-05): webpack already dist-aliases; turbopack didn't

- next.config has `prebuiltDir(pkg) = USE_PREBUILT ? dist : src` (line 35) and the
  WEBPACK `config.resolve.alias` block ALREADY uses it for 11 packages (auth,
  notifications, clients, types, core(+rateLimit), validation, formatting,
  event-schemas, sla, assets, tags). The earlier webpack build (green) PROVES dist
  resolves for these. The TURBOPACK block just never got migrated -> still `src`.
- So the rollout = point turbopack aliases at prebuiltDir() too (parity w/ webpack).
- Done + measured green: clients, tags, event-schemas, validation, formatting.
  cstack1 (billing+clients+4 small) = 9969 MB, 57.5s, ok, 0 resolution errors.
- Webpack uses only bare+trailing-slash for auth/assets/notifications (NO specific
  remaps) -> relies on package exports for shallow paths. Turbopack block currently
  has specific remaps (auth 9, assets 2, notifications 3, core 2). OPEN: does
  turbopack fall back to exports if the trailing-slash dist alias misses a shallow
  path? Test on one remap pkg (notifications) before removing remaps on auth/assets.
- Non-prebuilt big pkgs (projects 54K, scheduling 35K, documents 27K, client-portal
  36K) are NOT in the webpack prebuilt set -> need converting to the preset + build
  wiring for the bigger wins. Biggest single = projects.

## PARITY COMPLETE (2026-06-05)
- turbopack now mirrors webpack's prebuiltDir dist-aliasing for ALL webpack-prebuilt
  pkgs: clients, tags, event-schemas, validation, formatting, auth, notifications,
  types, core(+rateLimit), assets. (sla not aliased in turbopack -> N/A.)
- Helpers: prebuiltDir(pkg) [bare+slash], prebuiltFile(pkg,distRel,srcRel) [remaps].
  All USE_PREBUILT-gated (dev=src hot-reload, prod build=dist).
- parity batch: 3 runs [10550,10435,9655] median 10435 vs S2 10937. Green, 0 resolution errors.
- NOISE REALITY: per-package wins (~150-250MB) < ~1GB cgroup noise -> don't stack visibly.
  Only billing(175K) cleared noise. nextbuild PSS ~9150 confirms turbopack proc IS reduced.
  CLEARLY-measurable win needs the big non-prebuilt pkgs (projects/scheduling/documents/
  client-portal = 152K LOC) converted to the preset.
- BEYOND-PARITY conversion recipe (projects/scheduling/documents/client-portal): they are
  nx-built but emit no usable per-file dist. Convert each tsup.config.ts to the shared
  makeConfig preset (per-file .js dist), then prebuiltDir/prebuiltFile turbopack aliases.
  projects: own index-only config -> switch to preset; only barrel remaps (actions/components).

## BEYOND-PARITY: projects conversion attempt (2026-06-05) — DEFERRED

- Converted projects/tsup.config.ts to the shared makeConfig preset -> per-file dist
  (109 files, 86 directives preserved). Aliased projects to prebuiltDir in turbopack.
- FAILED: turbopack "Can't resolve './ProjectDetail.module.css'". The preset only
  emits .ts/.tsx; CSS-module files weren't in dist.
- Added `copyAssets()` to the preset (copy .css/.scss/.json src->dist). Worked when I
  ran `npx tsup` FROM packages/projects locally (2 .css copied), but FAILED in the
  nx/container build: projects dist had 0 .css. Root causes:
  1. **copyAssets cwd**: runs relative to process.cwd(); nx invokes the build from a
     different cwd than the package dir, so 'src'/'dist' don't resolve to the package.
     FIX: resolve src/dist from the tsup config dir (e.g. __dirname / import.meta.url),
     not cwd.
  2. **nx cache doesn't track the preset** as an input to projects' build, so editing
     the preset didn't invalidate projects' cache (nx restored pre-CSS output). `nx reset`
     alone didn't fix (the cwd bug remained). FIX: add build-tools to projects' nx
     implicit deps / namedInputs, or inline the asset copy in each package config.
- billing (own glob config, .mjs) built green DESPITE 3 CSS-module imports — its
  CSS-importing components just aren't reached in the build graph (lucky). Same latent
  risk; fix copyAssets cwd there too if it ever surfaces.
- DECISION: reverted the projects turbopack alias to src (branch stays green). Kept the
  preset copyAssets + projects-on-preset (build-staged) for the follow-up. projects/
  scheduling/documents/client-portal dist-aliasing is gated on the asset-cwd + nx-input fix.
