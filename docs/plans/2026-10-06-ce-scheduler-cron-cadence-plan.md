# CE recurring jobs: run at their cron cadence

Card: "CE scheduler runs sub-daily cron jobs only once per 24h" (eacba6ad-0ca3-4eed-a7c1-4fde534a8b8d)
Branch: `feature/ce-scheduler-runs-sub-daily-cron-jobs-only-once`
Status: design. Nothing is implemented yet.

## 1. What is actually broken

`JobScheduler.scheduleRecurringJob` (`server/src/lib/jobs/jobScheduler.ts:184-236`, copied in `packages/jobs/src/lib/jobs/jobScheduler.ts`) does not schedule anything recurring. It:

1. replaces any cron containing `*` with the string `'24 hours'` (lines 191-196);
2. calls `boss.send(jobName, data, { startAfter: '24 hours', singletonKey: '<job>:<tenant>', singletonHours: 24 })`. pg-boss casts `'24 hours'` to `now() + interval '24 hours'`;
3. registers a plain `boss.work` handler that runs the job and never re-sends it.

So each call creates one delayed job that runs about 24 hours after boot. Nothing creates the next run. On a server that never restarts, every job on this path runs **once in total**. On a server that restarts every day, a job runs about once a day, 24 hours after each boot. The problem is not limited to sub-daily crons: the daily crons (`0 1 * * *` and so on) are also ignored and run only 24 hours after each boot. `initializeApp.ts:715-720` already notes this ("a one-shot delayed send (it never re-fires after completion)").

### Every CE recurring job that goes through the legacy path

Scheduled per tenant from `initializeScheduledJobs.ts`, through the wrappers in `server/src/lib/jobs/index.ts`:

| Job (queue name) | Intended cron | Wrapper (index.ts) | In the EE fan-out catalog |
|---|---|---|---|
| `expired-credits` | `0 1 * * *` | `scheduleExpiredCreditsJob` | yes, same cron |
| `expiring-credits-notification` | `0 9 * * *` | `scheduleExpiringCreditsNotificationJob` | yes |
| `prepaid-balance-alert-scan` | `0 9 * * *` | `schedulePrepaidBalanceAlertScanJob` | yes |
| `expired-hour-blocks` | `30 1 * * *` | `scheduleExpiredHourBlocksJob` | yes |
| `expiring-hour-blocks-notification` | `15 9 * * *` | `scheduleExpiringHourBlocksNotificationJob` | yes |
| `inventory-low-stock-notification` | `30 7 * * *` | `scheduleLowStockNotificationJob` | yes (server-registered) |
| `reconcile-bucket-usage` | `0 3 * * *` | `scheduleReconcileBucketUsageJob` | yes |
| `reconcile-hour-block-allocations` | `15 3 * * *` | `scheduleReconcileHourBlockAllocationsJob` | yes |
| **`auto-close-tickets`** | **`*/15 * * * *`** | `scheduleAutoCloseTicketsJob` | yes |
| `search:reconcile` | `0 6 * * *` | `scheduleSearchReconcileJob` | yes |
| `renew-microsoft-calendar-webhooks` | `*/30 * * * *` | `scheduleMicrosoftWebhookRenewalJob` | no (see §2.4) |
| `verify-google-calendar-pubsub` | `15 * * * *` | `scheduleGooglePubSubVerificationJob` | yes (see §2.4) |
| `renew-google-gmail-watch` | `*/30 * * * *` | `scheduleGoogleGmailWatchRenewalJob` | yes |
| `email-webhook-maintenance` | `0 4 * * *` | `scheduleEmailWebhookMaintenanceJob` | no (EE uses `emailWebhookMaintenanceWorkflow`) |
| `inbound-email-recovery` | `*/1 * * * *` (env `UNIFIED_INBOUND_EMAIL_RECOVERY_CRON`) | `scheduleInboundEmailRecoveryJob` | yes |
| `provider-disconnect-retry` | `*/5 * * * *` (env `PROVIDER_DISCONNECT_RETRY_CRON`) | `scheduleProviderDisconnectRetryJob` | yes |
| `process-renewal-queue` | `0 5 * * *` | `scheduleRenewalQueueProcessingJob` | yes |
| **`sla-timer`** | **`*/5 * * * *`** | `scheduleSlaTimerJob` | no (EE runs SLA on Temporal workflows) |

