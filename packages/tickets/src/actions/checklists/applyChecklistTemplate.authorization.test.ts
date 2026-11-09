// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeTenantTables } from '@alga-psa/db/testing';

const state = vi.hoisted(() => ({
  user: { user_id: 'admin-1', user_type: 'internal', first_name: 'MSP', last_name: 'Admin', roles: [{ role_id: 'admin' }] },
  tables: {} as FakeTenantTables,
  db: { connection: 'base' },
  trx: { isTransaction: true },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: Function) => (...args: unknown[]) => action(state.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async () => {
  const { fakeTenantDb } = await import('@alga-psa/db/testing');
  return {
    tenantDb: fakeTenantDb({ tables: state.tables }),
    createTenantKnex: vi.fn(async () => ({ knex: state.db })),
    withTransaction: async (_db: unknown, work: Function) => work(state.trx),
  };
});
vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({
  getClientContactVisibilityContext: vi.fn(),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));
vi.mock('@alga-psa/shared/lib/ticketChecklists', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/shared/lib/ticketChecklists')>(),
  applyChecklistTemplateToTicket: vi.fn(),
}));

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { applyChecklistTemplateToTicket } from '@alga-psa/shared/lib/ticketChecklists';
import { applyChecklistTemplate } from './applyChecklistTemplate';
import type { fakeTenantDb } from '@alga-psa/db/testing';

const scopedDb = tenantDb as unknown as ReturnType<typeof fakeTenantDb>;
const applied = { applied: true, itemsAdded: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  scopedDb.calls.length = 0;
  state.user.user_type = 'internal';
  state.tables['tenant-1:tickets'] = [{ ticket_id: 'ticket-1', board_id: 'board-1', client_id: 'client-1' }];
  state.tables['tenant-2:tickets'] = [{ ticket_id: 'foreign-ticket', board_id: 'board-1' }];
  vi.mocked(hasPermission).mockResolvedValue(true);
  vi.mocked(resolveBundleNarrowingRulesForEvaluation).mockResolvedValue([]);
  vi.mocked(applyChecklistTemplateToTicket).mockResolvedValue(applied);
});

describe('manual checklist application authorization', () => {
  it('authorizes through the tenant-scoped helper before applying in the same transaction', async () => {
    vi.mocked(applyChecklistTemplateToTicket).mockImplementationOnce(async () => {
      expect(scopedDb.calls).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: 'tickets', tenant: 'tenant-1', handle: state.trx }),
      ]));
      expect(scopedDb.calls.every(call => call.tenant === 'tenant-1' && call.handle === state.trx)).toBe(true);
      return applied;
    });

    await expect(applyChecklistTemplate('ticket-1', 'template-1')).resolves.toEqual(applied);
    expect(hasPermission).toHaveBeenCalledWith(state.user, 'ticket_settings', 'update');
    expect(hasPermission).toHaveBeenCalledWith(state.user, 'ticket', 'update');
    expect(applyChecklistTemplateToTicket).toHaveBeenCalledExactlyOnceWith(
      state.trx, 'tenant-1', 'ticket-1', 'template-1', 'template',
      expect.objectContaining({ actor: expect.objectContaining({ userId: 'admin-1' }) }),
      'client-1',
    );
  });

  it.each(['client', 'dispatcher', 'no-ticket-update'])('rejects %s before opening a database connection', async (principal) => {
    if (principal === 'client') state.user.user_type = 'client';
    vi.mocked(hasPermission).mockImplementation(async (_user, resource) =>
      principal === 'dispatcher' ? resource !== 'ticket_settings' : principal !== 'no-ticket-update' || resource !== 'ticket');

    await expect(applyChecklistTemplate('ticket-1', 'template-1')).resolves.toMatchObject({
      permissionError: expect.stringContaining('Permission denied'),
    });
    expect(createTenantKnex).not.toHaveBeenCalled();
    expect(applyChecklistTemplateToTicket).not.toHaveBeenCalled();
  });

  it.each(['missing-ticket', 'foreign-ticket'])('does not apply to %s outside the current tenant lookup', async (ticketId) => {
    await expect(applyChecklistTemplate(ticketId, 'template-1')).resolves.toMatchObject({
      actionError: 'Ticket not found',
    });
    expect(applyChecklistTemplateToTicket).not.toHaveBeenCalled();
  });

  it('denies a settings administrator excluded by ticket update policy', async () => {
    vi.mocked(resolveBundleNarrowingRulesForEvaluation).mockResolvedValue([{
      id: 'rule-1', resource: 'ticket', action: 'update', templateKey: 'selected_boards', selectedBoardIds: ['other-board'],
    }]);

    await expect(applyChecklistTemplate('ticket-1', 'template-1')).resolves.toMatchObject({
      permissionError: 'Permission denied: Cannot access ticket',
    });
    expect(applyChecklistTemplateToTicket).not.toHaveBeenCalled();
  });
});
