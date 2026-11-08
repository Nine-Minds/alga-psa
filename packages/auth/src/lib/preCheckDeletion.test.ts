import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();
const hasPermissionMock = vi.fn();
const getDeletionConfigMock = vi.fn();
const validateDeletionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const gateFixtures = vi.hoisted(() => ({ ticket: null as any, bundleRules: [] as any[] }));
const resolveBundleRulesMock = vi.hoisted(() => vi.fn(async () => gateFixtures.bundleRules));
const getVisibilityMock = vi.hoisted(() => vi.fn(async () => ({
  effectiveTicketScope: 'contact', ticketScope: 'contact', contactId: 'contact-1', clientId: 'client-1',
  visibleBoardIds: ['board-1'], isClientAdmin: false, visibilityGroupId: null,
})));
const clientPrincipal = {
  user_id: 'client-u', tenant: 't1', user_type: 'client', contact_id: 'contact-1', clientId: 'client-1',
  roles: [{ role_id: 'client-role' }],
};

vi.mock('./getCurrentUser', () => ({
  getCurrentUser: (...args: any[]) => getCurrentUserMock(...args)
}));

vi.mock('./rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args)
}));

vi.mock('@alga-psa/core/server', () => ({
  getDeletionConfig: (...args: any[]) => getDeletionConfigMock(...args),
  validateDeletion: (...args: any[]) => validateDeletionMock(...args)
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => {
      let query: any;
      query = {
        where: () => query,
        select: () => query,
        first: async () => table === 'tickets' ? gateFixtures.ticket : undefined,
        then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
      };
      return query;
    }
  })
}));

vi.mock('@alga-psa/authorization/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args)
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: any[]) => resolveBundleRulesMock(...args)
}));

vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({
  getClientContactVisibilityContext: (...args: any[]) => getVisibilityMock(...args)
}));

import { preCheckDeletion } from './preCheckDeletion';