These are scheduled system-wide (`tenantId: 'system'`) from `packages/jobs` through `getJobScheduler()`:

| Job | Intended cron | Caller | EE catalog |
|---|---|---|---|
| `cleanup-temporary-workflow-forms` | `0 2 * * *` | `packages/jobs/src/lib/handlers/cleanupTemporaryFormsJob.ts` `scheduleCleanupTemporaryFormsJob` | yes |
| `cleanup-webhook-deliveries` | `*/15 * * * *` | `packages/jobs/src/lib/handlers/cleanupWebhookDeliveriesJob.ts` `scheduleCleanupWebhookDeliveriesJob` | yes |

These are scheduled from `server/src/lib/initializeApp.ts` `initializeJobScheduler()`:

| Job | Today | EE catalog |
|---|---|---|
| `createClientContractLineCycles` (system) | `'24 hours'` one-shot send (lines 527-542). The `getJobs` guard calls `boss.fetch('active')`, which fetches from a queue named `active`, so the guard is always empty and every boot sends again. The job runs once, 24 hours after each boot. | `create-client-contract-line-cycles` `0 0 * * *` |
| `createNextTimePeriods` (per tenant) | Chains itself: each run re-sends `'24 hours'` in `finally` (lines 552-702). It works, but it drifts and stays on the legacy API. | `create-next-time-periods` `30 0 * * *` |

The CE jobs already on the job runner (`date-trigger-scan`, the three `opportunity-*` jobs, `project-date-readiness`, `generate-recurring-tickets`, the three marketing jobs, comment recovery and contract-cadence replenishment) use real pg-boss cron and run at their intended cadence. EE is unaffected: `initializeScheduledJobs` returns before scheduling anything (lines 27-30), and every wrapper returns `null` on enterprise editions.

## 2. Decision

### 2.1 Chosen approach: global CE schedules that reuse the EE maintenance fan-out

CE gets **one durable pg-boss cron schedule per job**, named `maintenance-fanout:<jobName>`, created with the existing `PgBossJobRunner.scheduleGlobalRecurringJob` (`runners/PgBossJobRunner.ts:455-486`, already used by contract-cadence replenishment). Each firing runs `runMaintenanceJob(jobName)` from `@alga-psa/jobs/fanout` (`packages/jobs/src/lib/maintenanceJobFanout.ts`) under the same cluster-wide Redis lock that EE's `maintenanceJobSubscriber` uses. That is the registry, tenant enumeration, suspended-tenant filtering, tenant selectors, per-tenant error isolation and concurrency cap that EE already runs in production for these jobs.

This is the same design as EE with a different trigger. EE: Temporal schedule `maintenance-fanout:<job>`, then the event bus, then `runMaintenanceJob`. CE: pg-boss schedule `maintenance-fanout:<job>`, then a pg-boss worker, then `runMaintenanceJob`. CE takes the cadence of each shared job by name from `MAINTENANCE_FANOUT_SCHEDULES`, so the two editions cannot drift apart.

### 2.2 Rejected: making the legacy scheduler honour cron

The legacy scheduler would need a second cron engine: either a re-send-on-completion chain with next-fire computation, or a port of pg-boss's `schedule()` and timekeeper into `JobScheduler`. pg-boss already does this correctly in the runner. Two cron implementations over one pg-boss database would duplicate the scheduling layer, and the per-tenant boot convergence would stay. Fixing this engine is not the answer, because another engine already does the job. The broken API is deleted instead (step 9).

### 2.3 Rejected: per-tenant `runner.scheduleRecurringJob` (the path used by `date-trigger-scan`)

This path fires at the right cadence, but it adds several costs for every additional job:

