// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTenantDb, fakeTransaction } from '@alga-psa/db/testing';
import { applyChecklistTemplate } from './applyChecklistTemplate';

const state = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  applyTemplate: vi.fn(),
  tenantDb: vi.fn(),
  db: {},
  trx: {},
}));

const user = {
  user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1',
  contact_id: 'contact-1', clientId: 'client-1', roles: [{ role_id: 'role-1' }],
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: unknown[]) => action(user, { tenant: user.tenant }, ...args),
  hasPermission: state.hasPermission,
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: state.db }),
  withTransaction: async (_db: unknown, work: any) => work(state.trx),
  tenantDb: state.tenantDb,
}));
vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({
  getClientContactVisibilityContext: vi.fn(),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  bundleNarrowingRuleFromRow: (rule: any) => ({
    id: rule.rule_id, resource: rule.resource_type, action: rule.action,
    templateKey: rule.template_key, constraintKey: rule.constraint_key,
    constraints: [], redactedFields: [], ...rule.config,
  }),
  resolveBundleNarrowingRulesForEvaluation: async () => [
    { id: 'client-rule', resource: 'ticket', action: 'update', templateKey: 'selected_clients', selectedClientIds: ['client-1'] },
    { id: 'board-rule', resource: 'ticket', action: 'update', templateKey: 'selected_boards', selectedBoardIds: ['board-1'] },
  ],
  loadAuthorizationEvaluationSnapshot: async () => ({
    roleIds: [], teamIds: [], managedUserIds: [], rules: [
      {
        rule_id: 'client-rule', resource_type: 'ticket', action: 'update',
        template_key: 'selected_clients', constraint_key: null,
        config: { selectedClientIds: ['client-1'] },
      },
      {
        rule_id: 'board-rule', resource_type: 'ticket', action: 'update',
        template_key: 'selected_boards', constraint_key: null,
        config: { selectedBoardIds: ['board-1'] },
      },
    ],
  }),
}));
vi.mock('@alga-psa/shared/lib/ticketChecklists', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/shared/lib/ticketChecklists')>(),
  applyChecklistTemplateToTicket: state.applyTemplate,
}));

const ticket = {
  ticket_id: 'ticket-1', client_id: 'client-1', board_id: 'board-1',
  assigned_to: null, entered_by: null, assigned_team_id: null,
  contact_name_id: 'contact-1', billing_profile_id: null, attributes: {},
};

function database(localTickets: Record<string, unknown>[]) {
  const db = fakeTenantDb({ tables: {
    'tenant-1:tickets': localTickets,
    // The same ID in another tenant must never satisfy the authorization lookup.
    'tenant-2:tickets': [ticket],
  } });
  state.tenantDb.mockImplementation(db);
  return db;
}

describe('manual checklist template authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user.user_type = 'internal';
    state.trx = fakeTransaction();
    state.hasPermission.mockResolvedValue(true);
    state.applyTemplate.mockResolvedValue({ applied: true, itemsAdded: 1 });
  });

  it('authorizes the ticket in the authenticated tenant and applies within the same transaction', async () => {
    const db = database([ticket]);
    await expect(applyChecklistTemplate('ticket-1', 'template-1')).resolves.toEqual({ applied: true, itemsAdded: 1 });
    expect(state.hasPermission).toHaveBeenCalledWith(user, 'ticket_settings', 'update');
    expect(state.hasPermission).toHaveBeenCalledWith(user, 'ticket', 'update');
    expect(db.calls.length).toBeGreaterThan(0);
    expect(db.calls.every(call => call.tenant === 'tenant-1' && call.handle === state.trx)).toBe(true);
    expect(db.calls.filter(call => call.table === 'tickets')).toHaveLength(1);
    expect(state.applyTemplate).toHaveBeenCalledExactlyOnceWith(
      state.trx, 'tenant-1', 'ticket-1', 'template-1', 'template',
      expect.objectContaining({ actor: expect.objectContaining({ userId: user.user_id }) }),
      ticket.client_id,
    );
  });

  it.each([
    ['another client', [{ ...ticket, client_id: 'client-2' }]],
    ['a hidden board', [{ ...ticket, board_id: 'board-2' }]],
  ])('refuses a ticket belonging to %s without applying the template', async (_name, rows) => {
    database(rows);
    await expect(applyChecklistTemplate('ticket-1', 'template-1')).resolves.toMatchObject({
      permissionError: 'Permission denied: Cannot access ticket',
    });
    expect(state.applyTemplate).not.toHaveBeenCalled();
  });

  it.each([
    ['another tenant only', []],
    ['a different ticket ID', [{ ...ticket, ticket_id: 'ticket-2' }]],
  ])('reports a ticket belonging to %s as missing without applying the template', async (_name, rows) => {
    database(rows);
    await expect(applyChecklistTemplate('ticket-1', 'template-1')).resolves.toEqual({
      actionError: 'Ticket not found',
    });
    expect(state.applyTemplate).not.toHaveBeenCalled();
  });

  it.each(['ticket_settings', 'ticket'])('refuses missing %s:update permission before reading or applying', async (resource) => {
    const db = database([ticket]);
    state.hasPermission.mockImplementation(async (_user, requestedResource) => requestedResource !== resource);
    await expect(applyChecklistTemplate('ticket-1', 'template-1')).resolves.toMatchObject({
      permissionError: 'Permission denied: Cannot update ticket checklist',
    });
    expect(state.hasPermission).toHaveBeenCalledWith(user, resource, 'update');
    expect(db.calls).toEqual([]);
    expect(state.applyTemplate).not.toHaveBeenCalled();
  });

  it.each([
    ['visible', [ticket]],
    ['hidden', [{ ...ticket, client_id: 'client-2' }]],
    ['missing', []],
  ])('rejects a client principal with granted RBAC permissions for a %s ticket before reading or applying', async (_name, rows) => {
    const db = database(rows);
    user.user_type = 'client';

    await expect(applyChecklistTemplate('ticket-1', 'template-1')).resolves.toEqual({
      permissionError: 'Permission denied: Cannot update ticket checklist',
    });
    expect(db.calls).toEqual([]);
    expect(state.applyTemplate).not.toHaveBeenCalled();
  });
});
