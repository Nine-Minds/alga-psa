import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: {} as any,
  bundleRules: [] as Array<Record<string, unknown>>,
  rejectBundleResolution: false,
  tickets: new Map<string, Record<string, unknown>>(),
  comments: new Map<string, Record<string, unknown>>(),
  candidateHits: [] as any[],
  tenantReads: [] as string[],
  policyResolutions: 0,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(state.user, { tenant: state.user.tenant }, ...args),
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    getUserRolesWithPermissions: async () => [{
      role_name: 'technician',
      msp: true,
      client: true,
      permissions: [{ resource: 'ticket', action: 'read', msp: true, client: true }],
    }],
  },
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => {
    state.policyResolutions += 1;
    if (state.rejectBundleResolution) throw new Error('bundle resolver unavailable');
    return state.bundleRules;
  },
}));

vi.mock('@alga-psa/tickets/lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: async (_trx: unknown, _tenant: string, contactId: string) => ({
    effectiveTicketScope: 'client',
    ticketScope: 'client',
    contactId,
    clientId: state.user.clientId,
    visibleBoardIds: null,
    isClientAdmin: false,
    visibilityGroupId: null,
  }),
}));

vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/tickets/lib/ticketRecordAuthorization')>()),
  applyTicketReadAuthorizationSql: () => ({ supported: false, reason: 'fixture exercises evaluator fallback' }),
}));

vi.mock('@alga-psa/db', () => {
  const makeQuery = (table: string, tenant: string) => {
    let criteria: Record<string, unknown> = {};
    let inCriteria: Record<string, unknown[]> = {};
    const builder: any = {
      whereRaw: () => builder,
      where: (value: any, right?: unknown) => {
        criteria = typeof value === 'string' ? { ...criteria, [value]: right } : { ...criteria, ...value };
        return builder;
      },
      whereIn: (column: string, values: unknown[]) => { inCriteria[column.split('.').at(-1)!] = values; return builder; },
      whereNull: () => builder,
      whereNotNull: () => builder,
      whereExists: () => builder,
      andWhere: () => builder,
      orWhere: () => builder,
      select: () => builder,
      toSQL: () => ({ sql: `select * from ${table} where tenant = ?`, bindings: [tenant] }),
    };
    const query: any = {
      where: (value: any, right?: unknown) => {
        criteria = typeof value === 'string' ? { ...criteria, [value]: right } : { ...criteria, ...value };
        return query;
      },
      whereNull: () => query,
      whereNotNull: () => query,
      whereIn: (column: string, values: unknown[]) => { inCriteria[column.split('.').at(-1)!] = values; return query; },
      whereRaw: () => query,
      whereExists: () => query,
      andWhere: () => query,
      select: () => query,
      first: async () => {
        if (table === 'tickets') {
          const id = criteria.ticket_id;
          state.tenantReads.push(tenant);
          return typeof id === 'string' ? state.tickets.get(`${tenant}:${id}`) : undefined;
        }
        if (table === 'comments') {
          const id = criteria.comment_id;
          if (typeof id !== 'string') return { audience: 'requester' };
          return state.comments.get(`${tenant}:${id}`);
        }
        return undefined;
      },
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(table.startsWith('tickets') && Array.isArray(inCriteria.ticket_id)
          ? inCriteria.ticket_id.map((id) => state.tickets.get(`${tenant}:${id}`)).filter(Boolean)
          : table.startsWith('comments') && Array.isArray(inCriteria.comment_id)
            ? inCriteria.comment_id.map((id) => {
              const comment = state.comments.get(`${tenant}:${id}`);
              return comment ? { comment_id: id, ...comment, audience: 'requester' } : undefined;
            }).filter(Boolean)
            : []).then(resolve, reject),
      toSQL: () => ({ sql: `select * from ${table} where tenant = ?`, bindings: [tenant] }),
    };
    Object.assign(builder, query);
    return query;
  };

  return {
    createTenantKnex: async () => ({ knex: { raw: () => ({}) } }),
    tenantDb: (_knex: unknown, tenant: string) => ({
      table: (table: string) => makeQuery(table, tenant),
      scoped: (table: string) => ({ tenant, builder: makeQuery(table, tenant) }),
      tenantJoin: (query: unknown) => query,
    }),
  };
});

vi.mock('@alga-psa/search/projectSearchAccess', () => ({
  withProjectSearchAccess: async (_knex: unknown, _tenant: string, _user: unknown, _auth: unknown, work: any) =>
    work({ raw: () => ({}) }, undefined),
}));