- **Queues and pollers grow with jobs × tenants.** A cron schedule gets its own queue, `<job>:<tenant>` (`PgBossJobRunner.ts:346`), and its own `boss.work` poller (lines 366-373). With about 20 more jobs and N tenants, that is about 20·N more pollers per replica, each querying every 2 seconds.
- **Tracker rows leak on every boot.** `createJobRecord` (lines 676-715) inserts a new `jobs` row on every call. `boss.schedule` is an upsert in pg-boss 10.4 (`ON CONFLICT (name) DO UPDATE`), so the previous row is left in `queued` permanently. The `'already exists'` catch at lines 399-413 is dead code. Every restart would add about 20·N orphan rows.
- **A tenant must have a user.** `createJobRecord` throws "Unable to attribute job to a user" for a tenant with no users. The legacy path does not have this requirement.
- **Tenants created after boot get nothing** until the next restart. Boot time also grows with the tenant count. EE moved away from per-tenant schedules for exactly this reason (`initializeScheduledJobs.ts:15-18`).

The global design has none of these costs. The number of schedules is fixed. It writes no `jobs` rows, as with today's legacy path, so the job-monitoring UI does not change. Each firing enumerates tenants, so new and reactivated tenants are covered without a restart.

### 2.4 Which jobs CE schedules

There are 20 global CE schedules:

- **18 shared with EE.** The cron comes from `MAINTENANCE_FANOUT_SCHEDULES`: `expired-credits`, `expiring-credits-notification`, `prepaid-balance-alert-scan`, `expired-hour-blocks`, `expiring-hour-blocks-notification`, `inventory-low-stock-notification`, `reconcile-bucket-usage`, `reconcile-hour-block-allocations`, `auto-close-tickets`, `search:reconcile`, `renew-google-gmail-watch`, `inbound-email-recovery`, `provider-disconnect-retry`, `process-renewal-queue`, `cleanup-temporary-workflow-forms`, `cleanup-webhook-deliveries`, `create-client-contract-line-cycles`, `create-next-time-periods`.
- **2 CE-only.** The cron is defined in the CE catalog: `sla-timer` `*/5 * * * *` and `email-webhook-maintenance` `0 4 * * *`.
- **Environment overrides kept:** `UNIFIED_INBOUND_EMAIL_RECOVERY_CRON` and `PROVIDER_DISCONNECT_RETRY_CRON`. Each is validated with `cron-parser`. An invalid value logs an error and falls back to the catalog cron.
- **No longer scheduled in CE:** `renew-microsoft-calendar-webhooks` and `verify-google-calendar-pubsub`. Both handlers return early outside Enterprise Edition (`packages/jobs/src/lib/handlers/calendarWebhookMaintenanceHandler.ts`, `loadEeCalendarWebhookMaintenanceModule` returns `null` in CE). In CE they only write a "Skipping … outside Enterprise Edition" log line per tenant on every run.
- **Not changed by this card:** the jobs already on the per-tenant runner path (§1, last paragraph). They run at cadence. Moving them to the global schedules is a follow-up (§8).

## 3. Schedule contract

- **Identity:** the pg-boss schedule name and the queue name are both `maintenance-fanout:<jobName>`, the same id as the EE Temporal schedules. Schedule data is `{ jobName }`.
- **Cron and timezone:** every catalog cron is evaluated in **UTC**. `scheduleGlobalRecurringJob` passes `timezone: 'UTC'` explicitly, and `pgboss.schedule.timezone = 'UTC'`. This matches the EE catalog, which states "Crons are UTC". Tenant-local times, such as 09:00 in the tenant's own timezone for notifications, are out of scope.
- **Missed ticks:** pg-boss fires a schedule only when the previous cron instant is less than 60 seconds old (`timekeeper.shouldSendIt`). Ticks missed during downtime are skipped, not caught up. This matches EE's `catchupWindow: '1m'`.
- **Overlap:**
  - Within a replica, each fan-out queue has a single worker that processes jobs one at a time.
  - Each fan-out queue is created with pg-boss policy **`stately`**: at most one job queued and one active. A slow run therefore cannot pile up a backlog of ticks.
  - Across replicas, `acquireMaintenanceJobLock(jobName)` applies. A run that finds the lock held is skipped, as in EE.
