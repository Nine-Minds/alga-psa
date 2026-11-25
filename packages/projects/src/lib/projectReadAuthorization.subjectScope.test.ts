import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';

// Keep subject assembly, portfolio loading, and the authorization kernel real.
// Only stored rows and the bundle-rule query are supplied by the test.
vi.mock('@alga-psa/db', () => ({
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (table: string) => {
      const rows: Record<string, Record<string, string>[]> = {
        user_roles: [
          { tenant: 't1', user_id: 'u1', role_id: 'r1' },
          { tenant: 't2', user_id: 'u1', role_id: 'r2' },
          { tenant: 't1', user_id: 'other', role_id: 'other-role' },
        ],
        team_members: [
          { tenant: 't1', user_id: 'u1', team_id: 'team1' },
          { tenant: 't2', user_id: 'u1', team_id: 'team2' },
          { tenant: 't1', user_id: 'other', team_id: 'other-team' },
        ],
        users: [
          { tenant: 't1', reports_to: 'u1', user_id: 'report1' },
          { tenant: 't2', reports_to: 'u1', user_id: 'report2' },
          { tenant: 't1', reports_to: 'other', user_id: 'other-report' },
        ],
        user_client_portfolios: [
          { tenant: 't1', user_id: 'u1', client_id: 'c1' },
          { tenant: 't2', user_id: 'u1', client_id: 'c2' },
          { tenant: 't1', user_id: 'other', client_id: 'other-client' },
        ],
      };
      if (!(table in rows)) throw new Error(`Unexpected table: ${table}`);
      let selected = rows[table].filter((row) => row.tenant === tenant);
      const query = {
        where: (criteria: Record<string, string>) => {
          selected = selected.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
          return query;
        },
        orderBy: () => query,
        select: async () => selected,
      };
      return query;
    },
  }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(),
}));
vi.mock('../models/project', () => ({
  default: { getById: async (_conn: unknown, _tenant: string, projectId: string) => ({ project_id: projectId, client_id: 'c1' }) },
}));

import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { assertProjectReadAllowed, createProjectActionDecider, createProjectReadAuthorizer } from './projectReadAuthorization';

const user = { user_id: 'u1', user_type: 'internal', roles: [] } as unknown as IUserWithRoles;
const conn = {} as Knex;
const project = (id: string, clientId = 'c1') => ({ project_id: id, client_id: clientId });
const loadRules = vi.mocked(resolveBundleNarrowingRulesForEvaluation);

beforeEach(() => {
  loadRules.mockReset();
  loadRules.mockImplementation(async (_conn, { subject }) => [
    { id: 'portfolio', resource: 'project', action: 'read', templateKey: 'client_portfolio' },
    ...(subject.apiKeyId === 'restricted-key' ? [{
      id: 'key-scope', resource: 'project', action: 'read', templateKey: 'selected_records' as const,
      selectedRecordIds: ['allowed-project'],
    }] : []),
  ]);
});

describe('project authorization subject scope', () => {
  it.each(['t1', 't2'])('resolves memberships and portfolio for the requested user in %s', async (tenant) => {
    const suffix = tenant === 't1' ? '1' : '2';
    const decide = await createProjectActionDecider(conn, tenant, user);
    await expect(decide(project('p1', `c${suffix}`))).resolves.toMatchObject({ allowed: true });
    await expect(decide(project('p2', suffix === '1' ? 'c2' : 'c1'))).resolves.toMatchObject({ allowed: false });
    await expect(decide(project('p3', 'other-client'))).resolves.toMatchObject({ allowed: false });
    expect(loadRules).toHaveBeenCalledWith(conn, expect.objectContaining({
      subject: expect.objectContaining({
        tenant, userId: 'u1', roleIds: [`r${suffix}`], teamIds: [`team${suffix}`],
        managedUserIds: [`report${suffix}`], portfolioClientIds: [`c${suffix}`],
      }),
    }));
  });

  describe.each(['read', 'update', 'delete'] as const)('%s authorization', (action) => {
    it.each([undefined, 'open-key', 'restricted-key'])('applies the current API key scope (%s) in both helper forms', async (apiKeyId) => {
      const decide = await createProjectActionDecider(conn, 't1', user, action, apiKeyId);
      const authorize = await createProjectReadAuthorizer(conn, 't1', user, action, apiKeyId);
      for (const [id, allowed] of [['allowed-project', true], ['other-project', apiKeyId !== 'restricted-key']] as const) {
        await expect(decide(project(id))).resolves.toMatchObject({ allowed });
        await expect(authorize(project(id))).resolves.toBe(allowed);
      }
      // No API key can widen the user's own portfolio.
      await expect(decide(project('allowed-project', 'c2'))).resolves.toMatchObject({ allowed: false });
      await expect(authorize(project('allowed-project', 'c2'))).resolves.toBe(false);
    });
  });

  it('enforces the same key scope when loading and asserting a project read', async () => {
    await expect(assertProjectReadAllowed(conn, 't1', user, 'allowed-project', 'restricted-key'))
      .resolves.toEqual(project('allowed-project'));
    await expect(assertProjectReadAllowed(conn, 't1', user, 'other-project', 'restricted-key'))
      .rejects.toThrow('Permission denied: Cannot read project');
    await expect(assertProjectReadAllowed(conn, 't1', user, 'other-project', 'open-key'))
      .resolves.toEqual(project('other-project'));
    await expect(assertProjectReadAllowed(conn, 't1', user, 'other-project'))
      .resolves.toEqual(project('other-project'));
  });
});
