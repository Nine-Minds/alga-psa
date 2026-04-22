import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

type KnexMock = ((tableName: string) => {
  where: (clause: Row) => any;
  orderBy: (_column: string, _direction?: string) => any;
  limit: (_count: number) => any;
  select: (...columns: string[]) => Promise<Row[]>;
  first: (...columns: string[]) => Promise<Row | undefined>;
}) & {
  __calls: {
    table: string;
    where: Row[];
  }[];
};

const authContext = {
  tenant: 'tenant-sim',
  actingUserId: 'actor-user',
};

const revisionContext = {
  draftRevisionId: 'draft-revision-id',
  publishedRevisionId: 'published-revision-id',
};

const serviceMocks = vi.hoisted(() => ({
  ensureDraftBundleRevision: vi.fn(async () => ({ revisionId: revisionContext.draftRevisionId })),
  listBundleRulesForRevision: vi.fn(async (_knex: unknown, input: { revisionId: string }) => {
    if (input.revisionId === revisionContext.draftRevisionId) {
      return [
        {
          ruleId: 'draft-rule',
          resourceType: 'ticket',
          action: 'read',
          templateKey: 'assigned',
          constraintKey: null,
          config: {},
          position: 0,
        },
      ];
    }

    return [
      {
        ruleId: 'published-rule',
        resourceType: 'ticket',
        action: 'read',
        templateKey: 'own',
        constraintKey: null,
        config: {},
        position: 0,
      },
    ];
  }),
  archiveBundle: vi.fn(),
  cloneAuthorizationBundle: vi.fn(),
  createBundleAssignment: vi.fn(),
  deleteBundleRule: vi.fn(),
  createAuthorizationBundle: vi.fn(),
  listAuthorizationBundles: vi.fn(async () => []),
  publishBundleRevision: vi.fn(),
  setBundleAssignmentStatus: vi.fn(),
  upsertBundleRule: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(async () => ({ knex: null as unknown as KnexMock, tenant: authContext.tenant })),
}));

const assertTierAccessMock = vi.hoisted(() => vi.fn(async () => undefined));
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));

function pickColumns(row: Row | undefined, columns: string[]): Row | undefined {
  if (!row) {
    return undefined;
  }
  if (columns.length === 0) {
    return row;
  }
  const picked: Row = {};
  for (const column of columns) {
    picked[column] = row[column];
  }
  return picked;
}

function buildKnexMock(input: {
  principal: Row;
  ticket: Row;
  quote?: Row;
  document?: Row;
  bundle: Row;
  principalOptions: Row[];
}): KnexMock {
  const calls: Array<{ table: string; where: Row[] }> = [];

  const knex = ((tableName: string) => {
    const state = {
      table: tableName,
      whereClauses: [] as Row[],
    };
    calls.push({ table: tableName, where: state.whereClauses });

    const builder = {
      where(clause: Row) {
        state.whereClauses.push(clause);
        return builder;
      },
      orderBy(_column: string, _direction?: string) {
        return builder;
      },
      limit(_count: number) {
        return builder;
      },
      async select(...columns: string[]) {
        if (state.table === 'users') {
          if (state.whereClauses.some((clause) => 'reports_to' in clause)) {
            return [];
          }
          return input.principalOptions
            .filter((row) => state.whereClauses.every((clause) => Object.entries(clause).every(([key, value]) => row[key] === value)))
            .map((row) => pickColumns(row, columns) as Row);
        }

        if (state.table === 'tickets') {
          return [pickColumns(input.ticket, columns) as Row];
        }

        if (state.table === 'quotes') {
          return input.quote ? [pickColumns(input.quote, columns) as Row] : [];
        }

        if (state.table === 'documents') {
          return input.document ? [pickColumns(input.document, columns) as Row] : [];
        }

        return [];
      },
      async first(...columns: string[]) {
        if (state.table === 'users') {
          if (state.whereClauses.some((clause) => 'reports_to' in clause)) {
            return undefined;
          }
          const row = state.whereClauses.some((clause) => 'user_id' in clause)
            ? input.principal
            : input.principalOptions[0];
          return pickColumns(row, columns);
        }

        if (state.table === 'user_roles' || state.table === 'team_members') {
          return undefined;
        }

        if (state.table === 'authorization_bundles') {
          return pickColumns(input.bundle, columns);
        }

        if (state.table === 'tickets') {
          return pickColumns(input.ticket, columns);
        }

        if (state.table === 'quotes') {
          return pickColumns(input.quote, columns);
        }

        if (state.table === 'documents') {
          return pickColumns(input.document, columns);
        }

        return undefined;
      },
    };

    return builder;
  }) as KnexMock;

  knex.__calls = calls;
  return knex;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: (...args: any[]) => unknown) =>
    async (...args: any[]) =>
      handler(
        {
          user_id: authContext.actingUserId,
          tenant: authContext.tenant,
          roles: [{ role_name: 'Admin' }],
        },
        { tenant: authContext.tenant },
        ...args
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: (...args: unknown[]) => assertTierAccessMock(...args),
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: (...args: unknown[]) => dbMocks.createTenantKnex(...args),
}));

