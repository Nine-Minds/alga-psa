# Build memory optimization campaign — 2026-06-04

Measuring peak memory of `npm run build` (community, cold `.next`) via
`scripts/build-mem.sh` in a `node:24-bookworm` container; headline =
container cgroup `memory.peak`. Host: 32 CPU / 60 GB → 31 static-gen workers.

**Rules:** must NOT decrease worker count; must NOT increase build time beyond
baseline (within variance); MAY make structural app changes. 9 rounds.

## Baseline (S0)

The config already carries prior memory work (`productionBrowserSourceMaps:false`,
`serverSourceMaps:false`, large `serverExternalPackages`, `optimizePackageImports`
tried+reverted for +20s/+480s regressions). Measured fresh:

| run | peak (MB) | dur (s) |
|---|---|---|
| base1 | 14175 | 72.5 |
| base2 | 14501 | 68.3 |
| base3 | 13619 | 68.1 |
| **median** | **14175** | **68.3** |

Noise: range ~882 MB, σ≈364 MB. **Acceptance per round: median peak (≥3 runs)
drops > ~400 MB vs prior accepted state, dur not regressed, all builds pass.**

## Rounds

| # | change | peak runs (MB) | median | Δ vs prior | dur median | verdict |
|---|---|---|---|---|---|---|
| 1 | extend serverExternalPackages (+11 server-only deps) | 13324/13314/14112 | 13324 | **−851** | 68.8s | ✅ accept |
| 2a | modularizeImports lucide-react | build FAILED | — | — | — | ❌ revert |
| 2b | staticGenerationMaxConcurrency: 4 | 14163/13473/14034 | 14034 | +710 (worse) | 67.9s | ❌ revert |

**State after R1 (S1):** median peak 13324 MB, dur 68.8s.

> **Rule change (user, mid-campaign):** worker-count reduction is now ALLOWED,
> with a new rule: wall-clock must not regress beyond normal variance
> (warm-cache builds: 66.7–72.5s, median ~68s, σ≈1.6s → bar ≲72s).

| 2 | cap static-gen/page-data workers: `experimental.cpus` default `min(4,cores)` (was host CPU count → 31 workers) | 10538/10937/11678 | **10937** | **−2387** | **58.1s** (−10.7) | ✅ accept |

**State after R2 (S2):** median peak 10937 MB, dur 58.1s. The 31-worker
static-gen pool (each loading the ~290 MB app bundle) was the dominant peak;
capping it collapses onto a **fixed ~9 GB turbopack compilation floor**
(`next build ×4`, ~2.2 GB each, independent of worker count). Build is *faster*
because over-provisioned workers added spawn/load overhead. Worker-count sweep
(1 run each): cpu16=10201, cpu8=10651, cpu4=9888, cpu2=9775 — all ~compile-floor
bound; cap=4 vs cap=8 is within noise at 3 runs.

### Learnings (narrow the search space)
- **Per-worker memory is module-graph-dominated, not render-state.** Capping
  `staticGenerationMaxConcurrency` (concurrent renders/worker) did nothing →
  the only lever is shrinking the module graph each worker loads.
- **Barrels already handled:** lucide-react/date-fns/lodash/recharts/react-icons
  are in Next 16's *default* `optimizePackageImports`. Manual `modularizeImports`
  on lucide broke on its `*Icon` aliases and was redundant anyway.
  `optimizePackageImports` itself was tried by prior work and regressed builds.
- **Common graph is already lean:** root-layout providers are light; `@alga-psa/ui`
  barrel is 16 exports and 966/1062 importers already use subpaths.
- **Worker-count knobs are off-limits or backfire:** more workers (lower
  `staticGenerationMinPagesPerWorker`) would *raise* peak (each pays the shared
  baseline); fewer is forbidden.
- Remaining real lever = code-split heavy SSR'd client libs (blocknote/tiptap/
  prosemirror editor stack — scattered ~25 community files, core stays server-side;
  reactflow/calendar are EE-heavy or few-page).
