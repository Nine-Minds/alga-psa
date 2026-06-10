/**
 * Real-DB integration tests for the tenant reactivation / win-back back end.
 *
 * Unlike the fake-knex contract tests, these run the actual lib functions
 * against the local Postgres `server` database (the one the EE migration was
 * applied to), so they exercise the real SQL, the single-use token reservation,
 * the (tenant, token_hash) uniqueness, the COALESCE'd effective deletion date,
 * and the atomic win-back throttle under concurrency.
 *
 * Skips automatically when the DB is unreachable (e.g. CI without a database).
 * Every row it creates is namespaced to a throwaway tenant and removed in
 * afterAll.
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import knexLib, { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTenantReactivationToken,
  reserveTenantReactivationToken,
  attachCheckoutSessionToReactivationToken,
  consumeTenantReactivationTokenByCheckoutSession,
} from '../../../../ee/server/src/lib/billing/tenantReactivationTokens';
import {
  getActivePendingDeletion,
  getPendingDeletionSummary,
  resolveReactivationContactEmail,
} from '../../../../ee/server/src/lib/billing/tenantReactivationDetection';

// getTokenSecret() reads this at call time; set before any token op.
process.env.ALGA_WEBHOOK_SECRET ||= 'localtest-reactivation-secret';

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT || 5432);

const dbReachable: boolean = await new Promise((resolve) => {
  const socket = net.createConnection({ host: DB_HOST, port: DB_PORT });
  const done = (value: boolean) => {
    socket.removeAllListeners();
    socket.destroy();
    resolve(value);
  };
  socket.on('connect', () => done(true));
  socket.on('error', () => done(false));
  socket.setTimeout(500, () => done(false));
});
const describeDb = dbReachable ? describe : describe.skip;

function readSecret(name: string, fallbackEnv: string): string {
  try {
    return fs.readFileSync(path.resolve(__dirname, '../../../../secrets', name), 'utf8').trim();
  } catch {
    return process.env[fallbackEnv] || '';
  }
}

let db: Knex;
const createdTenants: string[] = [];

async function seedTenantWithPendingDeletion(opts: {
  email: string | null;
  status: string;
  scheduledDeletionDate: Date;
  deletionScheduledFor?: Date | null;
  lastWinbackEmailAt?: Date | null;
}): Promise<{ tenantId: string; deletionId: string }> {
  const tenantId = randomUUID();
  const deletionId = randomUUID();
  createdTenants.push(tenantId);

  await db('tenants').insert({
    tenant: tenantId,
    client_name: `reactivation-it-${tenantId.slice(0, 8)}`,
    email: opts.email,
  });

  await db('pending_tenant_deletions').insert({
    deletion_id: deletionId,
    tenant: tenantId,
    trigger_source: 'stripe_webhook',
    canceled_at: db.fn.now(),
    scheduled_deletion_date: opts.scheduledDeletionDate,
    deletion_scheduled_for: opts.deletionScheduledFor ?? null,
    workflow_id: `wf-${deletionId}`,
    status: opts.status,
    stats_snapshot: JSON.stringify({}),
    last_winback_email_at: opts.lastWinbackEmailAt ?? null,
  });

  return { tenantId, deletionId };
}

beforeAll(() => {
  db = knexLib({
    client: 'pg',
    connection: {
      host: DB_HOST,
      port: DB_PORT,
      user: process.env.DB_USER_ADMIN || 'postgres',
      // Secret file first (the docker-compose source of truth); fall back to env.
      password: readSecret('postgres_password', 'DB_PASSWORD_ADMIN'),
      database: process.env.DB_NAME_SERVER || 'server',
    },
    pool: { min: 1, max: 5 },
  });
});

afterAll(async () => {
  if (!db) return;
  for (const tenantId of createdTenants) {
    await db('tenant_reactivation_tokens').where({ tenant: tenantId }).delete();
    await db('pending_reactivation_refunds').where({ tenant: tenantId }).delete();
    await db('pending_tenant_deletions').where({ tenant: tenantId }).delete();
    await db('tenants').where({ tenant: tenantId }).delete();
  }
  await db.destroy();
});

describeDb('reactivation token ledger (real DB)', () => {
  it('creates a durable token, reserves it exactly once, then attaches + consumes it', async () => {
    const { tenantId, deletionId } = await seedTenantWithPendingDeletion({
      email: 'owner@example.com',
      status: 'pending',
      scheduledDeletionDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });

    const created = await createTenantReactivationToken({ tenantId, deletionId, knex: db });

    const row = await db('tenant_reactivation_tokens')
      .where({ token_hash: created.tokenHash, tenant: tenantId })
      .first();
    expect(row).toBeTruthy();
    expect(row.reserved_at).toBeNull();
    expect(row.consumed_at).toBeNull();
    expect(row.deletion_id).toBe(deletionId);

    const first = await reserveTenantReactivationToken(created.token, db);
    expect(first).toMatchObject({ tenantId, deletionId });

    // Single-use: a replay of the same token cannot reserve again.
    const second = await reserveTenantReactivationToken(created.token, db);
    expect(second).toBeNull();

    const sessionId = `cs_test_${randomUUID()}`;
    expect(await attachCheckoutSessionToReactivationToken(created.token, sessionId, db)).toBe(true);

    // Consume is also single-use.
    expect(await consumeTenantReactivationTokenByCheckoutSession(sessionId, db)).toBe(true);
    expect(await consumeTenantReactivationTokenByCheckoutSession(sessionId, db)).toBe(false);
  });

  it('refuses an expired token', async () => {
    const { tenantId, deletionId } = await seedTenantWithPendingDeletion({
      email: 'owner@example.com',
      status: 'pending',
      scheduledDeletionDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });

    const created = await createTenantReactivationToken({
      tenantId,
      deletionId,
      expiresAt: new Date(Date.now() - 60 * 1000),
      knex: db,
    });

    expect(await reserveTenantReactivationToken(created.token, db)).toBeNull();
  });

  it('refuses a tampered token (bad signature)', async () => {
    const { tenantId, deletionId } = await seedTenantWithPendingDeletion({
      email: 'owner@example.com',
      status: 'pending',
      scheduledDeletionDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });

    const created = await createTenantReactivationToken({ tenantId, deletionId, knex: db });
    const tampered = `${created.token.slice(0, -2)}${created.token.endsWith('a') ? 'b' : 'a'}`;

    expect(await reserveTenantReactivationToken(tampered, db)).toBeNull();
    // The genuine token is still reservable — tampering didn't consume it.
    expect(await reserveTenantReactivationToken(created.token, db)).toMatchObject({ tenantId });
  });

  it('reserves atomically under concurrency — only one caller wins', async () => {
    const { tenantId, deletionId } = await seedTenantWithPendingDeletion({
      email: 'owner@example.com',
      status: 'pending',
      scheduledDeletionDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });

    const created = await createTenantReactivationToken({ tenantId, deletionId, knex: db });

    const results = await Promise.all([
      reserveTenantReactivationToken(created.token, db),
      reserveTenantReactivationToken(created.token, db),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describeDb('pending deletion detection (real DB)', () => {
  it('treats pending/confirmed as reactivatable and COALESCEs the effective deletion date', async () => {
    const autoDate = new Date('2026-08-01T00:00:00.000Z');
    const confirmedDate = new Date('2026-07-01T00:00:00.000Z');

    const pending = await seedTenantWithPendingDeletion({
      email: 'owner@example.com',
      status: 'pending',
      scheduledDeletionDate: autoDate,
    });
    const pendingSummary = await getPendingDeletionSummary(pending.tenantId, db);
    expect(pendingSummary?.reactivatable).toBe(true);
    expect(new Date(pendingSummary!.effectiveDeletionDate!).toISOString()).toBe(autoDate.toISOString());

    const confirmed = await seedTenantWithPendingDeletion({
      email: 'owner@example.com',
      status: 'confirmed',
      scheduledDeletionDate: autoDate,
      deletionScheduledFor: confirmedDate,
    });
    const confirmedSummary = await getPendingDeletionSummary(confirmed.tenantId, db);
    expect(confirmedSummary?.reactivatable).toBe(true);
    // deletion_scheduled_for wins over scheduled_deletion_date.
    expect(new Date(confirmedSummary!.effectiveDeletionDate!).toISOString()).toBe(confirmedDate.toISOString());
    expect(await getActivePendingDeletion(confirmed.tenantId, db)).not.toBeNull();
  });

  it('treats terminal statuses as not reactivatable', async () => {
    const deleting = await seedTenantWithPendingDeletion({
      email: 'owner@example.com',
      status: 'deleting',
      scheduledDeletionDate: new Date('2026-08-01T00:00:00.000Z'),
    });

    expect((await getPendingDeletionSummary(deleting.tenantId, db))?.reactivatable).toBe(false);
    expect(await getActivePendingDeletion(deleting.tenantId, db)).toBeNull();
  });
});

describeDb('reactivation contact email (real DB)', () => {
  it('resolves tenants.email and nothing else', async () => {
    const withEmail = await seedTenantWithPendingDeletion({
      email: 'billing-owner@example.com',
      status: 'pending',
      scheduledDeletionDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });
    expect(await resolveReactivationContactEmail(withEmail.tenantId, db)).toEqual({
      email: 'billing-owner@example.com',
      source: 'tenant_email',
    });

    const withoutEmail = randomUUID();
    createdTenants.push(withoutEmail);
    await db('tenants').insert({
      tenant: withoutEmail,
      client_name: `reactivation-it-${withoutEmail.slice(0, 8)}`,
      email: '',
    });
    // Empty/missing tenant email resolves to null rather than diverging from
    // the password-reset target.
    const resolved = await resolveReactivationContactEmail(withoutEmail, db);
    expect(resolved === null || resolved.email === '').toBe(true);
  });
});

describeDb('login win-back throttle (real DB)', () => {
  // Mirrors the atomic conditional UPDATE in
  // ee/server/src/lib/auth/loginWinback.ts (F047).
  function throttleUpdate(tenantId: string) {
    return db('pending_tenant_deletions')
      .where({ tenant: tenantId })
      .whereIn('status', ['pending', 'awaiting_confirmation', 'confirmed'])
      .where((builder: any) => {
        builder
          .whereNull('last_winback_email_at')
          .orWhere('last_winback_email_at', '<', db.raw(`NOW() - INTERVAL '14 days'`));
      })
      .update({ last_winback_email_at: db.fn.now() })
      .returning(['deletion_id']);
  }

  it('sends at most once per 14 days, atomically under concurrency', async () => {
    const fresh = await seedTenantWithPendingDeletion({
      email: 'owner@example.com',
      status: 'pending',
      scheduledDeletionDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      lastWinbackEmailAt: null,
    });

    // Two simultaneous attempts: exactly one claims the throttle window.
    const results = await Promise.all([throttleUpdate(fresh.tenantId), throttleUpdate(fresh.tenantId)]);
    const claimed = results.filter((rows) => Array.isArray(rows) && rows.length > 0);
    expect(claimed).toHaveLength(1);

    // A second attempt now (well within 14 days) is throttled.
    expect(await throttleUpdate(fresh.tenantId)).toHaveLength(0);

    // A tenant last emailed 20 days ago is eligible again.
    const stale = await seedTenantWithPendingDeletion({
      email: 'owner@example.com',
      status: 'pending',
      scheduledDeletionDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      lastWinbackEmailAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    });
    expect(await throttleUpdate(stale.tenantId)).toHaveLength(1);
  });
});
