# Handle stale Next.js server actions after deploy

Branch: `fix/stale-actions-handling`

## Problem

After a production deploy, logs fill with Next.js `Failed to find Server Action`:

- 858 lines over ~30 minutes (~29/min), **steady and not decaying** across the whole window
- Two dominant action hashes: `7f387937…` 419x, `7f130f7a…` 430x, plus three minor ones
- Blue had deployed ~6h earlier; green had zero in the same window

The non-decay is the surprising part. A stale-client population drains as people navigate, close
tabs, and refresh, so the expected shape is a decay curve, not a flat line.

## Diagnosis (confirmed in code)

**The two hashes are two background pollers.** The MSP global header mounts both side by side on
every authenticated page (`server/src/components/layout/Header.tsx:532-533`):

| Poller | Interval | Rate | Site |
| --- | --- | --- | --- |
| `getQueueMetricsAction` | 15s | 4/min | `server/src/components/layout/Header.tsx:290,304` |
| `getNotificationsAction` | 30s | 2/min | `packages/notifications/src/hooks/useInternalNotifications.ts:149,187` |

**The rate is flat because idle tabs never drain.** A parked tab does not navigate, does not
refresh, and polls forever. There is no decay curve because there is no population turnover.
Neither poller distinguishes a permanently-dead action ID from a transient network blip; both
`catch`, log, and re-fire on the next tick indefinitely.

**Tab arithmetic.** Over the ~30min window: metrics 419 ÷ 30 ÷ 4 ≈ **3.5 tabs**; notifications
430 ÷ 30 ÷ 2 ≈ **7 tabs**. That 2x gap is expected, not anomalous: `JobActivityIndicator` is
MSP-only, but `NotificationBell` is mounted on both MSP (`Header.tsx:532`) and client portal
(`packages/client-portal/src/components/layout/ClientPortalTopBar.tsx:37`). So ~3.5 MSP tabs feed
both hashes and ~3.5 portal tabs feed only notifications. This is why the fix must cover both
surfaces.

**Severity reframe.** These 858 errors are ~5-7 parked tabs polling into the void — not 858 broken
user interactions. The user-facing impact is far smaller than the volume suggests. The real cost is
that a returning user's tab is silently broken until they refresh.

## Root cause (confirmed in installed Next source + verified empirically)

Server action IDs are **not** derived from the build ID. They are:

```
action ID = hash(encryption key salt, file path, export name)
```

The salt is the server actions encryption key — `node_modules/next/dist/build/webpack-config.js:417,443,1921`
(`serverReferenceHashSalt: encryptionKey`), and turbopack takes the same key at
`dist/build/turbopack-build/impl.js:63,109`.

