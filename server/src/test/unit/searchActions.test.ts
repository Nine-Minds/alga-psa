import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  resolveSearchAclPrincipal: vi.fn(),
  verifyResultVisibility: vi.fn(),
  runSearchQuery: vi.fn(),
  runSearchTypeaheadQuery: vi.fn(),
  encodeSearchCursor: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: unknown) => handler,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: mocks.loggerInfo,
  },
}));

vi.mock('../../lib/search/acl', () => ({
  resolveSearchAclPrincipal: mocks.resolveSearchAclPrincipal,
  verifyResultVisibility: mocks.verifyResultVisibility,
}));

vi.mock('../../lib/search/query', () => ({
  runSearchQuery: mocks.runSearchQuery,
  runSearchTypeaheadQuery: mocks.runSearchTypeaheadQuery,
  encodeSearchCursor: mocks.encodeSearchCursor,
}));

import {
  searchAppAction,
  searchAppInputSchema,
  searchAppResultSchema,
  searchAppTypeaheadAction,
} from '../../lib/actions/searchActions';

describe('search actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T153 emits search query count and latency telemetry for full search calls', async () => {
    const knex = { tenant: 'knex' };
    const acl = {
      userId: 'user-telemetry-1',
      tenant: 'tenant-1',
      permissions: ['client:read'],
      isInternal: true,
      accessibleClientIds: ['client-1'],
    };
    const hits = [{
      type: 'client',
      id: 'client-telemetry-1',
      title: 'ACME Corp',
      url: '/msp/clients/client-telemetry-1',
      score: 1,
      updatedAt: new Date('2026-05-13T12:00:00.000Z'),
      metadata: {},
    }];

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue(hits);
    mocks.verifyResultVisibility.mockResolvedValue(hits);

    await searchAppAction(
      {
        user_id: 'user-telemetry-1',
        tenant: 'tenant-1',
        user_type: 'client',
        clientId: 'client-1',
      },
      { tenant: 'tenant-1' },
      { query: 'acme', limit: 10 },
    );

    expect(mocks.loggerInfo).toHaveBeenCalledWith('[Search] metric', expect.objectContaining({
      metric: 'search.query.count',
      variant: 'full',
      tenant: 'tenant-1',
      userId: 'user-telemetry-1',
    }));
    expect(mocks.loggerInfo).toHaveBeenCalledWith('[Search] metric', expect.objectContaining({
      metric: 'search.query.latency_ms',
      variant: 'full',
      tenant: 'tenant-1',
      userId: 'user-telemetry-1',
      value: expect.any(Number),
    }));
  });

  it('T154 emits search.query.empty when a full search returns zero visible results', async () => {
    const knex = { tenant: 'knex' };
    const acl = {
      userId: 'user-telemetry-empty',
      tenant: 'tenant-1',
      permissions: ['client:read'],
      isInternal: true,
      accessibleClientIds: ['client-1'],
    };

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue([]);
    mocks.verifyResultVisibility.mockResolvedValue([]);

    await searchAppAction(
      {
        user_id: 'user-telemetry-empty',
        tenant: 'tenant-1',
        user_type: 'client',
        clientId: 'client-1',
      },
      { tenant: 'tenant-1' },
      { query: 'missing', limit: 10 },
    );

    expect(mocks.loggerInfo).toHaveBeenCalledWith('[Search] metric', expect.objectContaining({
      metric: 'search.query.empty',
      variant: 'full',
      tenant: 'tenant-1',
      userId: 'user-telemetry-empty',
    }));
  });

  it('T106 resolves the user permission set exactly once per full search action call', async () => {
    const knex = { tenant: 'knex' };
    const acl = {
      userId: 'user-1',
      tenant: 'tenant-1',
      permissions: ['client:read'],
      roles: ['technician'],
      isInternal: true,
      accessibleClientIds: ['client-1'],
    };
    const hits = [{
      type: 'client',
      id: 'client-1',
      title: 'ACME Corp',
      url: '/msp/clients/client-1',
      score: 1,
      updatedAt: new Date('2026-05-13T12:00:00.000Z'),
      metadata: {},
    }];

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue(hits);
    mocks.verifyResultVisibility.mockResolvedValue(hits);

    await searchAppAction(
      {
        user_id: 'user-1',
        tenant: 'tenant-1',
        user_type: 'client',
        clientId: 'client-1',
      },
      { tenant: 'tenant-1' },
      { query: 'acme', limit: 10 },
    );

    expect(mocks.resolveSearchAclPrincipal).toHaveBeenCalledTimes(1);
    expect(mocks.resolveSearchAclPrincipal).toHaveBeenCalledWith(knex, expect.any(Object), ['client-1']);
    expect(mocks.runSearchQuery).toHaveBeenCalledWith(expect.objectContaining({ acl }));
    expect(mocks.verifyResultVisibility).toHaveBeenCalledWith(knex, acl, hits);
  });

  it('T115 returns grouped counts per object type', async () => {
    const knex = { tenant: 'knex' };
    const acl = {
      userId: 'user-2',
      tenant: 'tenant-1',
      permissions: ['client:read', 'ticket:read'],
      isInternal: true,
      accessibleClientIds: ['client-1'],
    };
    const hits = [
      {
        type: 'client',
        id: 'client-1',
        title: 'ACME Corp',
        url: '/msp/clients/client-1',
        score: 1,
        updatedAt: new Date('2026-05-13T12:00:00.000Z'),
        metadata: {},
      },
      {
        type: 'ticket',
        id: 'ticket-1',
        title: 'Cannot access VPN',
        url: '/msp/tickets/ticket-1',
        score: 0.9,
        updatedAt: new Date('2026-05-13T12:00:00.000Z'),
        metadata: {},
      },
      {
        type: 'ticket',
        id: 'ticket-2',
        title: 'Printer offline',
        url: '/msp/tickets/ticket-2',
        score: 0.8,
        updatedAt: new Date('2026-05-13T12:00:00.000Z'),
        metadata: {},
      },
    ];

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue(hits);
    mocks.verifyResultVisibility.mockResolvedValue(hits);

    const result = await searchAppAction(
      {
        user_id: 'user-2',
        tenant: 'tenant-1',
        user_type: 'client',
        clientId: 'client-1',
      },
      { tenant: 'tenant-1' },
      { query: 'acme', limit: 10 },
    );

    expect(result.totalCount).toBe(3);
    expect(result.groups.client).toBe(1);
    expect(result.groups.ticket).toBe(2);
    expect(result.groups.document).toBe(0);
  });

  it('T116 exports searchAppAction through withAuth', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/actions/searchActions.ts'), 'utf8');

    expect(source).toContain('export const searchAppAction = withAuth(async (');
  });

  it('T117 passes the authenticated tenant into the search query for tenant isolation', async () => {
    const knex = { tenant: 'knex' };
    const acl = {
      userId: 'user-3',
      tenant: 'tenant-a',
      permissions: ['client:read'],
      isInternal: true,
      accessibleClientIds: ['client-1'],
    };

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-a' });
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchQuery.mockResolvedValue([]);
    mocks.verifyResultVisibility.mockResolvedValue([]);

    await searchAppAction(
      {
        user_id: 'user-3',
        tenant: 'tenant-a',
        user_type: 'client',
        clientId: 'client-1',
      },
      { tenant: 'tenant-a' },
      { query: 'acme', limit: 10 },
    );

    expect(mocks.runSearchQuery).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-a',
    }));
    expect(mocks.runSearchQuery).not.toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-b',
    }));
  });

  it('T118 returns at most five typeahead rows without snippets', async () => {
    const knex = { tenant: 'knex' };
    const acl = {
      userId: 'user-4',
      tenant: 'tenant-1',
      permissions: ['client:read'],
      isInternal: true,
      accessibleClientIds: ['client-1'],
    };
    const hits = Array.from({ length: 6 }, (_, index) => ({
      type: 'client',
      id: `client-${index}`,
      title: `Client ${index}`,
      url: `/msp/clients/client-${index}`,
      score: 1 - index / 10,
      updatedAt: new Date('2026-05-13T12:00:00.000Z'),
      metadata: {},
      snippet: '<mark>Client</mark>',
    }));

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchTypeaheadQuery.mockResolvedValue(hits);
    mocks.verifyResultVisibility.mockResolvedValue(hits);

    const result = await searchAppTypeaheadAction(
      {
        user_id: 'user-4',
        tenant: 'tenant-1',
        user_type: 'client',
        clientId: 'client-1',
      },
      { tenant: 'tenant-1' },
      { query: 'acme' },
    );

    expect(result.results).toHaveLength(5);
    expect(result.totalCount).toBe(6);
    expect(result.results.every((row) => row.snippet === undefined)).toBe(true);
    expect(mocks.runSearchTypeaheadQuery).toHaveBeenCalledWith(expect.objectContaining({ acl }));
  });

  it('T119 keeps mocked typeahead action overhead below 100ms', async () => {
    const knex = { tenant: 'knex' };
    const acl = {
      userId: 'user-5',
      tenant: 'tenant-1',
      permissions: ['client:read'],
      isInternal: true,
      accessibleClientIds: ['client-1'],
    };

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.resolveSearchAclPrincipal.mockResolvedValue(acl);
    mocks.runSearchTypeaheadQuery.mockResolvedValue([]);
    mocks.verifyResultVisibility.mockResolvedValue([]);

    const startedAt = performance.now();
    await searchAppTypeaheadAction(
      {
        user_id: 'user-5',
        tenant: 'tenant-1',
        user_type: 'client',
        clientId: 'client-1',
      },
      { tenant: 'tenant-1' },
      { query: 'acme' },
    );
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(100);
  });

  it('T120 rejects invalid search action input', () => {
    expect(searchAppInputSchema.safeParse({ query: '' }).success).toBe(false);
    expect(searchAppInputSchema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
    expect(searchAppInputSchema.safeParse({ query: 'acme', types: ['not_a_type'] }).success).toBe(false);
    expect(searchAppInputSchema.safeParse({ query: 'acme', limit: 101 }).success).toBe(false);
  });

  it('T121 requires a non-empty url on every result row', () => {
    const groups = Object.fromEntries(
      [
        'client', 'contact', 'user', 'ticket', 'ticket_comment', 'project', 'project_phase',
        'project_task', 'project_task_comment', 'asset', 'invoice', 'invoice_item',
        'invoice_annotation', 'contract', 'client_contract', 'document', 'kb_article',
        'service_catalog', 'service_request_submission', 'service_request_definition',
        'workflow_task', 'interaction', 'schedule_entry', 'time_entry', 'board', 'category',
        'tag',
      ].map((type) => [type, 0]),
    );

    expect(searchAppResultSchema.safeParse({
      results: [{
        type: 'client',
        id: 'client-1',
        title: 'ACME Corp',
        url: '',
        score: 1,
        updatedAt: '2026-05-13T12:00:00.000Z',
      }],
      groups,
      totalCount: 1,
    }).success).toBe(false);
  });
});
