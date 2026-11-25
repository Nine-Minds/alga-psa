/**
 * Co-managed seat technicians tag tickets and project tasks (alga-2026-0003430; F001, F003 / T001, T002) on real Postgres.
 *
 * A seat technician applies existing tags to, and removes tags from, a ticket on a board in scope and a task of a shared
 * project; removing the MSP's last use of a tag keeps the MSP's definition. They never write a record out of scope, use a
 * tag they cannot see, mint a tag of another type, or manage a definition. A denied write changes nothing.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any, user: null as any, tenant: '' }));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (fn: any) => (...args: any[]) => fn(holder.user, { tenant: holder.tenant }, ...args),
  withOptionalAuth: (fn: any) => (...args: any[]) => fn(holder.user, { tenant: holder.tenant }, ...args),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: holder.db, tenant: holder.tenant }),
  getAdminConnection: async () => holder.db,
}));
vi.mock('@alga-psa/db/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdminConnection: async () => holder.db,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishWorkflowEvent: async () => undefined,
  publishNonCatalogWorkflowEvent: async () => undefined,
  publishEvent: async () => undefined,
}));

import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope, setCoManagedSeatProjectShared, CO_MANAGED_SEAT_ROLE_GRANTS } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatResolver } from '@alga-psa/co-managed/seatAuthority';
import { registerBuiltinRuleResolver } from '@alga-psa/authorization/kernel';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import {
  checkTagPermissions, createTag, deleteAllTagsByText, deleteTag, findAllTagsByType, findTagsByEntityId, isTagActionError,
  updateTagColor, updateTagText,
} from '@alga-psa/tags/actions';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

/** The failure of an action that was refused (returned as a tag action error, or thrown), or null when it succeeded. */
const refusal = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    const result: any = await run();
    if (isTagActionError(result)) return String(result.actionError ?? result.permissionError ?? 'error');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describeDb('co-managed seat tags on real Postgres', { shuffle: false }, () => {
  let db: Knex;
  let tenant: string;
  let ownClient: string;
  let otherClient: string;
  let arrangementId: string;
  let inScopeBoard: string;
  let outBoard: string;
  let tech: any;
  let msp: any;
  let ticketA: string;
  let ticketB: string;
  let ticketOut: string;       // own client, but on a board outside the arrangement
  let ticketOtherClient: string;
  let sharedTask: string;
  let sharedTask2: string;
  let unsharedTask: string;
  let otherClientTask: string;

  const as = (user: any) => { holder.user = user; };
  const roleFor = async (permissions: Array<[string, string]>) => {
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    const roleId = randomUUID();
    await db('roles').insert({ tenant, role_id: roleId, role_name: `role-${roleId.slice(0, 8)}`, msp: true, client: false });
    for (const [resource, action] of permissions) {
      const permission = await db('permissions').where({ tenant, resource, action, msp: true }).first('permission_id');
      const permissionId = permission?.permission_id ?? randomUUID();
      if (!permission) await db('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
    }
    await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    return userId;
  };

  const mappings = async (taggedId: string) => db('tag_mappings as tm')
    .join('tag_definitions as td', function join() { this.on('td.tenant', 'tm.tenant').andOn('td.tag_id', 'tm.tag_id'); })
    .where({ 'tm.tenant': tenant, 'tm.tagged_id': taggedId })
    .select('tm.mapping_id', 'td.tag_text', 'td.tag_id');
  const texts = async (taggedId: string) => (await mappings(taggedId)).map((row: any) => row.tag_text).sort();
  const definition = (text: string, type: string) => db('tag_definitions').where({ tenant, tag_text: text, tagged_type: type }).first();
  const tag = (text: string, taggedId: string, type: string) => createTag({ tag_text: text, tagged_id: taggedId, tagged_type: type } as any);
  const mappingId = async (taggedId: string, text: string) => (await mappings(taggedId)).find((row: any) => row.tag_text === text)?.mapping_id as string;

  const remove = async (taggedId: string, text: string) => deleteTag(await mappingId(taggedId, text));
  const makeTicket = async (clientId: string, boardId: string, statusId: string, priorityId: string) => {
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant, ticket_id: ticketId, ticket_number: `TG-${ticketId.slice(0, 8)}`, title: 'Tag target', client_id: clientId, board_id: boardId,
      status_id: statusId, priority_id: priorityId, entered_by: msp.user_id, entered_at: db.fn.now(), updated_at: db.fn.now(),
    });
    return ticketId;
  };

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    db = await createTestDbConnection({ databaseName: 's3430_seat_tags_test' });
    holder.db = db;
    registerBuiltinRuleResolver(coManagedSeatResolver);

    tenant = await createTenant(db, `Seat tags sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    holder.tenant = tenant;
    await db('co_managed_entitlements').insert({
      tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 4,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
    });
    ownClient = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 8)}`);
    otherClient = await createClient(db, tenant, `Other client ${randomUUID().slice(0, 8)}`);

    const mspId = await roleFor([
      ['ticket', 'read'], ['ticket', 'update'], ['project', 'read'], ['project', 'update'], ['project_task', 'read'],
      ['project_task', 'update'], ['tag', 'read'], ['tag', 'create'], ['tag', 'update'], ['tag', 'delete'],
    ]);
    msp = await db('users').where({ tenant, user_id: mspId }).first();

    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: ownClient, operationId: randomUUID(), seats: 2 });
    arrangementId = arrangement.arrangement_id;
    [inScopeBoard, outBoard] = [randomUUID(), randomUUID()];
    const statusIn = randomUUID(); const statusOut = randomUUID(); const priorityId = randomUUID();
    for (const [boardId, statusId] of [[inScopeBoard, statusIn], [outBoard, statusOut]]) {
      await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${boardId.slice(0, 8)}`, is_default: false, is_inactive: false, display_order: 900 });
      await db('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: msp.user_id });
    }
    await db('priorities').insert({ tenant, priority_id: priorityId, priority_name: `P-${priorityId.slice(0, 4)}`, order_number: 50, color: '#aaaaaa', created_by: msp.user_id, item_type: 'ticket' });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId, boards: [{ boardId: inScopeBoard, canCreate: false }] });

    const seatId = await roleFor(CO_MANAGED_SEAT_ROLE_GRANTS.map((grant) => grant.split(':') as [string, string]));
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId: seatId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId, user_id: seatId, state: 'active' });
    });
    tech = await db('users').where({ tenant, user_id: seatId }).first();

    ticketA = await makeTicket(ownClient, inScopeBoard, statusIn, priorityId);
    ticketB = await makeTicket(ownClient, inScopeBoard, statusIn, priorityId);
    ticketOut = await makeTicket(ownClient, outBoard, statusOut, priorityId);
    ticketOtherClient = await makeTicket(otherClient, inScopeBoard, statusIn, priorityId);

    const projectStatus = randomUUID(); const taskStatus = randomUUID();
    await db('statuses').insert([
      { tenant, status_id: projectStatus, name: 'Active', status_type: 'project', order_number: 1, is_closed: false },
      { tenant, status_id: taskStatus, name: 'To do', status_type: 'project_task', order_number: 1, is_closed: false },
    ]);
    const makeProject = async (clientId: string, name: string, taskCount: number) => {
      const projectId = randomUUID(); const phaseId = randomUUID(); const mapping = randomUUID();
      await db('projects').insert({ tenant, project_id: projectId, project_name: name, client_id: clientId, status: projectStatus,
        wbs_code: `W-${projectId.slice(0, 4)}`, project_number: `P-${projectId.slice(0, 6)}`, is_inactive: false });
      await db('project_status_mappings').insert({ tenant, project_status_mapping_id: mapping, project_id: projectId, status_id: taskStatus, display_order: 1, is_visible: true, is_standard: false });
      await db('project_phases').insert({ tenant, phase_id: phaseId, project_id: projectId, phase_name: `Phase ${name}`, status: 'active', order_number: 1, wbs_code: `W-${projectId.slice(0, 4)}.1`, order_key: 'a0' });
      const ids: string[] = [];
      for (let i = 0; i < taskCount; i += 1) {
        const taskId = randomUUID(); ids.push(taskId);
        await db('project_tasks').insert({ tenant, task_id: taskId, phase_id: phaseId, task_name: `Task ${name} ${i}`, wbs_code: `W-${projectId.slice(0, 4)}.1.${i + 1}`,
          project_status_mapping_id: mapping, order_key: `a${i}`, task_type_key: 'task' });
      }
      return { projectId, ids };
    };
    const shared = await makeProject(ownClient, 'Shared', 2);
    const unshared = await makeProject(ownClient, 'Unshared', 1);
    const foreign = await makeProject(otherClient, 'Foreign', 1);
    [sharedTask, sharedTask2] = shared.ids; [unsharedTask] = unshared.ids; [otherClientTask] = foreign.ids;
    await setCoManagedSeatProjectShared(db, { sponsorTenant: tenant, arrangementId, projectId: shared.projectId, shared: true });

    // The MSP's own tagging.
    as(msp);
    for (const [text, id, type] of [
      ['urgent', ticketA, 'ticket'], ['solo', ticketA, 'ticket'], ['secret', ticketOtherClient, 'ticket'],
      ['blocked', sharedTask, 'project_task'], ['review', sharedTask2, 'project_task'], ['hidden-task', otherClientTask, 'project_task'],
    ] as const) {
      expect(await refusal(() => tag(text, id, type)), `msp tags ${text}`).toBeNull();
    }
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });
  beforeEach(() => { process.env.FORCE_CAPABILITIES = 'co-managed-seat:on'; });

  // T001 / F001
  it('lists the seat the existing tags it can see, of the record\'s type only', async () => {
    as(tech);
    const ticketTags = ((await findAllTagsByType('ticket' as any)) as any[]).map((t) => t.tag_text);
    expect(ticketTags).toEqual(expect.arrayContaining(['urgent', 'solo']));
    expect(ticketTags).not.toContain('secret');
    const taskTags = ((await findAllTagsByType('project_task' as any)) as any[]).map((t) => t.tag_text);
    expect(taskTags).toEqual(expect.arrayContaining(['blocked', 'review']));
    expect(taskTags).not.toContain('hidden-task');
    expect(await checkTagPermissions('project_task' as any)).toMatchObject({
      canAddExisting: true, canCreateNew: false, canEditColors: false, canEditText: false, canDeleteAll: false, canDeleteDefinition: false,
    });
  });

  it('applies and removes tags on an editable ticket, keeping the definition of the last use', async () => {
    as(tech);
    expect(await refusal(() => tag('urgent', ticketB, 'ticket'))).toBeNull();
    expect(await texts(ticketB)).toEqual(['urgent']);
    const reread = (await findTagsByEntityId(ticketB, 'ticket')) as any[];
    expect(reread.map((t) => t.tag_text)).toEqual(['urgent']);

    // 'solo' has one use, applied by the MSP.
    expect(await refusal(() => remove(ticketA, 'solo'))).toBeNull();
    expect(await texts(ticketA)).toEqual(['urgent']);
    expect(await definition('solo', 'ticket')).toBeTruthy();

    expect(await refusal(() => remove(ticketB, 'urgent'))).toBeNull();
    expect(await texts(ticketB)).toEqual([]);
    expect(await definition('urgent', 'ticket')).toBeTruthy();
  });

  it('applies and removes tags on a task of a shared project, keeping the definition of the last use', async () => {
    as(tech);
    expect(await refusal(() => tag('review', sharedTask, 'project_task'))).toBeNull();
    expect(await texts(sharedTask)).toEqual(['blocked', 'review']);
    expect(await refusal(() => remove(sharedTask, 'blocked'))).toBeNull();
    expect(await texts(sharedTask)).toEqual(['review']);
    expect(await definition('blocked', 'project_task')).toBeTruthy();
    // Asking to drop the definition with the last use is a definition act: refused, and the mapping stays.
    const last = await mappingId(sharedTask2, 'review');
    expect(await refusal(() => deleteTag(last, true))).toMatch(/permission denied/i);
    expect(await mappingId(sharedTask2, 'review')).toBe(last);
    expect(await definition('review', 'project_task')).toBeTruthy();
  });

  // T002 / F003
  it('refuses a record out of scope, and leaves its mappings alone', async () => {
    as(tech);
    for (const [id, type] of [[ticketOut, 'ticket'], [ticketOtherClient, 'ticket'], [unsharedTask, 'project_task'], [otherClientTask, 'project_task']] as const) {
      const before = await texts(id);
      expect(await refusal(() => tag(type === 'ticket' ? 'urgent' : 'blocked', id, type)), `apply on ${type} ${id}`).toMatch(/permission denied/i);
      expect(await texts(id)).toEqual(before);
    }
    const foreignMapping = await mappingId(otherClientTask, 'hidden-task');
    expect(await refusal(() => deleteTag(foreignMapping))).toMatch(/permission denied/i);
    expect(await mappingId(otherClientTask, 'hidden-task')).toBe(foreignMapping);
  });

  it('refuses a tag the seat cannot see, and a tag of the wrong type', async () => {
    as(tech);
    expect(await refusal(() => tag('secret', ticketB, 'ticket'))).toMatch(/permission denied|only apply tags/i);
    expect(await texts(ticketB)).toEqual([]);
    // A ticket tag's text on a task is a new project-task tag: the seat mints none.
    expect(await refusal(() => tag('urgent', sharedTask2, 'project_task'))).not.toBeNull();
    expect(await definition('urgent', 'project_task')).toBeUndefined();
    expect(await texts(sharedTask2)).toEqual(['review']);
  });

  it('refuses every definition-managing action, leaving the definitions unchanged', async () => {
    as(tech);
    const before = await definition('urgent', 'ticket');
    expect(await refusal(async () => updateTagColor(await mappingId(ticketA, 'urgent'), '#000000', '#ffffff'))).not.toBeNull();
    expect(await refusal(async () => updateTagText(await mappingId(ticketA, 'urgent'), 'renamed'))).not.toBeNull();
    expect(await refusal(() => deleteAllTagsByText('urgent', 'ticket' as any))).not.toBeNull();
    expect(await definition('urgent', 'ticket')).toEqual(before);
    expect(await definition('renamed', 'ticket')).toBeUndefined();
    expect(await texts(ticketA)).toEqual(['urgent']);
  });

  it('leaves ordinary MSP tagging as it was: definitions can be managed and dropped with their last use', async () => {
    as(msp);
    const only = await mappingId(ticketOtherClient, 'secret');
    expect(await refusal(() => deleteTag(only, true))).toBeNull();
    expect(await definition('secret', 'ticket')).toBeUndefined();
    expect(await refusal(async () => updateTagColor(await mappingId(ticketA, 'urgent'), '#101010', '#fefefe'))).toBeNull();
    expect((await definition('urgent', 'ticket')).background_color).toBe('#101010');
  });
});