- **Expiry:** schedule options set `expireInSeconds: 3600`. The pg-boss default is 900 seconds, and a fan-out across many tenants for `search:reconcile` or `reconcile-bucket-usage` can take longer. An expired job would be retried and run twice.
- **Retries:** failures are isolated per tenant and retried on the next tick. This is the same as EE today. The legacy path retried each tenant up to 3 times. For a daily job, a tenant that fails now waits until the next day. This is accepted for parity with EE, and the cause is logged by `runMaintenanceJob`. A failure of the whole job (tenant enumeration, registry miss) still throws, and pg-boss retries it (`retryLimit: 3`).
- **Idempotent convergence:** convergence runs on every boot and on every replica.
  - It upserts each desired schedule. `boss.schedule` is an upsert, so this also applies cron changes and environment overrides on restart.
  - It removes any `maintenance-fanout:*` schedule that is no longer desired.
  - It registers each schedule's worker.

## 4. CE-only gating

There are three gates. All three must pass:

1. `initializeScheduledJobs` already returns before convergence when `isEnterpriseWorkflowEdition()` is true (`EDITION` is `enterprise` or `ee`, or `NEXT_PUBLIC_EDITION=enterprise`).
2. `convergeCeMaintenanceSchedules(runner)` returns `'temporal-authority'` unless `runner.getRunnerType() === 'pgboss'` and the runner implements `scheduleGlobalRecurringJob`. This is the same check as `registerContractCadenceReplenishmentSchedule` (`scheduleContractCadenceReplenishment.ts:31-60`). `JobRunnerFactory` never gives EE a pg-boss runner.
3. The base handler (`maintenance-fanout`) and the CE-only fan-out definitions (`sla-timer`, `email-webhook-maintenance`) are registered only when `!includeEnterprise`, using the same condition that already gates the `sla-timer` registry entry (`registerAllHandlers.ts:817-832`). EE's Temporal catalog and the parity test are not touched.

The per-wrapper edition checks in `index.ts` are deleted together with the wrappers. This also removes an inconsistency: `scheduleSlaTimerJob` checked only `EDITION === 'enterprise'`.

## 5. Changes, in order

Each step leaves the tree green. Steps 1-4 add code, steps 5-6 switch the scheduling over, and steps 7-9 delete the legacy path.

1. **Add the CE catalog.** New file `packages/types/src/constants/ceMaintenanceSchedules.ts`, with no dependencies, exported next to `MAINTENANCE_FANOUT_SCHEDULES`:
   - `CE_SHARED_MAINTENANCE_JOBS`: a readonly list of the 18 job names. Their cron comes from `MAINTENANCE_FANOUT_SCHEDULES`.
   - `CE_ONLY_MAINTENANCE_SCHEDULES`: `[{ jobName: 'sla-timer', cron: '*/5 * * * *' }, { jobName: 'email-webhook-maintenance', cron: '0 4 * * *' }]`.
   - `resolveCeMaintenanceSchedules(env)` returns `{ jobName, cron }[]`. It joins the shared names to the EE crons and throws if a name is missing from the EE catalog. It then appends the CE-only entries and applies the two environment overrides.
2. **Register the CE-only fan-out definitions.** New file `server/src/lib/jobs/registerCeMaintenanceJobs.ts`. `registerCeMaintenanceJobs()` is idempotent and calls `registerMaintenanceJob`:
   - `sla-timer`: `{ scope: 'tenant', run: (t) => slaTimerHandler({ tenantId: t }) }`.
   - `email-webhook-maintenance`: `{ scope: 'tenant', run: (t) => emailWebhookMaintenanceHandler({ id: \`fanout:${t}\`, data: { tenantId: t } } as Job<…>) }`, the same adapter that `reconcile-bucket-usage` uses.

   Add both names to a `CE_MAINTENANCE_JOBS` constant in `serverMaintenanceJobNames.ts`, kept separate from `SERVER_MAINTENANCE_JOBS` so that the EE parity test ("schedules every fan-out definition on Temporal") does not list them.
