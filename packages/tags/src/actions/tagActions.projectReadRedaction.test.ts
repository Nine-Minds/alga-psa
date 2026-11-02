import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const mappings = [
    { mapping_id: 'hidden-map', tag_id: 'hidden-tag', tag_text: 'Wonderland Expansion', tagged_id: 'project-hidden', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'visible-map', tag_id: 'visible-tag', tag_text: 'Visible tag', tagged_id: 'project-visible', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'denied-map', tag_id: 'denied-tag', tag_text: 'Denied project tag', tagged_id: 'project-denied', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'fields-map', tag_id: 'fields-tag', tag_text: 'Fields alias tag', tagged_id: 'project-fields', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'values-map', tag_id: 'values-tag', tag_text: 'Values alias tag', tagged_id: 'project-values', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'nested-map', tag_id: 'nested-tag', tag_text: 'Nested alias tag', tagged_id: 'project-nested', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'parent-map', tag_id: 'parent-tag', tag_text: 'Parent alias tag', tagged_id: 'project-parent', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'wildcard-map', tag_id: 'wildcard-tag', tag_text: 'Wildcard tag', tagged_id: 'project-wildcard', tagged_type: 'project', tenant: 'tenant-1' },
    { mapping_id: 'ticket-map', tag_id: 'ticket-tag', tag_text: 'Ticket tag', tagged_id: 'ticket-1', tagged_type: 'ticket', tenant: 'tenant-1' },
  ];
  const redactions: Record<string, string[]> = {
    'project-hidden': ['tags'],
    'project-fields': ['fields.tags'],
    'project-values': ['values.tags'],
    'project-nested': ['projects.tags.internal'],
    'project-parent': ['projects'],
    'project-wildcard': ['*'],
  };
  const permissions = { tagRead: true };
  const definitions = mappings.map(({ tag_id, tag_text, tagged_type }) => ({
    tag_id, tag_text, tagged_type, created_at: '2026-01-01',
  }));
  const projectAuthorization = vi.fn(async (_trx: unknown, _tenant: string, _user: unknown, ids: string[]) => ids.map((id) => ({
    project: { project_id: id }, allowed: id !== 'project-denied', redactedFields: redactions[id] ?? [],
  })));
  const tagMappingByEntity = vi.fn(async (_trx: unknown, _tenant: string, id: string) => mappings.filter((tag) => tag.tagged_id === id));
  const tagMappingByEntities = vi.fn(async (_trx: unknown, _tenant: string, ids: string[], type: string) => mappings.filter((tag) => ids.includes(tag.tagged_id) && tag.tagged_type === type));
  return { mappings, definitions, redactions, permissions, projectAuthorization, tagMappingByEntity, tagMappingByEntities };
});

function query(table: string): any {
  let whereInValues: unknown[] | undefined;
  let taggedType: unknown;
  let mappingId: unknown;
  const rows = () => {
    if (table === 'tag_mappings as tm') return fixture.mappings.filter((row) => !mappingId || row.mapping_id === mappingId);
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
        if (column === 'tm.mapping_id') mappingId = value;
        return builder;
      };
      if (key === 'first') return async () => rows()[0];
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
vi.mock('../lib/authHelpers', () => ({ hasPermissionAsync: vi.fn(async (_user: unknown, resource: string) => resource === 'tag' ? fixture.permissions.tagRead : true), throwPermissionErrorAsync: vi.fn() }));
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
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ actionError: vi.fn(), isAuthorizationThrow: () => false, permissionError: (message: string) => ({ message }) }));

import { findTagById, findTagsByEntityId, findTagsByEntityIds, findAllTagsByType, getAllTags } from './tagActions';

describe('project tag reads enforce effective project/read redactions', () => {
  beforeEach(() => {
    fixture.permissions.tagRead = true;
    fixture.redactions['project-hidden'] = ['tags'];
    vi.clearAllMocks();
  });

  it.each([
    'project.tags', 'fields.project.tags', 'project.tags.internal', 'project',
    ' PROJECT.TAGS ', 'projects.tags', 'fields.tags', 'values.tags', 'tags.internal',
    'project_tags.tag_text', 'tags.background_color', '*',
  ])('hides populated tags consistently for the %s redaction', async (field) => {
    fixture.redactions['project-hidden'] = [field];
    await expect(findTagsByEntityId('project-hidden', 'project')).resolves.toEqual([]);
    await expect(findTagsByEntityIds(['project-hidden'], 'project')).resolves.toEqual([]);
    await expect(findTagById('hidden-map')).resolves.toBeUndefined();
    await expect(getAllTags()).resolves.toMatchObject([
      { tagged_id: 'project-visible', tag_text: 'Visible tag' },
      { tagged_id: 'ticket-1', tag_text: 'Ticket tag' },
    ]);
    await expect(findAllTagsByType('project')).resolves.toMatchObject([{ tag_text: 'Visible tag' }]);
  });

  it('filters populated hidden and denied mappings from entity reads while retaining visible tags', async () => {
    await expect(findTagsByEntityId('project-hidden', 'project')).resolves.toEqual([]);
    await expect(findTagsByEntityId('project-visible', 'project')).resolves.toMatchObject([{ tag_text: 'Visible tag' }]);
    await expect(findTagsByEntityIds(['project-hidden', 'project-visible', 'project-denied'], 'project'))
      .resolves.toMatchObject([{ tagged_id: 'project-visible', tag_text: 'Visible tag' }]);
  });

  it('uses project masking redaction semantics for aliases, nested paths, parents, and wildcards', async () => {
    for (const [projectId, mappingId] of [
      ['project-fields', 'fields-map'], ['project-values', 'values-map'], ['project-nested', 'nested-map'],
      ['project-parent', 'parent-map'], ['project-wildcard', 'wildcard-map'],
    ]) {
      await expect(findTagsByEntityId(projectId, 'project')).resolves.toEqual([]);
      await expect(findTagsByEntityIds([projectId], 'project')).resolves.toEqual([]);
      await expect(findTagById(mappingId)).resolves.toBeUndefined();
    }
    const globalTags = await getAllTags();
    expect(globalTags).not.toEqual(expect.arrayContaining(fixture.mappings.filter((row) => row.tagged_type === 'project' && fixture.redactions[row.tagged_id]).map(({ tag_text }) => expect.objectContaining({ tag_text }))));
    await expect(findAllTagsByType('project')).resolves.not.toEqual(expect.arrayContaining(fixture.mappings.filter((row) => row.tagged_type === 'project' && fixture.redactions[row.tagged_id]).map(({ tag_text }) => expect.objectContaining({ tag_text }))));
  });

  it('requires tag:read and filters findTagById by effective project authorization', async () => {
    await expect(findTagById('hidden-map')).resolves.toBeUndefined();
    await expect(findTagById('denied-map')).resolves.toBeUndefined();
    await expect(findTagById('visible-map')).resolves.toMatchObject({ tag_text: 'Visible tag', tagged_id: 'project-visible' });
    fixture.permissions.tagRead = false;
    await expect(findTagById('visible-map')).resolves.toMatchObject({ message: 'Permission denied: Cannot read tags' });
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
