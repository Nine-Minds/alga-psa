import logger from '@alga-psa/core/logger';
import { getConnection, tenantDb } from '@alga-psa/db';
import type { IJobRunner } from './interfaces';

const JOB = 'recover-comment-publications';
const INTERVAL_MS = 60_000;

/** Runner singleton keys make installations safe across replicas and partial failures. */
export function createCommentRecoveryScheduleDiscovery(getRunner: () => Promise<IJobRunner>) {
  let runner: IJobRunner | undefined;
  let running: Promise<void> | undefined;
  const installed = new Set<string>();
  const discover = async () => {
    try {
      const nextRunner = await getRunner();
      if (runner !== nextRunner) { installed.clear(); runner = nextRunner; }
      const root = await getConnection(null);
      // Jobs need an attributable user. Newly provisioned tenants become eligible
      // as soon as their first active MSP user exists, including after startup.
      const tenants = await tenantDb(root, '__comment_recovery_discovery__')
        .unscoped('users', 'system discovery installs per-tenant comment recovery schedules')
        .distinct('tenant').where({ user_type: 'internal', is_inactive: false });
      for (const { tenant } of tenants) {
        if (installed.has(tenant)) continue;
        try {
          await runner.scheduleRecurringJob(JOB, { tenantId: tenant }, '* * * * *', { singletonKey: `${JOB}:${tenant}` });
          // Do not mark failed/partial installations complete: the next tick retries.
          installed.add(tenant);
        } catch (error) {
          logger.error('Failed to install tenant comment recovery schedule; discovery will retry', { tenantId: tenant, error });
        }
      }
    } catch (error) {
      logger.error('Comment recovery schedule discovery failed; next tick will retry', { error });
    }
  };
  const tick = () => {
    // Slow scheduler calls must not overlap the next discovery pass.
    if (!running) running = discover().finally(() => { running = undefined; });
    return running;
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    tick,
    start() {
      if (!timer) {
        timer = setInterval(() => void tick(), INTERVAL_MS);
        timer.unref?.();
      }
      return tick();
    },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
  };
}

/** Arm the timer before attempting installation so an unavailable scheduler can recover. */
export function startCommentRecoveryScheduleDiscovery(getRunner: () => Promise<IJobRunner>) {
  const scope = globalThis as typeof globalThis & {
    __commentRecoveryDiscovery?: ReturnType<typeof createCommentRecoveryScheduleDiscovery>;
  };
  scope.__commentRecoveryDiscovery ??= createCommentRecoveryScheduleDiscovery(getRunner);
  return scope.__commentRecoveryDiscovery.start();
}