`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is **not set anywhere in this repo**. When unset, Next
generates a random AES-256 key per build (`dist/server/app-render/encryption-utils-server.js:92-112`).
It normally caches that key to `.next/cache/.rscinfo` with a 14-day expiry — **but
`getStorageDirectory()` returns `undefined` when running under Docker** (`dist/server/cache-dir.js`).

We build in Docker. Therefore:

> **Every build generates a fresh random key → every action ID in the app churns on every deploy →
> every open tab goes totally stale at the instant of traffic cutover.**

This is why staleness happens on *every* deploy rather than only when an action actually changes.
`getQueueMetricsAction` has not changed in months; its ID churns anyway.

**Verified empirically** against real turbopack builds of Next 16.2.6 in a scratch app:

| Test | Result |
| --- | --- |
| Pinned key, build IDs `build-AAA` vs `build-ZZZ` | **Identical** action IDs |
| Same build ID, fresh `.next`, no key set | **Completely different** action IDs |
| Pinned key, changed an action's body | **Identical** action IDs |

**Blue/green is not a factor, but it is the trigger.** `nm-kube-config/alga-psa/workflows/composite/alga-psa-build-migrate-deploy.yaml:92-94`
builds **once**; `determine-colors` (`:145`) picks whichever color is currently inactive; both
colors run byte-identical images differing only by a Helm values overlay. So blue and green have
*identical* action IDs — there is no color skew. But each `istio-promote-traffic` cutover (`:201`)
swaps in an image built with a fresh random key, so every tab loaded before the cutover is stale
the moment traffic moves.

## Out of scope / verified safe (do not change)

- **`generateBuildId`** (`server/next.config.mjs:1325`, `'build-' + Date.now()`) — looks like a
  landmine, is **not one**. Verified: a pinned key with differing build IDs yields identical action
  IDs. It only drives *navigation* skew, which Next already self-heals via `doMpaNavigation()`
  (`dist/esm/client/components/router-reducer/fetch-server-response.js:127-130`). **Do not "fix" it
  as part of this work.**
- **Hocuspocus reconnect failure** — notification polling is only supposed to run while the
  websocket is down (`useInternalNotifications.ts:148,186` start it; `:174-177` `onConnect` clears
  it). Flat polling for ~6h means `onConnect` never fires again after a deploy. That is a separate
  bug with a separate fix. Filed as **alga0002135** (PSA development board). Not this branch.
- **`deploymentId` / Next skew protection** — supported (`dist/server/config-schema.js:528`) but
  useless here: the Next server never reads `x-deployment-id` or `?dpl=` (zero hits across
  `dist/server/**`; the docs confirm it). It is infra-level routing metadata. Setting it will not
  make a stale action resolve.
- **`Dockerfile.build` and `ee/server/Dockerfile.build`** — these contain a real `next build` and
  `ARG NEXTAUTH_SECRET_BUILD`, and are **completely unused** by the pipeline (zero references in
  nm-kube-config). They are the abandoned build-in-Docker path. Editing them accomplishes nothing.
  This is the most likely wrong turn for anyone implementing this plan.
- **Runtime env for the key** — do **not** add `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` to
  `helm/templates/deployment.yaml`. Next reads
  `process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY || serverActionsManifest.encryptionKey`
  (`encryption-utils.js:78`), so a runtime value **overrides** the value baked into the build
  manifest. If the two ever drift, closure-argument decryption breaks. Build-time only is both
  sufficient (replicas of one image agree) and safer.

## The fix

Two layers. The cheap one does most of the work.

| Layer | Change | Effect |
| --- | --- | --- |
| Root cause | Pin `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` at build time | Unchanged actions survive deploys — kills most staleness, including both observed hashes |
| Backstop | Catch `UnrecognizedActionError` → halt that poller + show banner | Handles genuinely changed/removed actions, which no key pinning can fix |

### Phase 1 — Pin the key (repo: `~/nm-kube-config`) — **MUST LAND FIRST**

> **Ordering is load-bearing.** Phase 2 hard-fails production builds when the key is unset. If
> Phase 2 merges before Phase 1 is deployed, **every production build breaks immediately** — EE and
> CE both. Land and verify Phase 1 first.

`next build` does **not** run in the Dockerfile. It runs in the Argo `build-app-ee` template.
`ee/server/Dockerfile` is packaging only — it `COPY`s the pre-built `server/.next` (`:67`) and has
no `ARG` lines. A `--build-arg` there would have zero effect.

1. **Generate the key once**: `openssl rand -base64 32`. This is a real secret (it encrypts closure
   variables bound into server actions). Never commit it.
2. **Create a k8s Secret in `namespace: argo`** (the *build* namespace — distinct from the `msp`
   runtime namespace; only the build one is needed here), e.g. Secret `next-server-actions-key`,
   key `encryption-key`.
3. **EE workflow** — `alga-psa/workflows/build/alga-psa-ci-cd-workflow.yaml`:
   - Add an `env:` block to the `build-app-ee` template at `:959` (between `image:` and `command:`).
     **This template currently has no `env:` block at all** — this will be the first.
   - Use `valueFrom.secretKeyRef`, mirroring the house pattern for `GITHUB_TOKEN` at `:1074-1078`.
   - Thread it onto the `next:build` invocation at `:1003`, alongside the existing
     `NEXT_PUBLIC_APP_VERSION` (the closest analogue — see `:1000`).
4. **CE workflow** — mirror the same into
   `alga-psa/workflows/build/alga-psa-ce-build-workflow.yaml` (CE build command at `:610`, existing
   `export` block just above it at `:605-608`). Required: the Phase 2 guard will otherwise break CE
   builds, and CE/self-hosted users have the same bug.
5. **Do not touch the stale duplicates** under `argo-workflow/alga-psa-dev/templates/build/` —
   both `alga-psa-ci-cd-workflow.yaml` (diverged: namespace `argo-workflows`, 1216 lines vs 1923)
   and `alga-psa-ce-build-workflow.yaml` have copies there. The `alga-psa/workflows/build/` copies
   are the current ones.

### Phase 2 — Guard the invariant (this repo) — **after Phase 1 is live**

In `server/next.config.mjs`, fail **production builds** when `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
is unset. Throw with a message naming the variable and pointing at this plan.

> **Gate on build phase, NOT on `NODE_ENV`.** `next start` evaluates `next.config.mjs` at runtime,
> the runtime image sets `NODE_ENV=production` (`ee/server/Dockerfile:101`, launched via
> `server/entrypoint.sh` → `npm start`), and this plan deliberately does **not** set the key at
> runtime. A `NODE_ENV`-gated throw therefore fires in every production pod at startup and takes
> the app down. Instead: convert the config export to the function form
> `export default (phase) => { … return nextConfig }` and throw only when
> `phase === PHASE_PRODUCTION_BUILD` (import from `next/constants`; verified present at
> `dist/shared/lib/constants.js:333`). Runtime evaluates under `phase-production-server` and is
> unaffected.

No escape hatch, and the same rule locally as in CI: a local production build without the key
produces an image with exactly the same footgun, so failing is the honest outcome. A developer who
genuinely needs a local production build sets a throwaway key.

Rationale: a pinned key that silently un-pins puts us right back here, and the only signal would be
a Grafana spike six hours after a deploy. The engine should refuse to produce the footgun rather
than rely on everyone remembering a pipeline env var forever.

### Phase 3 — App-side backstop (this repo)

Staleness is a property of the **client**, not of an action: if any action ID is gone, the client's
bundle provably predates the server's build. But halting is **per-poller** — a poller stops when
*its own* action is provably dead. That rule is correct both today (all IDs churn, so every poller
halts itself anyway) and after Phase 1 (only changed actions die; a poller calling an unchanged
action keeps working and should not be broken for no reason). Stop what is provably futile; do not
break what still works.

**3a. Stale-build store** (`packages/ui`) — a small sticky flag, set once by any dead-action
detection, never unset. Detection uses `unstable_isUnrecognizedActionError` from `next/navigation`
(`dist/client/components/navigation.js:57-58`), **with `error.name === 'UnrecognizedActionError'`
as fallback** — the exported helper is an `instanceof` check, which breaks if duplicate Next client
copies exist, a real risk in this monorepo. Note: an infra-level 404 *without* the
`x-nextjs-action-not-found` header falls into Next's generic error path (`E394`) and will not be
detected; that is acceptable, since the poller then backs off rather than hammering.

**3b. Polling primitive** (`packages/ui`) — the actual leverage. The same shape is currently
hand-written at least four times: `setInterval` + async call + `try/catch` that logs and swallows +
re-fire forever.

- `server/src/components/layout/Header.tsx:283-311`
- `packages/notifications/src/hooks/useInternalNotifications.ts:148,186`
- `server/src/components/settings/general/ClientPortalSettings.tsx:123` (`getPortalDomainStatusAction`,
  5s — page-scoped, would appear as a third hash in the tail)
- EE status pollers (`AccountManagement.tsx:388`, `RunStudioShell.tsx:156`) — state-gated, lower risk

That repetition is the `// LEVERAGE: pattern` signal from `CLAUDE.md` — a missing layer below. The
primitive owns the failure taxonomy once:

- dead action → mark global stale, **stop permanently**
- transient error → **exponential backoff**
- success → reset backoff

Call sites lose their `try/catch` entirely and declare only what to poll and how often.

**3c. Refresh banner** (`packages/ui`) — reads the store, renders the existing `Alert` primitive
(`@alga-psa/ui/components/Alert`). Non-blocking, persistent, with a Refresh button that reloads.

Never auto-reload: this app is full of unsaved ticket comments and time entries, and silently
destroying a half-written comment is worse than the stale tab.

Mount in MSP (`server/src/components/layout/DefaultLayout.tsx:22`,
`server/src/components/layout/AlgaDeskMspShell.tsx:82`) and client portal
(`packages/client-portal/src/components/layout/ClientPortalTopBar.tsx:37`).
`server/src/components/layout/PlatformNotificationBanner.tsx` is the right *shape* to copy but the
wrong *location* to extend — it lives in `server/src` and imports `@enterprise`, so the portal
cannot use it. The new banner must live in `packages/ui`.

**Important property**: after Phase 1, Phase 3 should almost never fire. It is the backstop for
genuinely changed actions, not the mechanism keeping the app alive. If the banner starts appearing
on every deploy, Phase 1 has regressed — which makes Phase 3 a de facto alarm on the real fix.

### Phase 4 — Migrate the call sites

Convert `Header.tsx` and `useInternalNotifications.ts` to the primitive (these two produce the
observed hashes). Then `ClientPortalSettings.tsx`. Leave the state-gated EE pollers unless trivial.

## Verification

**Phase 1 (the fix that matters):** build twice with the same pinned key and diff the action IDs in
`.next/server/server-reference-manifest.json` — identical means it works. Build twice *without* the
key and confirm they differ. This is the experiment that was run empirically during design, so it
is known to discriminate.

**Phase 2:** production build with the var unset fails with the intended message; with it set,
succeeds. Dev server (`next dev`) is unaffected. **Also verify the runtime path**: `next start`
against a built app with the runtime env *not* containing the key must boot cleanly — this is the
phase-gating property, and it is the failure mode a naive `NODE_ENV` guard would hit in production.

**Phase 3 unit tests** — cheap and deterministic; the error predicate is the only Next-specific
surface, tested against a synthetic error by `name`:
- primitive halts permanently on a synthetic `UnrecognizedActionError`
- primitive backs off exponentially on a generic error, resets backoff on success
- primitive clears its interval on unmount
- store is sticky and idempotent
- banner renders when stale, reloads on click

**What cannot be unit-tested:** proving a genuinely stale client gets the banner requires two builds
and a live cutover. Manual check against the dev stack (this worktree runs on port 3164): load a
tab, rebuild with a *different* key to simulate today's behavior, confirm the banner appears and
the poller stops re-firing.

**Post-deploy:** the real proof is the Grafana `Failed to find Server Action` rate going to ~zero on
the next promotion. Watch the window after cutover.

## Files touched

**`~/nm-kube-config`** (Phase 1, lands first):
- `alga-psa/workflows/build/alga-psa-ci-cd-workflow.yaml` — `env:` block on `build-app-ee` (`:959`),
  thread onto build cmd (`:1003`)
- `alga-psa-ce-build-workflow.yaml` (`:605-610`) — same
- new k8s Secret in `namespace: argo`

**This repo:**
- `server/next.config.mjs` — build guard (Phase 2)
- `packages/ui/src/…` — stale store, polling primitive, refresh banner (Phase 3)
- `server/src/components/layout/DefaultLayout.tsx`, `AlgaDeskMspShell.tsx` — mount banner
- `packages/client-portal/src/components/layout/ClientPortalTopBar.tsx` — mount banner
- `server/src/components/layout/Header.tsx` — migrate to primitive (Phase 4)
- `packages/notifications/src/hooks/useInternalNotifications.ts` — migrate to primitive (Phase 4)
- `server/src/components/settings/general/ClientPortalSettings.tsx` — migrate to primitive (Phase 4)

## Open questions

- Phase 1 lands in a different repo than Phase 2/3. If Draft Implementation can only reach this
  repo, **Phase 2 must not merge until Phase 1 is deployed** — otherwise all production builds fail.
- Key rotation is a deliberate act that invalidates every live client (same blast radius as today's
  every-deploy churn). Worth documenting wherever the secret is recorded.