3. **Share the run-with-lock path.** Move the body of `maintenanceJobSubscriber.handleMaintenanceJobRequested`'s known-job branch (lock, then `runMaintenanceJob`, then release, with its logging) into `server/src/lib/jobs/runMaintenanceJobExclusive.ts`. Move the registry preparation (`configureEditionDateTriggerWorkflowLauncher`, `registerServerMaintenanceJobs`, and `registerCeMaintenanceJobs` when in CE) into the same module as `prepareMaintenanceRegistry()`. The subscriber then calls both functions. The behaviour is unchanged, and the next step reuses them.
4. **Add the base handler and extend the runner.**
   - In `registerAllHandlers.ts`, when `!includeEnterprise`, register `MAINTENANCE_FANOUT_JOB = 'maintenance-fanout'`. Its handler is `async (_id, data) => { await prepareMaintenanceRegistry(); await runMaintenanceJobExclusive(String(data.jobName)); }`, with `retry: { maxAttempts: 3 }` and `timeoutMs: 3_600_000`.
   - In `PgBossJobRunner` (and the optional members of `IJobRunner`, in both the server and `packages/jobs` copies):
     - Extend `scheduleGlobalRecurringJob` options with `queuePolicy?: 'standard' | 'stately'`, passed to `boss.createQueue(scheduleId, { policy })`, and `expireInSeconds?`, passed into the `boss.schedule` options.
     - Add `listGlobalRecurringJobs(prefix)`, which wraps `boss.getSchedules()` and filters by name prefix.
     - Add `unscheduleGlobalRecurringJob(scheduleId)`, which calls `boss.unschedule` and then a best-effort `deleteQueue`.
   - Note: `createQueue` does not change the policy of an existing queue. The `maintenance-fanout:*` queues are all new, so this is not a problem.
5. **Add convergence.** New file `server/src/lib/jobs/convergeCeMaintenanceSchedules.ts` with `convergeCeMaintenanceSchedules(runner, env = process.env)`:
   1. Apply the gates from §4. If they fail, return `'temporal-authority'`.
   2. For each resolved entry, call `runner.scheduleGlobalRecurringJob(MAINTENANCE_FANOUT_JOB, cron, { scheduleId: 'maintenance-fanout:' + jobName, timezone: 'UTC', data: { jobName }, queuePolicy: 'stately', expireInSeconds: 3600 })`. Errors are isolated and logged per entry.
   3. Call `listGlobalRecurringJobs('maintenance-fanout:')` and unschedule the names that are not desired.
   4. Return a summary of what was scheduled, removed and failed.
6. **Switch the callers.**
   - `initializeScheduledJobs.ts`: delete the legacy per-tenant blocks for every job in §1 (lines 40-141, 187-237, 239-391, 395-420). After the EE early return, add `await convergeCeMaintenanceSchedules(await initializeJobRunner())` before the tenant loop. The remaining loop body covers only the runner-path jobs, which are unchanged. Drop the now-unused imports.
   - `initializeApp.ts` `initializeJobScheduler()`: delete the `createClientContractLineCycles` send and handler (lines 527-542) and the `createNextTimePeriods` handler and per-tenant sends (lines 552-702). These are now covered by the `create-client-contract-line-cycles` and `create-next-time-periods` schedules.
7. **Delete the dead wrappers.** In `server/src/lib/jobs/index.ts`, delete:
   - `scheduleExpiredCreditsJob`, `scheduleExpiringCreditsNotificationJob`, `schedulePrepaidBalanceAlertScanJob`, `scheduleExpiredHourBlocksJob`, `scheduleExpiringHourBlocksNotificationJob`, `scheduleLowStockNotificationJob`;
   - `scheduleReconcileBucketUsageJob`, `scheduleReconcileHourBlockAllocationsJob`, `scheduleAutoCloseTicketsJob`, `scheduleSearchReconcileJob`, `scheduleRenewalQueueProcessingJob`, `scheduleSlaTimerJob`;
   - `scheduleMicrosoftWebhookRenewalJob`, `scheduleGooglePubSubVerificationJob`, `scheduleGoogleGmailWatchRenewalJob`, `scheduleEmailWebhookMaintenanceJob`, `scheduleInboundEmailRecoveryJob`, `scheduleProviderDisconnectRetryJob`;
   - `scheduleCleanupAiSessionKeysJob` and `scheduleWorkflowQuotaResumeScanJob`, which are unreachable in CE and EE alike: no callers, and both return `null` on every edition that has the handler;
   - the re-exports of the two `packages/jobs` cleanup schedulers, and those schedulers themselves in `cleanupTemporaryFormsJob.ts` and `cleanupWebhookDeliveriesJob.ts`. The `*Job()` run functions stay, because the fan-out uses them.

   At plan time, the only caller of every wrapper is `initializeScheduledJobs.ts`. Re-check with `grep -rnw <name> server/src packages ee` before deleting. `scheduleQuoteAutoExpirationJob` is imported but never called. Leave it, and record it in §8.
