import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuthorizationPrincipalSubject, authorizeApiResourceRead, authorizeApiResource } from 'server/src/lib/api/controllers/authorizationKernel';

const authorizeResourceMock = vi.fn();
const authorizeMutationMock = vi.fn();
const resolveSubjectMock = vi.hoisted(() => vi.fn());

vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: authorizeResourceMock,
    authorizeMutation: authorizeMutationMock,
  })),
}));

vi.mock('@alga-psa/authorization/subject', async (original) => ({
  ...await original<typeof import('@alga-psa/authorization/subject')>(),
  resolveAuthorizationSubject: (...args: unknown[]) => resolveSubjectMock(...args),
}));

describe('api authorization kernel helper', () => {
  beforeEach(() => {
    resolveSubjectMock.mockImplementation(async (_knex, { tenant, user, apiKeyId }) => ({
      tenant,
      userId: user.user_id,
      userType: 'internal',
      roleIds: [],
      teamIds: [],
      managedUserIds: [],
      portfolioClientIds: [],
      ...(apiKeyId ? { apiKeyId } : {}),
    }));
  });

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

  it('preserves client identifiers from snake_case and camelCase payloads; the portfolio comes from loaded facts, not the payload', () => {
    const snakeCase = buildAuthorizationPrincipalSubject(
      {
        tenant: 'tenant-1',
        user_id: 'user-1',
        user_type: 'internal',
        client_id: 'client-snake',
        portfolio_client_ids: ['ignored-payload-portfolio'],
      },
      undefined,
      ['portfolio-a', 'portfolio-b']
    );

    expect(snakeCase).toMatchObject({
      clientId: 'client-snake',
      portfolioClientIds: ['portfolio-a', 'portfolio-b', 'client-snake'],
    });

    const camelCase = buildAuthorizationPrincipalSubject({
      tenant: 'tenant-1',
      user_id: 'user-2',
      user_type: 'client',
      clientId: 'client-camel',
      portfolioClientIds: ['ignored-payload-portfolio'],
    });

    // A client user's own client is always in their portfolio; nothing else is read off the payload.
    expect(camelCase).toMatchObject({
      clientId: 'client-camel',
      portfolioClientIds: ['client-camel'],
    });
  });

  it('delegates to shared kernel authorizeResource and returns allow/deny', async () => {
    authorizeResourceMock.mockResolvedValueOnce({ allowed: false });
    const denied = await authorizeApiResourceRead({
      knex: {} as any,
      tenant: 'tenant-1',
      user: {
        user_id: 'user-1',
        user_type: 'internal',
      },
      apiKeyId: 'api-key-1',
      resource: 'ticket',
      recordContext: {
        id: 'ticket-1',
        ownerUserId: 'owner-1',
      },
    });

    expect(denied).toEqual({ allowed: false, redactedFields: [] });
    expect(authorizeResourceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.objectContaining({
          tenant: 'tenant-1',
          userId: 'user-1',
          apiKeyId: 'api-key-1',
        }),
        resource: { type: 'ticket', action: 'read' },
        record: expect.objectContaining({ id: 'ticket-1' }),
      })
    );

    authorizeResourceMock.mockResolvedValueOnce({ allowed: true, redactedFields: ['description'] });
    const allowed = await authorizeApiResourceRead({
      knex: {} as any,
      tenant: 'tenant-1',
      user: {
        user_id: 'user-1',
        user_type: 'internal',
      },
      resource: 'project',
      recordContext: {
        id: 'project-1',
      },
    });

    expect(allowed).toEqual({ allowed: true, redactedFields: ['description'] });
  });

  it('sends writes to the kernel mutation decision with their own action, and reads to the resource decision', async () => {
    authorizeResourceMock.mockReset();
    authorizeMutationMock.mockReset();
    authorizeResourceMock.mockResolvedValue({ allowed: false, redactedFields: [] });
    authorizeMutationMock.mockImplementation(async ({ resource }: { resource: { action: string } }) => ({
      allowed: resource.action === 'update',
    }));
    const base = { knex: {} as any, tenant: 't1', user: { user_id: 'u1' }, resource: 'ticket', recordContext: { id: 'r1' } };

    const updateAllowed = await authorizeApiResource({ ...base, action: 'update' });
    const deleteAllowed = await authorizeApiResource({ ...base, action: 'delete' });
    const readAllowed = await authorizeApiResourceRead(base);

    expect(updateAllowed).toBe(true);
    expect(deleteAllowed).toBe(false);
    expect(readAllowed.allowed).toBe(false);
    // The mutation decision is where the kernel requires read before update and delete.
    expect(authorizeMutationMock.mock.calls.map((c) => c[0].resource.action)).toEqual(['update', 'delete']);
    expect(authorizeResourceMock.mock.calls.map((c) => c[0].resource.action)).toEqual(['read']);
  });

  it('API-key and session principals reach the kernel with the same resource/action', async () => {
    authorizeMutationMock.mockReset();
    authorizeMutationMock.mockResolvedValue({ allowed: false });
    const base = { knex: {} as any, tenant: 't1', user: { user_id: 'u1' }, resource: 'ticket', action: 'update', recordContext: { id: 'r1' } };

    const viaKey = await authorizeApiResource({ ...base, apiKeyId: 'k1' });
    const viaSession = await authorizeApiResource(base);

    expect(viaKey).toBe(viaSession);
    const [a, b] = authorizeMutationMock.mock.calls.map((c) => c[0]);
    expect(a.resource).toEqual(b.resource);
    expect(a.subject.apiKeyId).toBe('k1');
    expect(b.subject.apiKeyId).toBeUndefined();
  });
});

describe('authorizeApiResourceAction', () => {
  it('asks the kernel for the requested action, and authorizeApiResourceRead delegates with read', async () => {
    const { vi: v } = await import('vitest');
    const authorizeResource = v.fn(async () => ({ allowed: true }));
    const authorizeMutation = v.fn(async () => ({ allowed: true }));
    v.doMock('server/src/lib/authorization/kernel', () => ({
      getAuthorizationKernel: async () => ({ authorizeResource, authorizeMutation }),
    }));
    v.doMock('@alga-psa/authorization/subject', async () => ({
      ...(await vi.importActual<typeof import('@alga-psa/authorization/subject')>('@alga-psa/authorization/subject')),
      resolveAuthorizationSubject: async (_knex: unknown, { tenant, user, apiKeyId }: any) => ({
        tenant,
        userId: user.user_id,
        userType: user.user_type,
        roleIds: user.role_ids ?? [],
        teamIds: [],
        managedUserIds: [],
        portfolioClientIds: [],
        ...(apiKeyId ? { apiKeyId } : {}),
      }),
    }));
    v.resetModules();
    const mod = await import('../../../lib/api/controllers/authorizationKernel');
    const base = { knex: {} as any, tenant: 't', user: { user_id: 'u' }, resource: 'ticket', recordContext: { id: 'x' } as any };
    await mod.authorizeApiResourceAction({ ...base, action: 'update' });
    await mod.authorizeApiResourceRead(base);
    expect((authorizeMutation.mock.calls as any[]).map(([a]) => a.resource)).toEqual([
      { type: 'ticket', action: 'update' },
    ]);
    expect((authorizeResource.mock.calls as any[]).map(([a]) => a.resource)).toEqual([
      { type: 'ticket', action: 'read' },
    ]);
    v.doUnmock('server/src/lib/authorization/kernel');
    v.doUnmock('@alga-psa/authorization/subject');
  });
});
