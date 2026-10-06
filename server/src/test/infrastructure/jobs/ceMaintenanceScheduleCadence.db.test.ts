import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { parseExpression } from 'cron-parser';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { registerMaintenanceJob, runMaintenanceJob } from '@alga-psa/jobs/fanout';
import { resolveCeMaintenanceSchedules } from '@alga-psa/types';
import { convergeCeMaintenanceSchedules } from 'server/src/lib/jobs/convergeCeMaintenanceSchedules';

/**
 * CE maintenance jobs must run on durable, recurring pg-boss cron schedules
 * (one `maintenance-fanout:<job>` schedule each), not on a one-shot delayed send.
 * These assertions run against a real pg-boss instance.
 */

const PREFIX = 'maintenance-fanout:';
const BASE = 'maintenance-fanout';
const catalog = resolveCeMaintenanceSchedules({});

let db: Knex;
const tenantId = randomUUID();

const scheduleRows = () => db.withSchema('pgboss').from('schedule').where('name', 'like', `${PREFIX}%`);

function fires(cron: string, tz: string, start: string, end: string): number {
  const it = parseExpression(cron, { tz, currentDate: new Date(new Date(start).getTime() - 1), endDate: new Date(end) });
  let n = 0;
  for (;;) {
    try { if (it.next().getTime() >= new Date(end).getTime()) break; n += 1; } catch { break; }
  }
  return n;
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  let value = await fn();
  while (value === undefined && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    value = await fn();
  }
  return value;
}

describe('CE maintenance fan-out durable pg-boss schedules', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    await db('tenants').insert({ tenant: tenantId, client_name: 'CE cadence test', email: `${tenantId}@example.test`, product_code: 'psa' });
  }, 240_000);

  afterAll(async () => {
    try {
      await db?.withSchema('pgboss').from('schedule').where('name', 'like', `${PREFIX}%`).delete();
      await db?.withSchema('pgboss').from('job').where('name', 'like', `${PREFIX}%`).delete();
    } catch {
      // pgboss schema may not have been created
    }
    try { await db?.('tenants').where({ tenant: tenantId }).delete(); } catch { /* best effort */ }
    await db?.destroy();
  }, 60_000);

  it('converges idempotently, delivers to the fan-out, prunes stale schedules, and survives restart', async () => {
    const { PgBossJobRunner } = await import('server/src/lib/jobs/runners/PgBossJobRunner');
    PgBossJobRunner.reset();

    const seen: Record<string, string[][]> = { 'sla-timer': [], 'auto-close-tickets': [] };
    const delivered: string[] = [];
    registerMaintenanceJob('sla-timer', { scope: 'tenant', run: async (t) => { (seen['sla-timer'][seen['sla-timer'].length - 1] ??= []).push(t); } });
    registerMaintenanceJob('auto-close-tickets', { scope: 'tenant', run: async (t) => { (seen['auto-close-tickets'][seen['auto-close-tickets'].length - 1] ??= []).push(t); } });

    const registerBase = async (r: Awaited<ReturnType<typeof PgBossJobRunner.create>>) =>
      r.registerHandler({
        name: BASE,
        handler: async (_id: string, data: any) => {
          const name = String(data.jobName);
          delivered.push(name);
          seen[name]?.push([]);
          await runMaintenanceJob(name);
        },
        retry: { maxAttempts: 1 },
      } as any);

    let runner = await PgBossJobRunner.create();
    await registerBase(runner);
    await runner.start();

    // 1. Converging twice yields exactly one schedule per job, at the catalog cron.
    await convergeCeMaintenanceSchedules(runner, {});
    await convergeCeMaintenanceSchedules(runner, {});
    const rows = await scheduleRows();
    expect(rows).toHaveLength(catalog.length);
    expect(new Set(rows.map((r: any) => r.name)).size).toBe(catalog.length);
    const byName = (n: string) => rows.find((r: any) => r.name === `${PREFIX}${n}`);
    expect(byName('auto-close-tickets')).toMatchObject({ cron: '*/15 * * * *', timezone: 'UTC' });
    expect(byName('sla-timer')).toMatchObject({ cron: '*/5 * * * *', timezone: 'UTC' });

    // 2. Queue policy and worker registration.
    const queue = await db.withSchema('pgboss').from('queue').where({ name: `${PREFIX}sla-timer` }).first();
    expect(queue?.policy).toBe('stately');
    expect(runner.hasHandler(`${PREFIX}sla-timer`)).toBe(true);

    // 3. No far-future one-shot jobs for the legacy base names.
    const farFuture = await db.withSchema('pgboss').from('job')
      .whereIn('name', ['auto-close-tickets', 'sla-timer'])
      .whereRaw("start_after > now() + interval '1 hour'");
    expect(farFuture).toHaveLength(0);

    // 4. Cadence derived from the stored rows.
    const stored = byName('auto-close-tickets');
    const storedSla = byName('sla-timer');
    expect(fires(stored.cron, stored.timezone, '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')).toBe(4);
    expect(fires(storedSla.cron, storedSla.timezone, '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')).toBe(12);

    // 5. Successive deliveries to each queue fan out to the tenant every time.
    for (const name of ['sla-timer', 'auto-close-tickets']) {
      for (let i = 1; i <= 2; i += 1) {
        await runner.getBoss().send(`${PREFIX}${name}`, { jobName: name });
        const ok = await waitFor(async () => (
          delivered.filter((d) => d === name).length >= i && seen[name].filter((run) => run.includes(tenantId)).length >= i ? true : undefined
        ));
        expect(ok, `${name} delivery ${i} did not reach the tenant`).toBe(true);
      }
    }

    // 6. Stale maintenance-fanout:* schedules are removed; foreign names are untouched.
    await runner.getBoss().createQueue(`${PREFIX}obsolete`);
    await runner.getBoss().schedule(`${PREFIX}obsolete`, '0 3 * * *', {}, { tz: 'UTC' });
    expect(await db.withSchema('pgboss').from('schedule').where({ name: `${PREFIX}obsolete` })).toHaveLength(1);
    await convergeCeMaintenanceSchedules(runner, {});
    expect(await db.withSchema('pgboss').from('schedule').where({ name: `${PREFIX}obsolete` })).toHaveLength(0);
    expect(await scheduleRows()).toHaveLength(catalog.length);

    // 7. Restart: schedules persist and a fresh runner still receives deliveries.
    await runner.stop();
    PgBossJobRunner.reset();
    runner = await PgBossJobRunner.create();
    await registerBase(runner);
    await runner.start();
    await convergeCeMaintenanceSchedules(runner, {});
    expect(await scheduleRows()).toHaveLength(catalog.length);
    const before = delivered.length;
    await runner.getBoss().send(`${PREFIX}sla-timer`, { jobName: 'sla-timer' });
    const after = await waitFor(async () => (delivered.length > before ? true : undefined));
    expect(after, 'delivery after restart did not arrive').toBe(true);

    await runner.stop();
    PgBossJobRunner.reset();
  }, 300_000);
});