8. **Remove the legacy recurring-only handler registrations.** In `index.ts` `initializeScheduler()`, remove the legacy `jobScheduler.registerJobHandler` calls for the migrated jobs, after the same grep confirms that no immediate sender targets the base queue name. Some delayed sends from before the deploy may still be queued: at most one per job and tenant, due within 24 hours. Two things can happen to them:
   - If the job runner registry has a worker on the same base queue name (`expired-credits`, `auto-close-tickets`, `sla-timer`, `process-renewal-queue` and most others; see `registerAllHandlers.ts`), that worker runs them once. The runs are idempotent sweeps.
   - The rest (`inventory-low-stock-notification`, `email-webhook-maintenance`, `provider-disconnect-retry`, `cleanup-webhook-deliveries`, `createNextTimePeriods`, `createClientContractLineCycles`) stay in `created` until pg-boss retention deletes them.

   Either way is harmless, and no purge SQL is needed. Do not `deleteQueue` the base names, because the runner's base workers are registered on them.
9. **Delete the broken API.** Remove `scheduleRecurringJob` from `IJobScheduler`, `JobScheduler` and `DummyJobScheduler`, in both `server/src/lib/jobs/jobScheduler.ts` and `packages/jobs/src/lib/jobs/jobScheduler.ts`. Also remove the `'recurring'` branch and `ScheduleType` member from both `JobService.scheduleJob` copies (`server/src/services/job.service.ts`, `packages/jobs/src/lib/jobService.ts`); no caller passes `'recurring'`. If this delete surfaces a caller the grep missed, migrate that caller as well. Do not keep a cron-coercing shim.

### Tests that assert on the old source and must change

- `server/src/lib/jobs/prepaidBalanceAlertScheduling.test.ts`
- `server/src/lib/jobs/prepaidAutoReplenishmentScheduling.test.ts`
- `server/src/lib/jobs/tests/renewalQueueScheduling.wiring.test.ts`
- `server/src/test/unit/searchReconcile.test.ts`
- `server/src/test/unit/jobs/teamsMeetingJobWiring.wiring.test.ts` (the `scheduleGoogleGmailWatchRenewalJob` reference)
- `server/src/test/unit/jobs/tenantSuspensionGates.contract.test.ts`

Change each of them to assert on the CE catalog or convergence instead of the deleted wrappers. Keep the intent of each test, for example "prepaid scan at `0 9 * * *` in CE and EE".

## 6. Regression tests

### 6.1 Unit test, runs in `npm test`: `server/src/test/unit/jobs/ceMaintenanceSchedules.unit.test.ts`