vi.mock('@alga-psa/search/query', () => ({
  runSearchQuery: async ({ limit, cursor, sort }: { limit: number; cursor?: string; sort?: 'relevance' | 'recent' }) => {
    const sorted = [...state.candidateHits].sort((left, right) => {
      if (sort === 'recent') {
        return right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id);
      }
      return right.score - left.score
        || right.updatedAt.getTime() - left.updatedAt.getTime()
        || left.id.localeCompare(right.id);
    });
    const decoded = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) : undefined;
    const remaining = decoded
      ? sorted.filter((candidate) => sort === 'recent'
        ? candidate.updatedAt.toISOString() < decoded.updatedAt
          || (candidate.updatedAt.toISOString() === decoded.updatedAt && candidate.id > decoded.objectId)
        : candidate.score < decoded.score
          || (candidate.score === decoded.score && candidate.updatedAt.toISOString() < decoded.updatedAt)
          || (candidate.score === decoded.score && candidate.updatedAt.toISOString() === decoded.updatedAt && candidate.id > decoded.objectId))
      : sorted;
    return remaining.slice(0, limit);
  },
  decodeSearchCursor: (cursor?: string) => cursor
    ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    : undefined,
  encodeSearchCursor: (hit: any, rankingAsOf?: string) => Buffer.from(JSON.stringify({
    score: hit.score,
    updatedAt: hit.updatedAt.toISOString(),
    objectId: hit.id,
    rankingAsOf,
  })).toString('base64url'),
}));

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));

import { searchAppAction, searchAppTypeaheadAction } from '../../lib/actions/searchActions';

const tenant = 'tenant-current';
const readableTicket = 'ticket-readable';
const excludedTicket = 'ticket-excluded';

function hit(type: 'ticket' | 'ticket_comment', id: string, title: string, parentId?: string, score = type === 'ticket' ? 1 : 0.9) {
  return {
    type,
    id,
    parentId,
    title,
    subtitle: `${title} client and number metadata`,
    snippet: `${title} protected comment excerpt`,
    url: `/msp/tickets/${parentId ?? id}`,
    score,
    updatedAt: new Date('2026-11-03T00:00:00.000Z'),
    metadata: { client: title, ticketNumber: title },
  };
}

function ticket(id: string, clientId: string) {
  return {
    ticket_id: id,
    assigned_to: null,
    entered_by: null,
    client_id: clientId,
    board_id: 'board-1',
    assigned_team_id: null,
    contact_name_id: null,
    billing_profile_id: null,
    attributes: {},
  };
}

async function runBothSearches() {
  return Promise.all([
    searchAppAction({ query: 'support', limit: 10 }),
    searchAppTypeaheadAction({ query: 'support' }),
  ]);
}

