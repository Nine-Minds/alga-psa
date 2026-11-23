/**
 * T213, T215–T222, T226 — F122–F128 of `ee/plans/2026-11-21-itil-remediation` (`sla`).
 *
 * The ITIL SLA policy a new ITIL board gets: found by its flag rather than its name, topped up
 * rather than rewritten, and reached through hooks held on `globalThis` so a server action sees
 * what startup registered. Nothing else ever assigns a policy (D1/D6).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  preCheckDeletion: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
// The delete the SLA cancellation hangs off is record-authorized; the fixture user carries no
// roles, and what this suite is about is the hook, not RBAC.
vi.mock('@alga-psa/authorization/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/authorization/rbac')>()),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/event-bus/publishers')>()),
  publishEvent: vi.fn(async () => undefined),
}));

import { tenantDb } from '@alga-psa/db';
import { configureItilSlaForBoard } from '../../../../packages/sla/src/services/itilSlaService';
import {
  ITIL_SLA_ESCALATION_PERCENTS,
  ITIL_SLA_NOTIFICATION_THRESHOLDS,
  ITIL_SLA_TARGETS,
} from '@alga-psa/shared/lib/sla/itilSlaDefaults';
import {
  clearSlaIntegrationHooksForTest,
  registerItilSlaConfigurationHook,
} from '../../../../packages/tickets/src/lib/slaIntegrationHooks';
import {
  createBoardCore,
  switchBoardTypeCore,
  updateBoardCore,
} from '../../../../packages/tickets/src/services/boardLifecycle';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  cleanupItilSecondBoardFixture,
  createItilSecondBoardFixture,
  type ItilSecondBoardFixture,
} from './fixtures/itilSecondBoardFixture';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
let fixture: ItilSecondBoardFixture;

function tt(table: string) {
  return tenantDb(db, fixture.tenantId).table(table);
}

const actor = () => ({ userId: fixture.userId });

async function createdBoardIds(): Promise<string[]> {
  const known = new Set(Object.values(fixture.boards));
  return (await tt('boards').pluck('board_id')).filter((id: string) => !known.has(id));
}

/** A board create with the hook registered the way `registerSlaIntegration` does at startup. */
async function createItilBoard(name: string, extra: Record<string, unknown> = {}) {
  return db.transaction((trx) =>
    createBoardCore(trx, fixture.tenantId, actor(), {
      board_name: name,
      category_type: 'itil',
      priority_type: 'itil',
      ...extra,
    } as never)
  );
}

