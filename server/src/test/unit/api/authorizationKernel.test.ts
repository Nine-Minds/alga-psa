import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuthorizationPrincipalSubject, isAuthorizedProjection, projectApiResourceRead, projectApiResourceReads } from 'server/src/lib/api/controllers/authorizationKernel';

const authorizeResourceMock = vi.fn();

vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: authorizeResourceMock,
  })),
}));

describe('api authorization kernel helper', () => {
  beforeEach(() => authorizeResourceMock.mockReset());

  it('normalizes user roles, teams, and api key into authorization subject', () => {
    const subject = buildAuthorizationPrincipalSubject(
      {
        tenant: 'tenant-1',
        user_id: 'user-1',
        user_type: 'internal',
        roles: [{ role_id: 'role-1' }, { role_id: 'role-2' }],
        role_ids: ['role-2', 'role-3'],
        teams: [{ team_id: 'team-1' }],
        team_ids: ['team-1', 'team-2'],
        managed_user_ids: ['managed-1'],
      },
      'api-key-1'
    );

    expect(subject).toMatchObject({
      tenant: 'tenant-1',
      userId: 'user-1',
      userType: 'internal',
      apiKeyId: 'api-key-1',
      roleIds: ['role-1', 'role-2', 'role-3'],
      teamIds: ['team-1', 'team-2'],
      managedUserIds: ['managed-1'],
      portfolioClientIds: [],
    });
  });

  it('preserves client and portfolio identifiers from snake_case and camelCase payloads', () => {
    const snakeCase = buildAuthorizationPrincipalSubject({
      tenant: 'tenant-1',
      user_id: 'user-1',
      user_type: 'client',
      client_id: 'client-snake',
      portfolio_client_ids: ['portfolio-a', 'portfolio-b'],
    });

    expect(snakeCase).toMatchObject({
      clientId: 'client-snake',
      portfolioClientIds: ['portfolio-a', 'portfolio-b'],
    });

    const camelCase = buildAuthorizationPrincipalSubject({
      tenant: 'tenant-1',
      user_id: 'user-2',
      user_type: 'client',
      clientId: 'client-camel',
      portfolioClientIds: ['portfolio-c'],
    });

    expect(camelCase).toMatchObject({
      clientId: 'client-camel',
      portfolioClientIds: ['portfolio-c'],
    });
  });

  const user = { user_id: 'user-1', user_type: 'internal' };
  const project = {
    project_id: 'p-1', project_name: 'Alpha', description: 'secret plan', budgeted_hours: 40,
    client_id: 'c-1', client_name: 'Acme', assigned_to: 'u-9', assigned_user_name: 'Pat Doe', status: 's-1',
  };
  const read = (redactedFields: string[], record: Record<string, any> = project, kind: 'project' | 'ticket' | 'quote' | 'asset' = 'project') => {
    authorizeResourceMock.mockResolvedValueOnce({ allowed: true, redactedFields });
    return projectApiResourceRead({ knex: {} as any, tenant: 'tenant-1', user, kind, record });
  };

  it('delegates to kernel authorizeResource once and returns null on deny', async () => {
    authorizeResourceMock.mockClear();
    authorizeResourceMock.mockResolvedValueOnce({ allowed: false, redactedFields: [] });
    const denied = await projectApiResourceRead({
      knex: {} as any, tenant: 'tenant-1', user, apiKeyId: 'api-key-1', kind: 'ticket',
      record: { ticket_id: 'ticket-1', entered_by: 'owner-1' },
    });

    expect(denied).toBeNull();
    expect(authorizeResourceMock).toHaveBeenCalledTimes(1);
    expect(authorizeResourceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.objectContaining({ tenant: 'tenant-1', userId: 'user-1', apiKeyId: 'api-key-1' }),
        resource: { type: 'ticket', action: 'read' },
        record: expect.objectContaining({ id: 'ticket-1', ownerUserId: 'owner-1' }),
      })
    );
  });

  it('returns a branded projection with no redaction applied when none is published', async () => {
    const projection = await read([]);
    expect(projection).toEqual(project);
    expect(isAuthorizedProjection(projection)).toBe(true);
    expect(isAuthorizedProjection({ ...project })).toBe(false);
    expect(JSON.parse(JSON.stringify(projection))).toEqual(project);
  });

  it('omits a field hidden by its direct name', async () => {
    const projection = await read(['budgeted_hours']);
    expect(projection).not.toHaveProperty('budgeted_hours');
    expect(projection).toHaveProperty('description', 'secret plan');
  });

  it.each(['projects.description', 'values.description', 'fields.description', 'fields.projects.description'])(
    'omits a field hidden by the %s alias without suppressing the row', async (alias) => {
      const projection = await read([alias]);
      expect(projection).not.toBeNull();
      expect(projection).not.toHaveProperty('description');
      expect(projection).toHaveProperty('project_name', 'Alpha');
    });

  it('hides everything (suppresses the row) for *', async () => {
    expect(await read(['*'])).toBeNull();
    expect(await read(['fields'])).toBeNull();
  });

  it('nulls a derived field when its source is hidden, and keeps the key', async () => {
    const projection = await read(['assigned_to']);
    expect(projection).not.toHaveProperty('assigned_to');
    expect(projection).toHaveProperty('assigned_user_name', null);
    const byName = await read(['clients']);
    expect(byName).toHaveProperty('client_name', null);
    expect(byName).toHaveProperty('project_name', 'Alpha');
  });

  it('suppresses the row when an identifier is hidden', async () => {
    expect(await read(['project_id'])).toBeNull();
    expect(await read(['projects.project_id'])).toBeNull();
  });

  it('suppresses the row when the whole resource is hidden', async () => {
    expect(await read(['projects'])).toBeNull();
    expect(await read(['fields.projects'])).toBeNull();
  });

  it('does not suppress on a field-level redaction such as projects.description', async () => {
    const projection = await read(['projects.description']);
    expect(projection).not.toBeNull();
    expect(projection).toHaveProperty('project_id', 'p-1');
  });

  it('projects tickets, quotes (including lines) and assets from their own descriptors', async () => {
    const ticket = await read(['status_id'], { ticket_id: 't-1', title: 'x', status_id: 's', status_name: 'Open', priority_name: 'High' }, 'ticket');
    expect(ticket).toEqual({ ticket_id: 't-1', title: 'x', status_name: null, priority_name: 'High' });

    const quote = await read(['tax', 'unit_price'], {
      quote_id: 'q-1', subtotal: 10, tax: 1, total_amount: 11,
      items: [{ quote_item_id: 'i-1', unit_price: 5, quantity: 2, total_price: 10, cost: 3 }],
    }, 'quote');
    expect(quote).toEqual({ quote_id: 'q-1', subtotal: 10, total_amount: null, items: [{ quote_item_id: 'i-1', quantity: 2, total_price: null, cost: 3 }] });
    expect(await read(['quotes'], { quote_id: 'q-1' }, 'quote')).toBeNull();

    // assets have no default record context: the caller must supply one
    await expect(projectApiResourceRead({ knex: {} as any, tenant: 'tenant-1', user, kind: 'asset', record: { asset_id: 'a-1' } })).rejects.toThrow(/recordContext/);
    authorizeResourceMock.mockResolvedValueOnce({ allowed: true, redactedFields: ['vendor_id'] });
    const assetProjection = await projectApiResourceRead({
      knex: {} as any, tenant: 'tenant-1', user, kind: 'asset', recordContext: { id: 'a-1' },
      record: { asset_id: 'a-1', vendor_id: 'v', vendor_name: 'Dell', name: 'PC' },
    });
    expect(assetProjection).toEqual({ asset_id: 'a-1', vendor_name: null, name: 'PC' });
  });

  it('batch form drops denied and suppressed rows and keeps order', async () => {
    authorizeResourceMock
      .mockResolvedValueOnce({ allowed: true, redactedFields: [] })
      .mockResolvedValueOnce({ allowed: false, redactedFields: [] })
      .mockResolvedValueOnce({ allowed: true, redactedFields: ['projects'] })
      .mockResolvedValueOnce({ allowed: true, redactedFields: ['description'] });
    const rows = await projectApiResourceReads({
      knex: {} as any, tenant: 'tenant-1', user, kind: 'project',
      records: [1, 2, 3, 4].map((n) => ({ project_id: `p-${n}`, description: 'd' })),
    });
    expect(rows).toEqual([{ project_id: 'p-1', description: 'd' }, { project_id: 'p-4' }]);
  });
});
