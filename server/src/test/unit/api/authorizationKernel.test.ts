import { describe, expect, it, vi } from 'vitest';
import { buildAuthorizationPrincipalSubject, authorizeApiResourceRead } from 'server/src/lib/api/controllers/authorizationKernel';

const authorizeResourceMock = vi.fn();

vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: authorizeResourceMock,
  })),
}));

describe('api authorization kernel helper', () => {
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

    expect(denied).toBe(false);
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

    authorizeResourceMock.mockResolvedValueOnce({ allowed: true });
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

    expect(allowed).toBe(true);
  });
});