- **Catalog:** `resolveCeMaintenanceSchedules({})` contains `{ jobName: 'auto-close-tickets', cron: '*/15 * * * *' }` and `{ jobName: 'sla-timer', cron: '*/5 * * * *' }`.
- **Cadence:** use `cron-parser` (the library and version pg-boss's timekeeper uses) with `tz: 'UTC'` over `[2026-01-01T00:00Z, 01:00Z)`. `auto-close-tickets` must produce exactly 4 fire times, 15 minutes apart. `sla-timer` must produce exactly 12, 5 minutes apart. Every entry must fire at least once a day.
- **Parity:**
  - Every shared CE job has the same cron as `MAINTENANCE_FANOUT_SCHEDULES`.
  - After `registerServerMaintenanceJobs()` and `registerCeMaintenanceJobs()`, every resolved CE entry passes `isKnownMaintenanceJob`.
  - Each name appears exactly once.
- **Environment overrides:** an override is applied. An invalid override falls back to the default.
- **Gating:** with a fake runner of type `'temporal'`, convergence returns `'temporal-authority'` and calls nothing.
- **Legacy API gone:** a type-level and source check that `JobScheduler` has no `scheduleRecurringJob`. This guards against the bug coming back.
- **Fan-out handler:** with the lock client faked, the `maintenance-fanout` handler with `{ jobName: 'sla-timer' }` calls the registered definition once per non-suspended tenant.

Update `server/src/test/unit/maintenanceJobFanout.unit.test.ts` so that "schedules every fan-out definition on Temporal" excludes `CE_MAINTENANCE_JOBS`.

### 6.2 DB-backed test against real pg-boss: `server/src/test/infrastructure/jobs/ceMaintenanceScheduleCadence.db.test.ts`

The pattern is `server/src/test/infrastructure/billing/invoices/contractCadenceReplenishmentScheduling.db.test.ts`, which uses `wireLocalTestDbEnv()`, `createTestDbConnection()` and `PgBossJobRunner.create()`.

1. Run `convergeCeMaintenanceSchedules(runner)` **twice**. In `pgboss.schedule`, there must be exactly one row each for `maintenance-fanout:auto-close-tickets` (`cron = '*/15 * * * *'`, `timezone = 'UTC'`) and `maintenance-fanout:sla-timer` (`cron = '*/5 * * * *'`). The row count must equal the resolved catalog size.
2. `pgboss.queue.policy = 'stately'` for both queues. `runner.hasHandler('maintenance-fanout:sla-timer')` is true.
3. **The old bug's signature is absent:** there is no `pgboss.job` row named `auto-close-tickets` or `sla-timer` with `start_after > now() + interval '1 hour'`.
4. **Cadence from the stored rows:** read `cron` and `timezone` back from `pgboss.schedule` and run the §6.1 cadence assertion on them. This proves what pg-boss will execute, rather than what the catalog says.
5. **Delivery reaches the work:** seed a tenant and replace the `sla-timer` and `auto-close-tickets` definitions with recorders using `registerMaintenanceJob`. Then `boss.send('maintenance-fanout:sla-timer', { jobName: 'sla-timer' })` twice and wait. The recorder must see the seeded tenant on both runs. Repeat for auto-close.
6. **Stale removal:** insert a schedule named `maintenance-fanout:obsolete`, converge, and check that it is gone.
7. **Restart:** `runner.stop()`, `PgBossJobRunner.reset()`, create a new runner and converge again. The schedules persist unchanged, and a send is still delivered.

Run with:

```bash
cd server && npx vitest run src/test/infrastructure/jobs/ceMaintenanceScheduleCadence.db.test.ts --coverage.enabled=false
```

This uses the local test DB that `server/test-utils/dbConfig.ts` wires. Clean up the `maintenance-fanout:*` schedules and queues in `afterAll`.

### 6.3 Live check in a CE stack (QA step, about 35 minutes)

The card's dev server is wired as **Enterprise**: `server/.env.local` sets `APP_EDITION=enterprise` and `NEXT_PUBLIC_EDITION=enterprise`. For this check, start it as CE against `alga-psa-local-test`:

```bash
cd server && EDITION=community APP_EDITION=community NEXT_PUBLIC_EDITION=community PORT=3135 npm run dev
```

1. Check the boot log for `[ce-maintenance] converged` with 20 scheduled and 0 failed. Then run:

   ```sql
   SELECT name, cron, timezone FROM pgboss.schedule WHERE name LIKE 'maintenance-fanout:%' ORDER BY name;
   ```

   It should return 20 rows, including `auto-close-tickets` `*/15 * * * *` UTC and `sla-timer` `*/5 * * * *` UTC.
2. Seed the functional work:
   - **Auto-close:** set an auto-close rule on a board. Make one ticket on that board stale past the threshold by back-dating its last activity with SQL.
   - **SLA:** give a ticket an SLA policy whose response target passes a few minutes from now.
3. Wait at least 31 minutes, then run:

   ```sql
   SELECT name, state, started_on, completed_on
   FROM (SELECT name, state, started_on, completed_on FROM pgboss.job
         UNION ALL SELECT name, state, started_on, completed_on FROM pgboss.archive) j
   WHERE name IN ('maintenance-fanout:auto-close-tickets','maintenance-fanout:sla-timer')
     AND started_on > now() - interval '40 minutes'
   ORDER BY name, started_on;
   ```

   Pass criteria:
   - `auto-close-tickets` has at least 2 completed runs that started on minute 00, 15, 30 or 45 (UTC), at most about 1 minute late.
   - `sla-timer` has at least 6 completed runs, about 5 minutes apart.
   - No run is `failed`.
4. Functional check: the stale ticket is closed within 15 minutes of seeding. The SLA ticket shows its warning or breach state and notification within 5 minutes of the threshold. The server log has `[maintenance] tenant fan-out complete` with `jobName: 'sla-timer'` every 5 minutes.
5. Restart the dev server and repeat step 1. There must still be 20 schedules and no duplicates, and the `jobs` table row count must not change.

## 7. Risks

- **Fewer per-tenant retries:** see §3 "Retries". This matches EE, and failures are logged per tenant.
- **Fan-out concurrency is 10 tenants at a time** (`DEFAULT_CONCURRENCY`) inside a single job. Large CE installs use more of the DB pool in bursts than the old staggered per-tenant jobs did. This is the EE profile. Watch the pool during QA.
- **Lock TTL (15 minutes) is shorter than the new 1-hour expiry.** A run longer than 15 minutes on one replica can overlap with another replica's run of the same job. Within a replica, `stately` and the single worker prevent overlap. EE has the same TTL. The follow-up is lock renewal, not this card.
- **One extra run of each job after deploy,** from pre-deploy delayed sends drained by the base-queue workers (step 8). All of these jobs are idempotent sweeps.
- **The runner becomes a hard dependency for all CE maintenance.** If `initializeJobRunner()` fails, nothing recurring runs in CE. This was already true for the runner-path jobs. Convergence logs at `error` level. Durable schedules from the previous boot keep firing into `stately` queues, holding at most one queued job until a worker returns.
- **Polling cost is fixed:** 20 queues, each with one worker per replica. It does not grow with the tenant count, unlike the rejected per-tenant path.
- **Behaviour change:** CE stops scheduling the two calendar jobs. They were no-ops in CE. This needs a release-note line.
- **The branch is 89 commits behind `origin/main`.** None of the files this plan touches changed upstream (checked with `git diff --stat HEAD origin/main` on the paths above). Rebase before implementing.

## 8. Out of scope (follow-up cards)

- **Moving the per-tenant runner-path CE jobs to the global schedules:** `date-trigger-scan`, the three `opportunity-*` jobs, `project-date-readiness`, `generate-recurring-tickets`, the marketing jobs and comment-recovery discovery. They run at cadence today. Moving them needs an unschedule pass for the `<job>:<tenant>` schedules, the CE counterpart of `LEGACY_PER_TENANT_SCHEDULE_PREFIXES`, and cleanup of `jobs` rows. Leave a `// LEVERAGE: pattern ce-per-tenant-runner-schedules` marker at the remaining per-tenant scheduling block in `initializeScheduledJobs.ts`.
- **`PgBossJobRunner.scheduleRecurringJob` leaks a `jobs` row on every call, and its `'already exists'` catch is dead.** Converge on the existing tracker row instead of inserting a new one. Mark this with `// LEVERAGE: friction runner-recurring-tracker-row` at `createJobRecord`.
- **`JobScheduler.getJobs` uses `boss.fetch(state)` as if `fetch` took a state.** It fetches from a queue named after the state. Its only scheduling consumer is removed in step 6.
- **`expire-quotes` (`scheduleQuoteAutoExpirationJob`)** is scheduled in neither edition.
- **`renew-microsoft-calendar-webhooks` does not appear in the EE maintenance catalog.** Check how EE renews Microsoft calendar subscriptions.
- **Tenant-local scheduling times,** and lock TTL renewal for long fan-outs.
- **Deleting the other legacy handlers in `initializeScheduler()`** that serve only immediate sends, as part of a wider retirement of the legacy scheduler.
