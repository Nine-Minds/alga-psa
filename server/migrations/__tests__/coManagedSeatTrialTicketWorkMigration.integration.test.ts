import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const isCitus = process.env.TEST_DB_BACKEND === 'citus';
const shared = '20261119100200_co_managed_funding_views.cjs';
const access = '20261119100300_hosted_seat_trial_access.cjs';
const hosted = '20261119100400_co_managed_trial_ticket_activity.cjs';
const admission = '20261119100600_co_managed_seat_funding_admission.cjs';
const sharedDir = path.resolve(__dirname, '..');
const hostedDir = path.resolve(__dirname, '../../../ee/server/migrations');

describe('Seat trial ticket work migrations', () => {
  let db: Knex;
  let scratch: string;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    scratch = mkdtempSync(path.join(tmpdir(), 'seat-trial-ticket-work-'));
    // Mirror the combined chain's transaction boundaries and the distribution of its prerequisites.
    writeFileSync(path.join(scratch, '20261119000000_fixture.cjs'), `
      exports.config = { transaction: false };
      exports.up = async (knex) => {
        await knex.raw(\`
          CREATE TABLE tenants (tenant uuid PRIMARY KEY, product_code text, plan text, suspended_at timestamptz, billing_source text);
          CREATE TABLE co_managed_allocations (tenant uuid, allocation_id uuid, funding_source text, state text, PRIMARY KEY (tenant, allocation_id));
          CREATE TABLE co_managed_purchase_operations (tenant uuid, operation_id uuid, PRIMARY KEY (tenant, operation_id));
          CREATE TABLE co_managed_seat_arrangements (tenant uuid, arrangement_id uuid, allocation_id uuid, state text, PRIMARY KEY (tenant, arrangement_id));
          CREATE TABLE co_managed_seat_assignments (tenant uuid, assignment_id uuid, arrangement_id uuid, user_id uuid, state text,
            PRIMARY KEY (tenant, assignment_id));
          CREATE TABLE co_managed_seat_board_scopes (tenant uuid, arrangement_id uuid, board_id uuid, PRIMARY KEY (tenant, arrangement_id, board_id));
          CREATE TABLE co_managed_entitlements (tenant uuid PRIMARY KEY, source text);
          CREATE TABLE users (tenant uuid, user_id uuid, user_type text, PRIMARY KEY (tenant, user_id));
          CREATE TABLE tickets (tenant uuid, ticket_id uuid, client_id uuid, board_id uuid, PRIMARY KEY (tenant, ticket_id));
          CREATE TABLE ticket_audit_logs (tenant uuid, audit_id uuid, actor_user_id uuid, actor_type text, event_type text,
            ticket_id uuid, occurred_at timestamptz DEFAULT now(), via_principal_user_id uuid, source text, PRIMARY KEY (tenant, audit_id));
          CREATE TABLE license_state (id integer PRIMARY KEY);
          CREATE TABLE stripe_subscriptions (tenant uuid, stripe_subscription_id uuid, status text,
            current_period_end timestamptz, metadata jsonb, created_at timestamptz DEFAULT now(), PRIMARY KEY (tenant, stripe_subscription_id));
        \`);
        if (process.env.TEST_DB_BACKEND === 'citus') {
          await knex.raw("SELECT create_distributed_table('tenants', 'tenant')");
          for (const table of ['co_managed_allocations', 'co_managed_purchase_operations', 'co_managed_seat_arrangements',
            'co_managed_seat_assignments', 'co_managed_seat_board_scopes', 'co_managed_entitlements', 'users', 'tickets', 'ticket_audit_logs']) {
            await knex.raw("SELECT create_distributed_table(?, 'tenant', colocate_with => 'tenants')", [table]);
          }
        }
      };
      exports.down = async () => {};
    `);
    for (const [dir, file] of [
      [hostedDir, '20261119100100_add_co_managed_seat_trial.cjs'],
      [sharedDir, shared],
      [hostedDir, access],
      [hostedDir, hosted],
      [sharedDir, admission],
    ]) {
      writeFileSync(path.join(scratch, file), `module.exports = require(${JSON.stringify(path.join(dir, file))});\n`);
    }
    db = await createTestDbConnection({ databaseName: 'seat_trial_ticket_work_migrations_test', migrationsDir: scratch, runSeeds: false });
  }, 300_000);

  afterAll(async () => {
    try {
      await db?.destroy();
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('installs the hosted recorder alongside the distributed journal schema and supports rollback', async () => {
    const tenant = randomUUID();
    const auditId = randomUUID();
    const record = () => db.raw('SELECT record_co_managed_trial_ticket_work(?, ?)', [tenant, auditId]);

    if (isCitus) {
      const { rows } = await db.raw(`SELECT partmethod FROM pg_dist_partition
        WHERE logicalrelid = 'co_managed_trial_ticket_activity'::regclass`);
      expect(rows).toEqual([{ partmethod: 'h' }]);
    }
    expect(await db.schema.hasColumn('co_managed_purchase_operations', 'trial_id')).toBe(true);
    await record();
    expect(await db('co_managed_trial_ticket_activity').where({ tenant })).toEqual([]);

    await db.migrate.down({ name: hosted });
    expect(await db.schema.hasTable('co_managed_trial_ticket_activity')).toBe(false);
    await record();

    await db.migrate.up({ name: hosted });
    await record();
  });

  it('rechecks hosted Seat access against coordinator billing and the installation license', async () => {
    const tenant = randomUUID();
    const allocationId = randomUUID();
    const arrangementId = randomUUID();
    const assignmentId = randomUUID();
    const clientId = randomUUID();
    const trialId = randomUUID();
    const technician = randomUUID();
    const staffer = randomUUID();
    const ticketId = randomUUID();
    const boardId = randomUUID();
    const activatedAt = new Date();
    const deadlineAt = new Date(activatedAt.getTime() + 360 * 60 * 60 * 1000);
    await db('tenants').insert({ tenant, product_code: 'psa', plan: 'pro', billing_source: 'stripe' });
    await db('stripe_subscriptions').insert([
      { tenant, stripe_subscription_id: randomUUID(), status: 'trialing', current_period_end: deadlineAt, trial_end: activatedAt },
      { tenant, stripe_subscription_id: randomUUID(), status: 'active', current_period_end: deadlineAt },
    ]);
    await db('co_managed_allocations').insert({ tenant, allocation_id: allocationId, funding_source: 'seat_trial', state: 'active' });
    await db('co_managed_seat_arrangements').insert({ tenant, arrangement_id: arrangementId, allocation_id: allocationId, state: 'active' });
    await db('co_managed_seat_assignments').insert({ tenant, assignment_id: assignmentId, arrangement_id: arrangementId,
      user_id: technician, state: 'active' });
    await db('co_managed_seat_trials').insert({ tenant, trial_id: trialId, client_id: clientId, allocation_id: allocationId,
      arrangement_id: arrangementId, assignment_id: assignmentId, state: 'active', activated_at: activatedAt, deadline_at: deadlineAt });
    await db('users').insert({ tenant, user_id: staffer, user_type: 'internal' });
    await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, board_id: boardId });
    await db('co_managed_seat_board_scopes').insert({ tenant, arrangement_id: arrangementId, board_id: boardId });

    const sponsors = () => db('co_managed_trial_sponsors').where({ tenant }).select('status');
    const blocked = () => db('co_managed_unavailable_trial_assignments').where({ tenant }).select('assignment_id');
    expect(await sponsors()).toEqual([{ status: 'active' }]);
    expect(await blocked()).toEqual([]);
    const journal = (userId: string) => db.transaction(async (trx) => {
      const auditId = randomUUID();
      await trx('ticket_audit_logs').insert({ tenant, audit_id: auditId, ticket_id: ticketId,
        actor_user_id: userId, actor_type: 'user', event_type: 'TICKET_UPDATED', source: 'ui' });
      await trx.raw('SELECT record_co_managed_trial_ticket_work(?, ?)', [tenant, auditId]);
    });
    const milestones = () => db('co_managed_seat_trial_milestones').where({ tenant, trial_id: trialId }).select('milestone');
    await journal(technician);
    expect(await milestones()).toEqual([]);
    await journal(staffer);
    expect(await milestones()).toEqual([{ milestone: 'shared_ticket_work' }]);

    await db('license_state').insert({ id: 1 });
    expect(await sponsors()).toEqual([]);
    expect(await blocked()).toEqual([{ assignment_id: assignmentId }]);
  });
});