describe('search record authorization regression', () => {
  beforeEach(() => {
    state.user = {
      user_id: 'internal-user',
      user_type: 'internal',
      tenant,
      roles: [{ role_id: 'role-1' }],
    };
    state.bundleRules = [{
      id: 'selected-emerald',
      resource: 'ticket',
      action: 'read',
      templateKey: 'selected_clients',
      selectedClientIds: ['client-emerald'],
    }];
    state.rejectBundleResolution = false;
    state.tickets = new Map([
      [`${tenant}:${readableTicket}`, ticket(readableTicket, 'client-emerald')],
      [`${tenant}:${excludedTicket}`, ticket(excludedTicket, 'client-other')],
      [`tenant-other:foreign-tenant-ticket`, ticket('foreign-tenant-ticket', 'client-emerald')],
    ]);
    state.comments = new Map([
      [`${tenant}:comment-readable`, { ticket_id: readableTicket, is_internal: false }],
      [`${tenant}:comment-excluded`, { ticket_id: excludedTicket, is_internal: false }],
    ]);
    state.candidateHits = [
      hit('ticket', readableTicket, 'Emerald Remote Support'),
      hit('ticket_comment', 'comment-readable', 'Emerald technician reply', readableTicket),
      hit('ticket', excludedTicket, 'TIC001033 Remote support work'),
      hit('ticket_comment', 'comment-excluded', 'Excluded private comment', excludedTicket),
      hit('ticket', 'foreign-tenant-ticket', 'Foreign tenant record'),
    ];
    state.tenantReads = [];
    state.policyResolutions = 0;
  });

  it('filters selected-client ticket and comment candidates on full search and typeahead while retaining readable rows', async () => {
    const [full, typeahead] = await runBothSearches();

    for (const result of [full, typeahead]) {
      expect(result.results.map(({ id }) => id)).toEqual([
        readableTicket,
        'comment-readable',
      ]);
      expect(JSON.stringify(result)).not.toContain('TIC001033');
      expect(JSON.stringify(result)).not.toContain('client-other');
      expect(JSON.stringify(result)).not.toContain('comment-excluded');
      expect(JSON.stringify(result)).not.toContain('Excluded private comment');
      expect(JSON.stringify(result)).not.toContain('Foreign tenant record');
    }
    expect(full.totalCount).toBe(2);
    expect(full.groups.ticket).toBe(1);
    expect(full.groups.ticket_comment).toBe(1);
    expect(typeahead.totalCount).toBe(2);
    expect(full.results[0]).toMatchObject({
      title: 'Emerald Remote Support',
      subtitle: 'Emerald Remote Support client and number metadata',
      url: `/msp/tickets/${readableTicket}`,
    });
    expect(typeahead.results[0].title).toBe('Emerald Remote Support');
  });

  it('omits missing tickets, missing comment parents, and candidates when bundle resolution rejects', async () => {
    state.candidateHits = [
      hit('ticket', 'missing-ticket', 'Missing ticket title'),
      hit('ticket_comment', 'missing-parent-comment', 'Missing parent comment', 'missing-parent'),
    ];
    state.comments.set(`${tenant}:missing-parent-comment`, { ticket_id: 'missing-parent', is_internal: false });
    let [full, typeahead] = await runBothSearches();
    expect(full.results).toEqual([]);
    expect(typeahead.results).toEqual([]);

    state.candidateHits = [hit('ticket', excludedTicket, 'Forbidden only result')];
    [full, typeahead] = await runBothSearches();
    expect(full.results).toEqual([]);
    expect(full.totalCount).toBe(0);
    expect(full.groups.ticket).toBe(0);
    expect(typeahead.results).toEqual([]);
    expect(typeahead.totalCount).toBe(0);

    state.candidateHits = [hit('ticket', readableTicket, 'Resolver failure candidate')];
    state.rejectBundleResolution = true;
    [full, typeahead] = await runBothSearches();
    expect(full.results).toEqual([]);
    expect(typeahead.results).toEqual([]);
    expect(full.totalCount).toBe(0);
    expect(full.groups.ticket).toBe(0);
    expect(typeahead.totalCount).toBe(0);
  });

  it('returns later readable matches after an excluded first candidate window and counts only admitted rows', async () => {
    state.candidateHits = Array.from({ length: 102 }, (_, index) =>
      hit('ticket', `a-excluded-${String(index).padStart(3, '0')}`, `Excluded ${index}`, undefined, 1),
    );
    state.tickets.set(`${tenant}:z-readable-later`, ticket('z-readable-later', 'client-emerald'));
    state.candidateHits.push(hit('ticket', 'z-readable-later', 'Readable after first window', undefined, 1));

    const [full, typeahead] = await Promise.all([
      searchAppAction({ query: 'support', limit: 10 }),
      searchAppTypeaheadAction({ query: 'support' }),
    ]);
    expect(full.results.map(({ id }) => id)).toEqual(['z-readable-later']);
    expect(full.totalCount).toBe(1);
    expect(full.groups.ticket).toBe(1);
    expect(typeahead.results.map(({ id }) => id)).toEqual(['z-readable-later']);
    expect(typeahead.totalCount).toBe(1);
  });

  it('resolves ticket policy once and reuses it across candidate batches', async () => {
    state.candidateHits = Array.from({ length: 205 }, (_, index) =>
      hit('ticket', `not-loaded-${String(index).padStart(3, '0')}`, 'Missing policy candidate'),
    );

    const result = await searchAppAction({ query: 'support', limit: 5 });
    expect(result.results).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(state.policyResolutions).toBe(1);
  });

  it('applies cursors to admitted results and preserves counts across readable pages', async () => {
    state.candidateHits = [
      hit('ticket', 'a-readable-first', 'Readable first', undefined, 1),
      hit('ticket', 'b-excluded-middle', 'Excluded middle', undefined, 0.9),
      hit('ticket', 'c-readable-next', 'Readable next', undefined, 0.8),
    ];
    state.tickets.set(`${tenant}:a-readable-first`, ticket('a-readable-first', 'client-emerald'));
    state.tickets.set(`${tenant}:c-readable-next`, ticket('c-readable-next', 'client-emerald'));

    const first = await searchAppAction({ query: 'support', limit: 1 });
    expect(first.results.map(({ id }) => id)).toEqual(['a-readable-first']);
    expect(first.totalCount).toBe(2);
    expect(first.nextCursor).toBeTruthy();

    const second = await searchAppAction({ query: 'support', limit: 1, cursor: first.nextCursor });
    expect(second.results.map(({ id }) => id)).toEqual(['c-readable-next']);
    expect(second.totalCount).toBe(2);
    expect(second.nextCursor).toBeUndefined();
  });

  it('uses the authenticated tenant for ticket resolution and preserves client visibility policy', async () => {
    state.candidateHits = [
      hit('ticket', readableTicket, 'Emerald portal ticket'),
      hit('ticket', excludedTicket, 'Other client ticket'),
    ];
    state.user = {
      user_id: 'portal-user',
      user_type: 'client',
      tenant,
      clientId: 'client-emerald',
      contact_id: 'contact-1',
      roles: [{ role_id: 'portal-role' }],
    };

    const [full, typeahead] = await runBothSearches();
    expect(full.results.map(({ id }) => id)).toEqual([readableTicket]);
    expect(typeahead.results.map(({ id }) => id)).toEqual([readableTicket]);
    expect(state.tenantReads.every((readTenant) => readTenant === tenant)).toBe(true);
  });
});
