# Runbook — Cut the job runner over from PG Boss to Temporal

**Why:** In production the EE job-runner abstraction silently resolved to PG Boss
(`isEnterprise` module-init race + silent `fallbackToPgBoss`). Recurring polls
(Huntress, RMM, extension schedules) run as pg-boss cron jobs whose consumers are
**in-process `boss.work()` subscriptions** — a redeploy (2026-06-19 17:53) orphaned
them and polls stopped. Fix: PR alga-psa#2753 (edition-race fix + remove fallback +
`JOB_RUNNER_TYPE` chart env) and PR nm-kube-config#67 (`temporal.jobRunnerType: temporal`).

Switching the runner is **not** enough on its own: the reconciler treats the existing
pg-boss `jobs` rows as "converged" and won't recreate them on Temporal, and the old
`pgboss.schedule` cron rows keep enqueuing forever with no consumer. This runbook does
the cutover cleanly.

Scope of this runbook: **`huntress-incident-poll:*` and `rmm-alert-reconciliation:*`**,
both managed by `reconcileRmmPollingSchedules()` (verified). `extsched:*` is handled by a
separate extension-schedule reconciler — see the **EXTSCHED** caveat at the bottom; do
**not** delete its schedules until that path is verified.

All DB statements use the admin role. From a sebastian pod:
`kubectl -n msp exec -i <sebastian-pod> -c sebastian -- node` with a `pg` client built
from `DB_HOST/DB_PORT/DB_NAME_SERVER` + `DB_USER_ADMIN/DB_PASSWORD_ADMIN`.

---

## 0. Preconditions

- [ ] alga-psa#2753 merged and a new sebastian image built.
- [ ] nm-kube-config#67 merged.
- [ ] sebastian (blue+green) redeployed with the new image **and** chart values.

## 1. Verify sebastian now selects Temporal

```
kubectl -n msp logs <sebastian-pod> -c sebastian --since=15m | grep -i "Initializing job runner"
# expect:  Initializing job runner { type: 'temporal', isEnterprise: true }
#          (and NO "Falling back to PG Boss")
```

Confirm the env landed:

```
kubectl -n msp exec <sebastian-pod> -c sebastian -- sh -lc 'echo "$JOB_RUNNER_TYPE"'   # -> temporal
```

## 2. Verify the Temporal worker polls `alga-jobs`

The `temporal-worker` already force-appends `alga-jobs` (workerConfig). Confirm pollers
exist (Temporal UI task-queue view, or a temporal CLI pod):
`temporal task-queue describe --task-queue alga-jobs` → expect ≥1 workflow poller.

## 3. Stop the pg-boss bleed (delete cron schedules)

```sql
DELETE FROM pgboss.schedule
WHERE name LIKE 'huntress-incident-poll:%'
   OR name LIKE 'rmm-alert-reconciliation:%';
```

## 4. Drain remaining pg-boss backlog for these queues

```sql
DELETE FROM pgboss.job
WHERE state IN ('created','retry','active')
  AND ( name LIKE 'huntress-incident-poll:%'
     OR name LIKE 'rmm-alert-reconciliation:%' );
```

## 5. Clear the Alga recurring job rows so the reconciler recreates on Temporal

`findExistingRecurringJob()` only skips when a matching recurring row with a non-null
`external_id` exists. Deleting the recurring **marker** rows (not execution history)
forces re-creation through the now-Temporal runner.

```sql
DELETE FROM jobs
WHERE metadata->>'recurring' = 'true'
  AND ( metadata->>'singletonKey' LIKE 'huntress-incident-poll:%'
     OR metadata->>'singletonKey' LIKE 'rmm-alert-reconciliation:%' );
```

## 6. Let the reconciler recreate on Temporal

It runs every 5 min from `initializeApp` (or trigger immediately by toggling an
integration, or for Huntress call the `runHuntressPollNow()` action). Then verify the new
rows are Temporal-backed:

```sql
SELECT metadata->>'singletonKey' AS sk, runner_type, status, external_id IS NOT NULL AS has_sched
FROM jobs
WHERE metadata->>'recurring' = 'true'
  AND ( metadata->>'singletonKey' LIKE 'huntress-incident-poll:%'
     OR metadata->>'singletonKey' LIKE 'rmm-alert-reconciliation:%' )
ORDER BY created_at DESC;
-- expect runner_type = 'temporal', has_sched = true
```

And confirm `pgboss.schedule` has **no** rows for these names (step 3 held).

## 7. Verify end-to-end (Huntress)

- A new Temporal Schedule fires `genericJobWorkflow` on `alga-jobs`.
- `rmm_integrations.last_incremental_sync_at` for tenant
  `a42aa793-9aa8-4db1-b771-247badcf2f6a` (Shift Left Security) advances to ~now.
- New `status='sent'` incidents create tickets (`source='huntress'`).

---

## Rollback

The code fix makes EE **default** to Temporal, so to revert you must force pg-boss
explicitly: set `temporal.jobRunnerType: pgboss` (nm-kube-config) and redeploy. NOTE:
pg-boss still has the in-process worker re-subscription gap that started this incident —
rolling back reintroduces that exposure. Prefer fixing forward.

## EXTSCHED caveat (do NOT run blindly)

`extsched:*` queues (extension schedules) are **not** managed by
`reconcileRmmPollingSchedules()`. They had ~9,932 orphaned jobs and will regrow on
pg-boss until migrated. Before deleting their `pgboss.schedule` rows, confirm the
extension-schedule reconciler (`extRegistryV2Actions` / `extensionScheduleActions`)
recreates them on the Temporal runner — otherwise those extension schedules would stop
entirely. Migrate extsched as a separate, verified step.
