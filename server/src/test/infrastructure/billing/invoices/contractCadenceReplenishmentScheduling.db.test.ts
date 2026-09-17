import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../../test-utils/dbConfig';
import {
  CONTRACT_CADENCE_REPLENISHMENT_CRON,
  CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID,
  registerContractCadenceReplenishmentSchedule,
} from 'server/src/lib/jobs/scheduleContractCadenceReplenishment';

/**
 * The non-Temporal schedule must be genuinely recurring and restart-safe, not a
 * one-shot delayed send. These assertions run against a real pg-boss instance so
 * they cover the durable `pgboss.schedule` row, repeated initialization,
 * successive firings, and a process restart — none of which a mock can show.
 */

const JOB = 'replenishContractCadenceServicePeriods';

let db: Knex;

async function scheduleRow() {
  const tableExists = await db
    .select(1)
    .from('information_schema.tables')
    .where({ table_schema: 'pgboss', table_name: 'schedule' })
    .first();
  if (!tableExists) {
    return undefined;
  }
  return db
    .withSchema('pgboss')
    .from('schedule')
    .where({ name: CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID })
    .first();
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  let value = await fn();
  while (value === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await fn();
  }
  return value;
}

describe('contract-cadence replenishment durable pg-boss schedule', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
  }, 240_000);

  afterAll(async () => {
    try {
      await db
        ?.withSchema('pgboss')
        .from('schedule')
        .where({ name: CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID })
        .delete();
    } catch {
      // pgboss schema may not have been created
    }
    await db?.destroy();
  }, 60_000);

  it('persists, converges, delivers successive firings, and survives a restart', async () => {
    const { PgBossJobRunner } = await import('server/src/lib/jobs/runners/PgBossJobRunner');
    PgBossJobRunner.reset();

    let runner = await PgBossJobRunner.create();
    const delivered: string[] = [];
    const registeringWorker = async (marker: string) => {
      await runner.registerHandler({
        name: JOB,
        handler: async () => {
          delivered.push(marker);
        },
        retry: { maxAttempts: 1 },
      });
    };

    await registeringWorker('run');
    await runner.start();

    // Repeated initialization must converge on one durable schedule.
    await registerContractCadenceReplenishmentSchedule({ isEnterprise: false, getRunner: () => runner });
    await registerContractCadenceReplenishmentSchedule({ isEnterprise: false, getRunner: () => runner });

    const row = await waitFor(scheduleRow);
    expect(row, 'no durable pgboss.schedule row was created').toBeTruthy();
    expect(row.cron).toBe(CONTRACT_CADENCE_REPLENISHMENT_CRON);
    const scheduleRows = await db
      .withSchema('pgboss')
      .from('schedule')
      .where({ name: CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID });
    expect(scheduleRows).toHaveLength(1);
    expect(runner.hasHandler(CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID)).toBe(true);

    // Successive firings reach the registered worker.
    await runner.getBoss().send(CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID, {});
    await waitFor(async () => (delivered.length >= 1 ? true : undefined));
    await runner.getBoss().send(CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID, {});
    await waitFor(async () => (delivered.length >= 2 ? true : undefined));
    expect(delivered.length).toBeGreaterThanOrEqual(2);

    // Restart: the schedule row persists and a fresh runner re-registers the
    // worker, then still receives deliveries.
    await runner.stop();
    PgBossJobRunner.reset();
    runner = await PgBossJobRunner.create();
    await registeringWorker('after-restart');
    await runner.start();
    await registerContractCadenceReplenishmentSchedule({ isEnterprise: false, getRunner: () => runner });

    const rowAfterRestart = await waitFor(scheduleRow);
    expect(rowAfterRestart, 'schedule did not survive a restart').toBeTruthy();
    expect(rowAfterRestart.cron).toBe(CONTRACT_CADENCE_REPLENISHMENT_CRON);

    await runner.getBoss().send(CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID, {});
    await waitFor(async () => (delivered.includes('after-restart') ? true : undefined));
    expect(delivered).toContain('after-restart');

    await runner.stop();
    PgBossJobRunner.reset();
  }, 300_000);
});