describe('preCheckDeletion permission mapping', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    hasPermissionMock.mockReset();
    getDeletionConfigMock.mockReset();
    validateDeletionMock.mockReset();
    createTenantKnexMock.mockReset();
    withTransactionMock.mockReset();
    resolveBundleRulesMock.mockClear();
    getVisibilityMock.mockClear();
    gateFixtures.ticket = null;
    gateFixtures.bundleRules = [];

    getCurrentUserMock.mockResolvedValue({ user_id: 'u1', tenant: 't1', user_type: 'internal' });
    getDeletionConfigMock.mockReturnValue({ entityType: 'tax_rate', dependencies: [] });
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 't1' });
    withTransactionMock.mockImplementation(async (_knex: unknown, fn: any) => fn({}));
    validateDeletionMock.mockResolvedValue({ canDelete: true, dependencies: [], alternatives: [] });
  });

  it('checks billing:delete (not tax_rate:delete) when validating tax_rate deletion', async () => {
    await preCheckDeletion('tax_rate', 'rate-1');

    expect(hasPermissionMock).toHaveBeenCalledTimes(1);
    const [, resource, action] = hasPermissionMock.mock.calls[0];
    expect(resource).toBe('billing');
    expect(action).toBe('delete');
  });

  it('returns PERMISSION_DENIED for tax_rate when user lacks billing:delete', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);

    const result = await preCheckDeletion('tax_rate', 'rate-1');

    expect(result.canDelete).toBe(false);
    expect(result.code).toBe('PERMISSION_DENIED');
  });

  it('still uses the entity type as resource for unmapped entities', async () => {
    getDeletionConfigMock.mockReturnValueOnce({ entityType: 'project', dependencies: [] });

    await preCheckDeletion('project', 'p-1');

    const [, resource] = hasPermissionMock.mock.calls[0];
    expect(resource).toBe('project');
  });

  it('checks settings:delete (not interaction_type:delete) when validating interaction_type deletion', async () => {
    getDeletionConfigMock.mockReturnValueOnce({ entityType: 'interaction_type', dependencies: [] });

    await preCheckDeletion('interaction_type', 'it-1');

    const [, resource, action] = hasPermissionMock.mock.calls[0];
    expect(resource).toBe('settings');
    expect(action).toBe('delete');
  });

  it('checks billing:delete (not quote:delete) when validating quote deletion', async () => {
    getDeletionConfigMock.mockReturnValueOnce({ entityType: 'quote', dependencies: [] });

    await preCheckDeletion('quote', 'q-1');

    const [, resource, action] = hasPermissionMock.mock.calls[0];
    expect(resource).toBe('billing');
    expect(action).toBe('delete');
  });

  // The deletion-config key and the permission resource are the same name now
  // that RBAC no longer stores `timeentry`; no mapping entry should reappear.
  it('checks time_entry:delete when validating time_entry deletion', async () => {
    getDeletionConfigMock.mockReturnValueOnce({ entityType: 'time_entry', dependencies: [] });

    await preCheckDeletion('time_entry', 'te-1');

    const [, resource, action] = hasPermissionMock.mock.calls[0];
    expect(resource).toBe('time_entry');
    expect(action).toBe('delete');
  });

  it('authorizes a ticket record before exposing dependencies to an internal principal', async () => {
    getDeletionConfigMock.mockReturnValueOnce({ entityType: 'ticket', dependencies: [] });
    validateDeletionMock.mockResolvedValueOnce({
      canDelete: false,
      code: 'DEPENDENCIES_EXIST',
      message: '1 time entry blocks deletion',
      dependencies: [{ type: 'time_entry', count: 1 }],
      alternatives: [{ action: 'archive' }]
    });
    gateFixtures.ticket = {
      ticket_id: 'restricted-ticket', assigned_to: null, entered_by: 'owner-1', client_id: 'client-1',
      board_id: 'board-1', assigned_team_id: null, contact_name_id: 'contact-1', attributes: {}
    };
    gateFixtures.bundleRules = [{
      id: 'board-scope', resource: 'ticket', action: 'update', templateKey: 'selected_boards', selectedBoardIds: ['board-2']
    }];
    const user = { user_id: 'u1', tenant: 't1', user_type: 'internal', roles: [{ role_id: 'r1' }] };
    getCurrentUserMock.mockResolvedValueOnce(user);

    const result = await preCheckDeletion('ticket', 'restricted-ticket');

    expect(result).toMatchObject({ canDelete: false, code: 'PERMISSION_DENIED', dependencies: [], alternatives: [] });
    expect(resolveBundleRulesMock).toHaveBeenCalled();
    expect(hasPermissionMock).not.toHaveBeenCalled();
    expect(validateDeletionMock).not.toHaveBeenCalled();
  });

  it('conceals client invisible and missing tickets with the same metadata-free response', async () => {
    getDeletionConfigMock.mockReturnValue({ entityType: 'ticket', dependencies: [] });
    validateDeletionMock
      .mockResolvedValueOnce({
        canDelete: false, code: 'DEPENDENCIES_EXIST', message: '1 time entry blocks deletion',
        dependencies: [{ type: 'time_entry', count: 1 }], alternatives: [{ action: 'archive' }]
      })
      .mockResolvedValueOnce({
        canDelete: false, code: 'DEPENDENCIES_EXIST', message: '1 time entry blocks deletion',
        dependencies: [{ type: 'time_entry', count: 1 }], alternatives: [{ action: 'archive' }]
      });
    getCurrentUserMock.mockResolvedValue(clientPrincipal);
    gateFixtures.ticket = {
      ticket_id: 'hidden-ticket', assigned_to: null, entered_by: 'owner-1', client_id: 'client-1',
      board_id: 'board-1', assigned_team_id: null, contact_name_id: 'another-contact', attributes: {}
    };

    const invisible = await preCheckDeletion('ticket', 'hidden-ticket');
    gateFixtures.ticket = null;
    const missing = await preCheckDeletion('ticket', 'missing-ticket');

    expect(invisible).toEqual(missing);
    expect(invisible).toMatchObject({ canDelete: false, code: 'PERMISSION_DENIED', dependencies: [], alternatives: [] });
    expect(JSON.stringify(invisible)).not.toMatch(/time_entry|archive|"count"/i);
    expect(getVisibilityMock).toHaveBeenCalledTimes(1);
    expect(getVisibilityMock).toHaveBeenCalledWith({}, 't1', 'contact-1');
    expect(validateDeletionMock).not.toHaveBeenCalled();
  });

  it('preserves dependency blocking for an authorized client principal', async () => {
    getDeletionConfigMock.mockReturnValueOnce({ entityType: 'ticket', dependencies: [] });
    getCurrentUserMock.mockResolvedValueOnce(clientPrincipal);
    gateFixtures.ticket = {
      ticket_id: 'client-visible-ticket', assigned_to: null, entered_by: 'owner-1', client_id: 'client-1',
      board_id: 'board-1', assigned_team_id: null, contact_name_id: 'contact-1', attributes: {}
    };
    const blockingResult = {
      canDelete: false,
      code: 'DEPENDENCIES_EXIST',
      message: '1 time entry blocks deletion',
      dependencies: [{ type: 'time_entry', count: 1 }],
      alternatives: [{ action: 'archive' }]
    };
    validateDeletionMock.mockResolvedValueOnce(blockingResult);

    await expect(preCheckDeletion('ticket', 'client-visible-ticket')).resolves.toEqual(blockingResult);

    expect(getVisibilityMock).toHaveBeenCalledTimes(1);
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ ...clientPrincipal }), 'ticket', 'delete', expect.anything()
    );
    expect(validateDeletionMock).toHaveBeenCalledTimes(1);
  });

  it('preserves dependency blocking for an authorized ticket', async () => {
    getDeletionConfigMock.mockReturnValueOnce({ entityType: 'ticket', dependencies: [] });
    gateFixtures.ticket = {
      ticket_id: 'visible-ticket', assigned_to: null, entered_by: 'owner-1', client_id: 'client-1',
      board_id: 'board-1', assigned_team_id: null, contact_name_id: 'contact-1', attributes: {}
    };
    const blockingResult = {
      canDelete: false,
      code: 'DEPENDENCIES_EXIST',
      message: '1 time entry blocks deletion',
      dependencies: [{ type: 'time_entry', count: 1 }],
      alternatives: [{ action: 'archive' }]
    };
    validateDeletionMock.mockResolvedValueOnce(blockingResult);

    await expect(preCheckDeletion('ticket', 'visible-ticket')).resolves.toEqual(blockingResult);
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', tenant: 't1' }), 'ticket', 'delete', expect.anything());
    expect(validateDeletionMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed before dependency validation when ticket policy resolution fails', async () => {
    getDeletionConfigMock.mockReturnValueOnce({ entityType: 'ticket', dependencies: [] });
    gateFixtures.ticket = {
      ticket_id: 'policy-failure-ticket', assigned_to: null, entered_by: 'owner-1', client_id: 'client-1',
      board_id: 'board-1', assigned_team_id: null, contact_name_id: 'contact-1', attributes: {}
    };
    resolveBundleRulesMock.mockRejectedValueOnce(new Error('bundle policy database unavailable'));

    const result = await preCheckDeletion('ticket', 'policy-failure-ticket');

    expect(result).toMatchObject({ canDelete: false, code: 'PERMISSION_DENIED', dependencies: [], alternatives: [] });
    expect(validateDeletionMock).not.toHaveBeenCalled();
  });
});
