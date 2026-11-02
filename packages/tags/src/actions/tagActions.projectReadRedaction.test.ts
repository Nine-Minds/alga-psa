import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const mappings = [
    { mapping_id: 'hidden-map', tag_id: 'hidden-tag', tag_text: 'Wonderland Expansion', tagged_id: 'project-hidden', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'visible-map', tag_id: 'visible-tag', tag_text: 'Visible tag', tagged_id: 'project-visible', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'denied-map', tag_id: 'denied-tag', tag_text: 'Denied project tag', tagged_id: 'project-denied', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'ticket-map', tag_id: 'ticket-tag', tag_text: 'Ticket tag', tagged_id: 'ticket-1', tagged_type: 'ticket', tenant: 'tenant-1' },
  ];
  const definitions = [
    { tag_id: 'hidden-tag', tag_text: 'Wonderland Expansion', tagged_type: 'project', created_at: '2026-01-01' },
    { tag_id: 'visible-tag', tag_text: 'Visible tag', tagged_type: 'project', created_at: '2026-01-02' },
    { tag_id: 'denied-tag', tag_text: 'Denied project tag', tagged_type: 'project', created_at: '2026-01-03' },
    { tag_id: 'ticket-tag', tag_text: 'Ticket tag', tagged_type: 'ticket', created_at: '2026-01-04' },
  ];
  const projectAuthorization = vi.fn(async (_trx: unknown, _tenant: string, _user: unknown, ids: string[]) => ids.map((id) => ({
    project: { project_id: id }, allowed: id !== 'project-denied', redactedFields: id === 'project-hidden' ? ['tags'] : [],
  })));
  const tagMappingByEntity = vi.fn(async (_trx: unknown, _tenant: string, id: string) => mappings.filter((tag) => tag.tagged_id === id));
  const tagMappingByEntities = vi.fn(async (_trx: unknown, _tenant: string, ids: string[], type: string) => mappings.filter((tag) => ids.includes(tag.tagged_id) && tag.tagged_type === type));
  return { mappings, definitions, projectAuthorization, tagMappingByEntity, tagMappingByEntities };
});

function query(table: string): any {
  let whereInValues: unknown[] | undefined;
  let taggedType: unknown;
  const rows = () => {
    if (table === 'tag_mappings as tm') return fixture.mappings;
    if (table === 'tag_definitions as td') return fixture.definitions.filter((row) => !taggedType || row.tagged_type === taggedType);
    if (table === 'tag_mappings') return fixture.mappings.filter((row) =>
      (!whereInValues || whereInValues.includes(row.tag_id)) && (!taggedType || row.tagged_type === taggedType));
    return [];
  };
  const builder: any = new Proxy({}, {
    get(_target, key) {
      if (key === 'then') return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(rows()).then(resolve, reject);
      if (key === 'select') return () => builder;
      if (key === 'whereIn') return (_column: string, values: unknown[]) => { whereInValues = values; return builder; };
      if (key === 'where') return (column: unknown, value: unknown) => {
        if (typeof column === 'string' && column.includes('tagged_type')) taggedType = value;
        return builder;
      };
      if (key === 'whereRaw' || key === 'orderBy' || key === 'distinctOn') return () => builder;
      if (key === 'whereExists') return () => builder;
      if (key === 'orWhereExists') return () => builder;
      return () => builder;
    },
  });
  return builder;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal', roles: [] }, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal', roles: [] }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('../lib/authHelpers', () => ({ hasPermissionAsync: vi.fn(async () => true), throwPermissionErrorAsync: vi.fn() }));
vi.mock('@alga-psa/authorization/projectReadAuthorization', () => ({ authorizeProjectsByIds: fixture.projectAuthorization }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_db: unknown, callback: (trx: any) => unknown) => callback({ raw: () => 1 })),
  tenantDb: vi.fn(() => ({
    table: (tableName: string) => query(tableName),
    tenantJoin: (builder: unknown) => builder,
    tenantWhereColumn: () => undefined,
  })),
  registerAfterCommit: vi.fn(),
}));
vi.mock('../models/tagMapping', () => ({ default: {
  getByEntity: fixture.tagMappingByEntity,
  getByEntities: fixture.tagMappingByEntities,
} }));
vi.mock('../models/tagDefinition', () => ({ default: {} }));
vi.mock('../lib/uiHelpers', () => ({ generateEntityColorAsync: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads', () => ({ buildTicketUpdatedPayload: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildTagAppliedPayload: vi.fn(), buildTagDefinitionCreatedPayload: vi.fn(), buildTagDefinitionUpdatedPayload: vi.fn(),
  buildTagRemovedPayload: vi.fn(), buildProjectTaskUpdatedPayload: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ actionError: vi.fn(), isAuthorizationThrow: () => false, permissionError: vi.fn() }));

import { findTagsByEntityId, findTagsByEntityIds, findAllTagsByType, getAllTags } from './tagActions';

describe('project tag reads enforce effective project/read redactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters populated hidden and denied mappings from entity reads while retaining visible tags', async () => {
    await expect(findTagsByEntityId('project-hidden', 'project')).resolves.toEqual([]);
    await expect(findTagsByEntityId('project-visible', 'project')).resolves.toMatchObject([{ tag_text: 'Visible tag' }]);
    await expect(findTagsByEntityIds(['project-hidden', 'project-visible', 'project-denied'], 'project'))
      .resolves.toMatchObject([{ tagged_id: 'project-visible', tag_text: 'Visible tag' }]);
  });

  it('filters global project tag loads and suggestions, refresh-safe, without filtering other entity types', async () => {
    const firstLoad = await getAllTags();
    expect(firstLoad).toMatchObject([
      { tagged_type: 'project', tagged_id: 'project-visible', tag_text: 'Visible tag' },
      { tagged_type: 'ticket', tagged_id: 'ticket-1', tag_text: 'Ticket tag' },
    ]);
    await expect(getAllTags()).resolves.toEqual(firstLoad);
    await expect(findAllTagsByType('project')).resolves.toMatchObject([{ tag_text: 'Visible tag', tagged_type: 'project' }]);
    await expect(findAllTagsByType('ticket')).resolves.toMatchObject([{ tag_text: 'Ticket tag', tagged_type: 'ticket' }]);
  });
});
