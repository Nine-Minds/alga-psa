/**
 * alga-2026-0003109: the batched `loadReferenceLists` action returns, per key, exactly what the
 * matching individual action returns for the same user, and a project:read denial degrades only
 * the projects key.
 *
 * Real DB. Only the session (withAuth / withOptionalAuth), the DB handle and the coarse RBAC grant
 * are stood in for. The no-`project:read` case flips the RBAC stub for that one permission.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const ref = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
  user: null as any,
  deniedProjectRead: false,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
  getConnection: vi.fn(async () => ref.knex),
}));
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
}));
const rbac = vi.hoisted(() => ({
  hasPermission: async (_user: unknown, resource: string, action: string) =>
    !(resource === 'project' && action === 'read' && (globalThis as any).__denyProjectRead === true),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  hasPermission: rbac.hasPermission,
  getApiKeyUserOverride: () => null,
  getSession: async () => null,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: rbac.hasPermission }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import { getAllBoards } from '../../../../packages/reference-data/src/actions/boardActions';
import { getStatuses } from '../../../../packages/reference-data/src/actions/status-actions/statusActions';
import { getAllPriorities } from '../../../../packages/reference-data/src/actions/priorityActions';
import { findAllTagsByType } from '../../../../packages/tags/src/actions/tagActions';
import { getProjectsWithPhases } from '../../../../packages/projects/src/actions/projectActions';
import { loadReferenceLists } from '../../../../packages/msp-composition/src/referenceData/referenceDataActions';
import { isReferenceListError } from '@alga-psa/ui/lib/referenceData';

describe('loadReferenceLists parity with the individual actions', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Reference lists ${mark}`);
    ref.tenant = tenant;
    const admin = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    ref.user = { user_id: admin, tenant, user_type: 'internal', roles: [] };

    const boardId = uuidv4();
    const clientId = uuidv4();
    const projectId = uuidv4();
    const ticketId = uuidv4();
    const tagId = uuidv4();
    await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${mark}`, is_default: false, display_order: 1 });
    await db('statuses').insert({
      tenant, status_id: uuidv4(), name: `Open ${mark}`, status_type: 'ticket', board_id: boardId, is_closed: false, order_number: 1,
    });
    await db('priorities').insert({
      tenant, priority_id: uuidv4(), priority_name: `High ${mark}`, color: '#f00', order_number: 1, created_by: admin, item_type: 'ticket',
    });
    await db('clients').insert({ tenant, client_id: clientId, client_name: `Client ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false });
    const projectStatusId = uuidv4();
    await db('statuses').insert({
      tenant, status_id: projectStatusId, name: `Active ${mark}`, status_type: 'project', is_closed: false, order_number: 1,
    });
    await db('projects').insert({
      tenant, project_id: projectId, project_name: `Project ${mark}`, client_id: clientId, status: projectStatusId,
      wbs_code: `W-${mark}`, project_number: `P-${mark}`, is_inactive: false,
    });
    await db('project_phases').insert({
      tenant, phase_id: uuidv4(), project_id: projectId, phase_name: `Phase ${mark}`, status: 'active', order_number: 1, wbs_code: `W-${mark}.1`,
    });
    await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `T-${mark}`, title: 'Ticket', client_id: clientId });
    await db('tag_definitions').insert({ tenant, tag_id: tagId, tag_text: `tag-${mark}`, tagged_type: 'ticket' });
    await db('tag_mappings').insert({ tenant, mapping_id: uuidv4(), tag_id: tagId, tagged_id: ticketId, tagged_type: 'ticket', created_by: admin });
  });

  afterAll(async () => {
    (globalThis as any).__denyProjectRead = false;
    await db?.destroy();
  });

  it('returns for every key what the matching action returns', async () => {
    (globalThis as any).__denyProjectRead = false;
    const batch = await loadReferenceLists([
      'boards', 'ticketStatuses', 'ticketTags', 'projectTaskTags', 'projectsWithPhases', 'priorities:ticket', 'priorities:project_task',
    ]);
    expect(batch.boards).toEqual(await getAllBoards(true));
    expect(batch.ticketStatuses).toEqual(await getStatuses('ticket' as any));
    expect(batch.ticketTags).toEqual(await findAllTagsByType('ticket' as any));
    expect(batch.projectTaskTags).toEqual(await findAllTagsByType('project_task' as any));
    expect(batch.projectsWithPhases).toEqual(await getProjectsWithPhases());
    expect(batch['priorities:ticket']).toEqual(await getAllPriorities('ticket'));
    expect(batch['priorities:project_task']).toEqual(await getAllPriorities('project_task'));
    expect((batch.boards as any[]).length).toBeGreaterThan(0);
    expect((batch.projectsWithPhases as any[]).length).toBeGreaterThan(0);
    expect((batch.ticketTags as any[]).length).toBeGreaterThan(0);
  });

  it('a user without project:read gets an error marker for projectsWithPhases only', async () => {
    (globalThis as any).__denyProjectRead = true;
    try {
      const batch = await loadReferenceLists(['boards', 'ticketTags', 'projectsWithPhases']);
      expect(isReferenceListError(batch.projectsWithPhases)).toBe(true);
      expect(isReferenceListError(batch.boards)).toBe(false);
      expect(isReferenceListError(batch.ticketTags)).toBe(false);
      // The individual action denies the same user the same way.
      expect(await getProjectsWithPhases()).toHaveProperty('permissionError');
      expect(batch.ticketTags).toEqual(await findAllTagsByType('ticket' as any));
    } finally {
      (globalThis as any).__denyProjectRead = false;
    }
  });
});