describe('ITIL SLA policy (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (!fixture) return;
    const extra = await createdBoardIds();
    if (extra.length > 0) {
      await tt('categories').whereIn('board_id', extra).whereNotNull('parent_category').del();
      await tt('categories').whereIn('board_id', extra).del();
      await tt('statuses').whereIn('board_id', extra).del();
      await tt('boards').whereIn('board_id', extra).update({ default_priority_id: null, sla_policy_id: null });
      await tt('boards').whereIn('board_id', extra).del();
    }
    await tt('boards').update({ sla_policy_id: null });
    await tt('sla_policy_targets').del();
    await tt('sla_notification_thresholds').del();
    await tt('sla_policies').del();
    await cleanupItilSecondBoardFixture(db, fixture.tenantId);
    fixture = undefined as unknown as ItilSecondBoardFixture;
    clearSlaIntegrationHooksForTest();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  async function withFixture(options: { registerHook?: boolean } = {}): Promise<void> {
    fixture = await createItilSecondBoardFixture(db);
    dbRef.knex = db;
    dbRef.tenant = fixture.tenantId;
    userRef.user = { user_id: fixture.userId, user_type: 'internal', tenant: fixture.tenantId };
    clearSlaIntegrationHooksForTest();
    if (options.registerHook !== false) {
      registerItilSlaConfigurationHook(configureItilSlaForBoard as never);
    }
  }

  it('T213: a board created through the lifecycle gets the ITIL policy, with the hook registered at startup', async () => {
    await withFixture();
    const board = await createItilBoard('SLA board');

    const policy = await tt('sla_policies').where({ is_itil_standard: true }).first('sla_policy_id', 'policy_name');
    expect(policy).toBeTruthy();
    expect(board.sla_policy_id).toBe(policy.sla_policy_id);

    // Its targets cover the tenant's ITIL priorities.
    const targets = await tt('sla_policy_targets').where({ sla_policy_id: policy.sla_policy_id }).pluck('priority_id');
    expect(targets.sort()).toEqual(Object.values(fixture.itilPriorityIds).sort());
  }, HOOK_TIMEOUT);

  it('T220: the targets created are exactly the shared ITIL defaults', async () => {
    await withFixture();
    const board = await createItilBoard('Defaults board');

    const targets = await tt('sla_policy_targets')
      .where({ sla_policy_id: board.sla_policy_id })
      .select('priority_id', 'response_time_minutes', 'resolution_time_minutes', 'is_24x7',
        'escalation_1_percent', 'escalation_2_percent', 'escalation_3_percent');

    for (const [level, priorityId] of Object.entries(fixture.itilPriorityIds)) {
      const expected = ITIL_SLA_TARGETS[Number(level)];
      expect(targets.find((target: any) => target.priority_id === priorityId), `level ${level}`).toMatchObject({
        response_time_minutes: expected.responseTimeMinutes,
        resolution_time_minutes: expected.resolutionTimeMinutes,
        is_24x7: expected.is24x7,
        ...ITIL_SLA_ESCALATION_PERCENTS,
      });
    }

    // The thresholds come from the same definition, which is what `ensureSlaParity` also writes.
    const thresholds = await tt('sla_notification_thresholds')
      .where({ sla_policy_id: board.sla_policy_id })
      .pluck('threshold_percent');
    expect(thresholds.map(Number).sort((a, b) => a - b)).toEqual(
      ITIL_SLA_NOTIFICATION_THRESHOLDS.map((threshold) => threshold.threshold_percent).sort((a, b) => a - b)
    );
  }, HOOK_TIMEOUT);

  it('T215: with no hook registered, ITIL setup fails on a PSA tenant and is skipped on AlgaDesk', async () => {
    await withFixture({ registerHook: false });

    const failure = await createItilBoard('No hook board').catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('registerSlaIntegration');
    expect(await createdBoardIds()).toEqual([]);

    // An AlgaDesk tenant has no SLA at all, so the missing hook is not an error there.
    await tenantDb(db, '__test_tenant_fixture__')
      .unscoped('tenants', 'the test switches the fixture tenant to the AlgaDesk product')
      .where({ tenant: fixture.tenantId })
      .update({ product_code: 'algadesk' });

    const board = await createItilBoard('AlgaDesk board');
    expect(board.sla_policy_id ?? null).toBeNull();
    expect(await tt('sla_policies').where({ is_itil_standard: true }).first()).toBeUndefined();

    await tenantDb(db, '__test_tenant_fixture__')
      .unscoped('tenants', 'restore the fixture tenant')
      .where({ tenant: fixture.tenantId })
      .update({ product_code: 'psa' });
  }, HOOK_TIMEOUT);

  it('T217, T218: the policy is found by its flag, so a rename is reused and a tenant’s own policy is left alone', async () => {
    await withFixture();
    const first = await createItilBoard('First SLA board');
    const policyId = first.sla_policy_id as string;

    // The tenant renames the policy, and happens to have one of its own with the old name.
    await tt('sla_policies').where({ sla_policy_id: policyId }).update({ policy_name: 'Our incident SLA' });
    const impostorId = randomUUID();
    await tt('sla_policies').insert({
      tenant: fixture.tenantId,
      sla_policy_id: impostorId,
      policy_name: 'ITIL Standard',
    });

    const second = await createItilBoard('Second SLA board');
    expect(second.sla_policy_id).toBe(policyId);
    expect(await tt('sla_policies').where({ is_itil_standard: true }).pluck('sla_policy_id')).toEqual([policyId]);
    // The tenant's own policy is neither adopted nor touched.
    expect(await tt('sla_policies').where({ sla_policy_id: impostorId }).first('policy_name')).toMatchObject({
      policy_name: 'ITIL Standard',
    });
  }, HOOK_TIMEOUT);

  it('T219: an existing policy is topped up for priorities with no target, and edited targets are kept', async () => {
    await withFixture();
    const first = await createItilBoard('Top-up board');
    const policyId = first.sla_policy_id as string;

    // An admin edits one target, and one priority loses its target (as it would if the ITIL
    // priorities had been re-created).
    await tt('sla_policy_targets')
      .where({ sla_policy_id: policyId, priority_id: fixture.itilPriorityIds[2] })
      .update({ response_time_minutes: 5, resolution_time_minutes: 50 });
    await tt('sla_policy_targets')
      .where({ sla_policy_id: policyId, priority_id: fixture.itilPriorityIds[4] })
      .del();

    await createItilBoard('Second top-up board');

    const targets = await tt('sla_policy_targets')
      .where({ sla_policy_id: policyId })
      .select('priority_id', 'response_time_minutes', 'resolution_time_minutes');
    expect(targets.map((target: any) => target.priority_id).sort()).toEqual(
      Object.values(fixture.itilPriorityIds).sort()
    );
    expect(targets.find((target: any) => target.priority_id === fixture.itilPriorityIds[2])).toMatchObject({
      response_time_minutes: 5,
      resolution_time_minutes: 50,
    });
    // The restored one uses the shared defaults for its level (4: 240 / 4320).
    expect(targets.find((target: any) => target.priority_id === fixture.itilPriorityIds[4])).toMatchObject({
      response_time_minutes: 240,
      resolution_time_minutes: 4320,
    });
  }, HOOK_TIMEOUT);

  it('T221: a board update and a kind switch assign no policy', async () => {
    await withFixture();
    const before = await tt('boards').orderBy('board_id').select('board_id', 'sla_policy_id');

    await db.transaction((trx) =>
      updateBoardCore(trx, fixture.tenantId, actor(), fixture.boards.itilTwo, { description: 'edited' } as never)
    );
    await db.transaction((trx) =>
      switchBoardTypeCore(trx, fixture.tenantId, actor(), fixture.boards.own, 'itil')
    );

    expect(await tt('boards').orderBy('board_id').select('board_id', 'sla_policy_id')).toEqual(before);
    // D6: the switch created no policy either.
    expect(await tt('sla_policies').where({ is_itil_standard: true }).first()).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('T222: a board created with an explicit SLA policy keeps it', async () => {
    await withFixture();
    const ownPolicyId = randomUUID();
    await tt('sla_policies').insert({
      tenant: fixture.tenantId,
      sla_policy_id: ownPolicyId,
      policy_name: 'Gold support',
    });

    const board = await createItilBoard('Explicit policy board', { sla_policy_id: ownPolicyId });
    expect(board.sla_policy_id).toBe(ownPolicyId);
    // The ITIL policy was still created for the tenant; it was simply not forced onto the board.
    expect(await tt('sla_policies').where({ is_itil_standard: true }).first()).toBeTruthy();
  }, HOOK_TIMEOUT);

  it('T227: a ticket deleted through the server action cancels its SLA, with no page rendered', async () => {
    await withFixture();
    const { deleteTicket, registerSlaCancellation } = await import(
      '../../../../packages/tickets/src/actions/ticketActions'
    );

    // Registered the way startup does it, from outside the action's own module.
    const cancelled: Array<[string, string]> = [];
    registerSlaCancellation(async (tenantId: string, ticketId: string) => {
      cancelled.push([tenantId, ticketId]);
    });

    const ticketId = randomUUID();
    await tt('tickets').insert({
      tenant: fixture.tenantId,
      ticket_id: ticketId,
      ticket_number: `SLA-${ticketId.slice(0, 8)}`,
      title: 'Closed and cancelled',
      client_id: fixture.clientId,
      board_id: fixture.boards.itilOne,
      status_id: fixture.statuses.itilOne,
      priority_id: fixture.itilPriorityIds[3],
      entered_by: fixture.userId,
      entered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_closed: false,
    });

    const { runWithTenant } = await import('@alga-psa/db');
    const result = await runWithTenant(fixture.tenantId, () => deleteTicket(ticketId));
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    expect(cancelled).toEqual([[fixture.tenantId, ticketId]]);
  }, HOOK_TIMEOUT);

  it('T226: a hook registered through one import is visible through a second instance of the module', async () => {
    await withFixture({ registerHook: false });
    clearSlaIntegrationHooksForTest();

    // Two separately loaded instances of the module, as Next's bundles are.
    const first = await import('../../../../packages/tickets/src/lib/slaIntegrationHooks?instance=1');
    const second = await import('../../../../packages/tickets/src/lib/slaIntegrationHooks?instance=2');
    expect(first).not.toBe(second);

    const hook = (async () => ({ created: false })) as never;
    (first as any).registerItilSlaConfigurationHook(hook);

    expect((second as any).getItilSlaConfigurationHook()).toBe(hook);
    expect((second as any).areSlaIntegrationHooksRegistered()).toBe(false); // cancellation is still missing
    (second as any).registerSlaCancellationHook(async () => undefined);
    expect((first as any).areSlaIntegrationHooksRegistered()).toBe(true);
  }, HOOK_TIMEOUT);
});