vi.mock('server/src/lib/authorization/bundles/service', () => ({
  archiveBundle: serviceMocks.archiveBundle,
  cloneAuthorizationBundle: serviceMocks.cloneAuthorizationBundle,
  createBundleAssignment: serviceMocks.createBundleAssignment,
  deleteBundleRule: serviceMocks.deleteBundleRule,
  createAuthorizationBundle: serviceMocks.createAuthorizationBundle,
  ensureDraftBundleRevision: serviceMocks.ensureDraftBundleRevision,
  listBundleRulesForRevision: serviceMocks.listBundleRulesForRevision,
  listAuthorizationBundles: serviceMocks.listAuthorizationBundles,
  publishBundleRevision: serviceMocks.publishBundleRevision,
  setBundleAssignmentStatus: serviceMocks.setBundleAssignmentStatus,
  upsertBundleRule: serviceMocks.upsertBundleRule,
}));

import {
  listAuthorizationBundlesAction,
  listAuthorizationSimulationPrincipalsAction,
  listAuthorizationSimulationRecordsAction,
  runAuthorizationBundleSimulationAction,
} from '../../../../../ee/server/src/lib/actions/auth/authorizationBundleActions';

describe('runAuthorizationBundleSimulationAction', () => {
  const principalUserId = 'principal-user';
  const ticketId = 'ticket-1';
  const quoteId = 'quote-1';
  const documentId = 'document-1';

  beforeEach(() => {
    const knex = buildKnexMock({
      principal: {
        user_id: principalUserId,
        user_type: 'internal',
        client_id: null,
      },
      principalOptions: [
        {
          user_id: principalUserId,
          first_name: 'Sim',
          last_name: 'User',
          username: 'sim-user',
          email: 'sim@example.com',
          tenant: authContext.tenant,
        },
      ],
      ticket: {
        ticket_id: ticketId,
        user_id: principalUserId,
        title: 'Ticket 1',
        tenant: authContext.tenant,
      },
      quote: {
        quote_id: quoteId,
        quote_number: 'Q-1001',
        created_by: principalUserId,
        client_id: 'client-1',
        tenant: authContext.tenant,
      },
      document: {
        document_id: documentId,
        document_name: 'Doc 1',
        created_by: 'another-user',
        client_id: 'client-1',
        is_client_visible: false,
        tenant: authContext.tenant,
      },
      bundle: {
        published_revision_id: revisionContext.publishedRevisionId,
      },
    });

    dbMocks.createTenantKnex.mockResolvedValue({
      knex,
      tenant: authContext.tenant,
    });

    serviceMocks.ensureDraftBundleRevision.mockClear();
    serviceMocks.listBundleRulesForRevision.mockClear();
    serviceMocks.listAuthorizationBundles.mockClear();
    assertTierAccessMock.mockReset();
    assertTierAccessMock.mockResolvedValue(undefined);
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
  });

  it('denies bundle-management actions when tier access is not entitled', async () => {
    assertTierAccessMock.mockRejectedValueOnce(new Error('Tier access denied'));

    await expect(listAuthorizationBundlesAction()).rejects.toThrow('Tier access denied');
    expect(serviceMocks.listAuthorizationBundles).not.toHaveBeenCalled();
  });

  it('evaluates real principal + persisted record and returns draft-vs-published explainability', async () => {
    const principalOptions = await listAuthorizationSimulationPrincipalsAction();
    expect(principalOptions).toEqual([{ id: principalUserId, label: 'Sim User' }]);

    const recordOptions = await listAuthorizationSimulationRecordsAction({ resourceType: 'ticket' });
    expect(recordOptions).toEqual([{ id: ticketId, label: 'Ticket 1' }]);

    const result = await runAuthorizationBundleSimulationAction({
      bundleId: 'bundle-1',
      principalUserId,
      resourceType: 'ticket',
      action: 'read',
      resourceId: ticketId,
    });

    expect(result.published.allowed).toBe(true);
    expect(result.draft.allowed).toBe(false);
    expect(result.published.reasonCodes).toContain('rbac:rbac_allowed');
    expect(result.published.reasonCodes).toContain('bundle:bundle_narrowing_applied');
    expect(result.draft.reasonCodes).toContain('rbac:rbac_allowed');
    expect(result.draft.reasonCodes).toContain('bundle:bundle_template_denied');
    expect(serviceMocks.listBundleRulesForRevision).toHaveBeenCalledTimes(2);
  });

  it('supports synthetic scenarios without a persisted resource lookup', async () => {
    const result = await runAuthorizationBundleSimulationAction({
      bundleId: 'bundle-1',
      principalUserId,
      resourceType: 'ticket',
      action: 'read',
      syntheticRecord: {
        ownerUserId: principalUserId,
        clientId: null,
        boardId: null,
        isClientVisible: true,
      },
    });

    expect(result.published.allowed).toBe(true);
    expect(result.draft.allowed).toBe(false);
    expect(result.published.reasonCodes).toContain('rbac:rbac_allowed');
    expect(result.draft.reasonCodes).toContain('bundle:bundle_template_denied');
  });

  it('does not create draft revisions during simulation for read-only users', async () => {
    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => {
      if (resource === 'system_settings' && action === 'write') {
        return false;
      }
      if (resource === 'system_settings' && action === 'read') {
        return true;
      }
      return true;
    });

    const result = await runAuthorizationBundleSimulationAction({
      bundleId: 'bundle-1',
      principalUserId,
      resourceType: 'ticket',
      action: 'read',
      resourceId: ticketId,
    });

    expect(result.published.allowed).toBe(true);
    expect(result.draft.allowed).toBe(true);
    expect(serviceMocks.ensureDraftBundleRevision).not.toHaveBeenCalled();
  });

  it('loads billing simulation records from quotes and honors approve self-approval guard', async () => {
    const recordOptions = await listAuthorizationSimulationRecordsAction({ resourceType: 'billing' });
    expect(recordOptions).toEqual([{ id: quoteId, label: 'Q-1001' }]);

    const result = await runAuthorizationBundleSimulationAction({
      bundleId: 'bundle-1',
      principalUserId,
      resourceType: 'billing',
      action: 'approve',
      resourceId: quoteId,
    });

    expect(result.published.allowed).toBe(false);
    expect(result.draft.allowed).toBe(false);
    expect(result.published.reasonCodes).toContain('mutation:billing_not_self_approver_denied');
    expect(result.draft.reasonCodes).toContain('mutation:billing_not_self_approver_denied');
  });

  it('applies document client-visibility invariant and rejects unsupported simulator actions', async () => {
    const clientPrincipalId = 'client-principal';
    const knex = buildKnexMock({
      principal: {
        user_id: clientPrincipalId,
        user_type: 'client',
        client_id: 'client-1',
      },
      principalOptions: [
        {
          user_id: clientPrincipalId,
          first_name: 'Client',
          last_name: 'Principal',
          username: 'client-principal',
          email: 'client@example.com',
          tenant: authContext.tenant,
        },
      ],
      ticket: {
        ticket_id: ticketId,
        user_id: principalUserId,
        title: 'Ticket 1',
        tenant: authContext.tenant,
      },
      document: {
        document_id: documentId,
        document_name: 'Doc 1',
        created_by: 'another-user',
        client_id: 'client-1',
        is_client_visible: false,
        tenant: authContext.tenant,
      },
      bundle: {
        published_revision_id: revisionContext.publishedRevisionId,
      },
    });

    dbMocks.createTenantKnex.mockResolvedValue({
      knex,
      tenant: authContext.tenant,
    });

    const documentDecision = await runAuthorizationBundleSimulationAction({
      bundleId: 'bundle-1',
      principalUserId: clientPrincipalId,
      resourceType: 'document',
      action: 'read',
      resourceId: documentId,
    });

    expect(documentDecision.published.allowed).toBe(false);
    expect(documentDecision.published.reasonCodes).toContain('builtin:document_client_visibility_denied');

    await expect(
      runAuthorizationBundleSimulationAction({
        bundleId: 'bundle-1',
        principalUserId,
        resourceType: 'ticket',
        action: 'delete',
        resourceId: ticketId,
      })
    ).rejects.toThrow('Simulator only supports read/approve actions');
  });
});
