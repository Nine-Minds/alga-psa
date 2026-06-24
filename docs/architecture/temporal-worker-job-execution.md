# Temporal worker & job execution boundaries

This note explains a constraint that is easy to trip over and the patterns that
work around it: **the Temporal worker runs on plain Node ESM and cannot import
the "vertical" feature packages**, even though the Next.js server can. Anything
that needs vertical-package code must therefore run on the server, with the
worker triggering it over the event bus.

Related: [package-build-system.md](./package-build-system.md),
[job_scheduler.md](./job_scheduler.md),
[../workflow/worker-service.md](../workflow/worker-service.md).

## Two runtimes, one set of packages

| Runtime | How it loads `@alga-psa/*` | Consequence |
| --- | --- | --- |
| **Next.js server** (`server/`, `ee/server/`) | Transpiles package **source** (`src/*.ts`) on demand | Can import any package, including ones whose `dist` is incomplete |
| **Temporal worker** (`ee/temporal-workflows/`) | Built with `tsc` (no bundler) → plain **Node ESM**, resolves packages from their built `dist` + `exports` map | Can only import packages whose `dist` is valid, self-contained Node ESM |

### Why most vertical packages can't load in the worker

The "runtime code transpiled by Next.js from `src`" packages (see
[package-build-system.md](./package-build-system.md)) are **not Node-ESM-consumable**:

- Their `package.json` `exports` point the `import` condition at **source**
  (`"./src/index.ts"`) — e.g. `@alga-psa/notifications`. Node ESM can't import a
  `.ts` directory barrel.
- Or they build with `tsup` `bundle: false` + named entries, emitting only barrel
  files whose relative re-exports are **extensionless and point at files that
  were never emitted** — e.g. `@alga-psa/billing/dist/actions/index.mjs` does
  `export * from "./billingAndTax"` but `dist/actions/billingAndTax.mjs` does not
  exist. `node import('@alga-psa/billing/actions')` fails with
  `Cannot find module .../dist/actions/billingAndTax`.

These packages are designed for the Next.js transpiler, which handles `.ts`,
directory imports, and extensionless specifiers. The worker has none of that, so
**importing them from worker code (statically or via a literal `await import()`)
breaks the build/runtime.**

> Important: `tsc --noEmit` does **not** catch this — it resolves types from
> source. Only building the worker and *actually importing the bundle* does. That
> is what `scripts/temporal-worker-dist-import-smoke.mjs` exists for; treat it as
> the gate, not the typecheck.

## Package layering for jobs

- **`@alga-psa/jobs` is a horizontal package** (it is *not* in
  `eslint-plugin-custom-rules/no-feature-to-feature-imports.js`'s
  `VERTICAL_PACKAGES`). It is allowed to import vertical packages, so it is the
  correct home for cross-domain **job handlers**.
- **Vertical packages must not import each other**, and they must not import
  `@alga-psa/jobs` (that closes a cycle: `jobs → vertical → jobs`). Job
  infrastructure that vertical packages need lives in horizontal packages:
  - Job status/metadata types → **`@alga-psa/types`** (`JobStatus`, …).
  - Enqueuing a job → the **`enqueueImmediateJob` seam** in `@alga-psa/core`
    (see below), never `JobService` from `@alga-psa/jobs`.

## Crossing the boundary: the three patterns

All three are DI/event seams registered at server startup (`initializeApp.ts` /
`registerAllSubscribers()`), so the worker depends only on Node-ESM-clean
packages (`@alga-psa/db`, `@alga-psa/event-bus`, `@alga-psa/core`).

1. **Job runner accessor** — `registerJobRunnerAccessor` / `getJobRunner`
   (`@alga-psa/jobs/runner`). Shared handlers reach the runner without importing
   the server-bound `JobRunnerFactory`. Server registers the real factory; the
   worker registers a Temporal runner.

2. **Job enqueue accessor** — `registerJobEnqueuer` / `enqueueImmediateJob`
   (`@alga-psa/core`). Lets vertical packages (billing, client-portal) schedule
   jobs without importing `@alga-psa/jobs`. The server registers a
   `JobService`-backed implementation.

3. **Event-driven server-side execution** — when a job handler needs
   vertical-package code (so it cannot run in the worker), the worker **emits a
   domain event** and a **server subscriber** does the work:
   - **Maintenance jobs**: the Temporal schedule's activity publishes
     `MAINTENANCE_JOB_REQUESTED { jobName }`; `maintenanceJobSubscriber` runs
     `runMaintenanceJob(jobName)` server-side, which fans out across tenants.
     The worker never imports `@alga-psa/jobs/fanout` (which would pull the whole
     domain graph).
   - **Notifications from worker handlers**: handlers that ran in the worker
     (e.g. `autoCloseTicketsHandler`, `expiringCreditsNotificationHandler`)
     publish a domain event (`TICKET_AUTO_CLOSE_WARNING`, `CREDIT_EXPIRING`)
     instead of calling `getEmailNotificationService()`; a server subscriber
     resolves recipients and sends. This mirrors how workflows already trigger
     notifications via the event bus.

## Adding a new scheduled/maintenance job

1. Put the handler in `@alga-psa/jobs` (or a horizontal package). If it imports
   any vertical package or `@alga-psa/notifications`, it **cannot run in the
   worker** — drive it via pattern 3 (emit an event, run server-side).
2. If it only needs Node-ESM-clean packages (`@alga-psa/db`, `event-bus`,
   `core`, `types`), it may run in the worker directly.
3. Verify with the smoke test, not just `tsc`:
   `node scripts/temporal-worker-dist-import-smoke.mjs`.

## Build gotchas seen here

- **`cron-parser@4` is CJS with no statically-detectable named exports.** A
  `import { parseExpression } from 'cron-parser'` works under the Next.js bundler
  but fails as a built ESM bundle (the worker). Use
  `import cronParser from 'cron-parser'; const { parseExpression } = cronParser;`.
- **`tsup` only emits the files listed in `entry`.** If a package declares an
  `exports` subpath, that subpath's file must be a `tsup` entry or the dist won't
  exist (e.g. `@alga-psa/jobs` must list `src/lib/jobs/jobHandlerRegistry.ts` and
  `src/lib/jobs/runners/*.ts`).
- The smoke script builds **every** workspace package before importing the worker
  (some are empty stubs whose build fails harmlessly and is skipped); the worker
  *import* is the real gate.
