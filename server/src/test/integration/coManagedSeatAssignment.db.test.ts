/**
 * Co-managed seat and workspace shapes, slice S22 (F052, F053 / T029) on real Postgres.
 *
 * The human-work guard takes the work item an assignment is made to and refuses a seat technician
 * unless the item is their own client's and in their scope. A seat technician's assignee picker
 * offers only the technicians of their own client.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { tenantDb } from '@alga-psa/db';
import {
  assertHumanWorkAssignee, type HumanWorkItem,
} from '../../../../shared/lib/humanWork/assertHumanWorkAssignee';
import { HumanWorkAssigneeInvalidError } from '../../../../shared/lib/humanWork/HumanWorkOwnerRequiredError';
import {
  assertActorMayAssign, resolveSeatAssigneeAudience, restrictToSeatAudience,
} from '../../../../shared/lib/humanWork/seatAssigneeAudience';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('the human-work guard scopes seat technicians to their own client', { shuffle: false }, () => {
  let db: Knex;

  const board = async (tenant: string) => {
    const boardId = randomUUID();
    await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${boardId.slice(0, 8)}`, is_default: false });
    return boardId;
  };
  const ticket = async (tenant: string, clientId: string, boardId: string) => {
    const ticketId = randomUUID();
    const statusId = randomUUID();
    await db('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket',
      order_number: 1, is_closed: false, is_default: true, created_by: await anyUser(tenant) });
    const priority = await db('priorities').where({ tenant, item_type: 'ticket' }).first('priority_id');
    await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `S22-${ticketId.slice(0, 8)}`, title: 'S22',
      client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priority?.priority_id ?? await priorityFor(tenant),
      entered_by: await anyUser(tenant), entered_at: db.fn.now(), updated_at: db.fn.now() });
    return ticketId;
  };
  const anyUser = async (tenant: string) => (await db('users').where({ tenant }).first('user_id')).user_id as string;
  const priorityFor = async (tenant: string) => {
    const priorityId = randomUUID();
    await db('priorities').insert({ tenant, priority_id: priorityId, priority_name: `P ${priorityId.slice(0, 6)}`, item_type: 'ticket',
      color: '#3B82F6', order_number: 99, created_by: await anyUser(tenant), created_at: db.fn.now(), updated_at: db.fn.now() });
    return priorityId;
  };
  const projectStatus = async (tenant: string) => {
    const existing = await db('statuses').where({ tenant, status_type: 'project' }).first('status_id');
    if (existing) return existing.status_id as string;
    const statusId = randomUUID();
    await db('statuses').insert({ tenant, status_id: statusId, name: 'Active', status_type: 'project', order_number: 1,
      is_closed: false, created_by: await anyUser(tenant) });
    return statusId;
  };
  const project = async (tenant: string, clientId: string) => {
    const projectId = randomUUID();
    const phaseId = randomUUID();
    const taskId = randomUUID();
    await db('projects').insert({ tenant, project_id: projectId, client_id: clientId, project_name: `Project ${projectId.slice(0, 6)}`,
      wbs_code: projectId.slice(0, 8), is_inactive: false, status: await projectStatus(tenant), project_number: `S22-${projectId.slice(0, 8)}` });
    await db('project_phases').insert({ tenant, phase_id: phaseId, project_id: projectId, phase_name: 'Phase', wbs_code: '1.1', order_number: 1, status: await projectStatus(tenant) });
    const statusMappingId = randomUUID();
    await db('project_status_mappings').insert({ tenant, project_status_mapping_id: statusMappingId, project_id: projectId,
      status_id: null, custom_name: 'To do', display_order: 1, is_visible: true }).catch(() => undefined);
    await db('project_tasks').insert({ tenant, task_id: taskId, phase_id: phaseId, task_name: 'Task', wbs_code: '1.1.1',
      project_status_mapping_id: statusMappingId, order_key: 'a0' });
    return { projectId, phaseId, taskId };
  };
  const seatTechnician = async (tenant: string, arrangementId: string) => {
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId,
        user_id: userId, state: 'active' });
    });
    return userId;
  };

  const arrangement = async () => {
    const tenant = await createTenant(db, `S22 sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 10,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 8)}`);
    const otherClientId = await createClient(db, tenant, `Other client ${randomUUID().slice(0, 8)}`);
    const [scopedBoard, unscopedBoard] = [await board(tenant), await board(tenant)];
    const created = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: randomUUID(), seats: 3 });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: created.arrangement_id,
      boards: [{ boardId: scopedBoard, canCreate: false }] });
    const technician = await seatTechnician(tenant, created.arrangement_id);
    const peer = await seatTechnician(tenant, created.arrangement_id);
    const msp = await createUser(db, tenant, { user_type: 'internal' });
    return { tenant, clientId, otherClientId, scopedBoard, unscopedBoard, arrangementId: created.arrangement_id, technician, peer, msp };
  };

  const assign = (tenant: string, userIds: string[], item: HumanWorkItem) => assertHumanWorkAssignee(db, tenant, userIds, item);
  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.then(() => null, (e) => e);
    expect(error).toBeInstanceOf(HumanWorkAssigneeInvalidError);
    return error as HumanWorkAssigneeInvalidError;
  };

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's22_seat_assignment_test' });
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  // T029 / F053
  it('accepts a seat technician on an own-client ticket on an in-scope board', async () => {
    const s = await arrangement();
    const ticketId = await ticket(s.tenant, s.clientId, s.scopedBoard);
    await expect(assign(s.tenant, [s.technician, s.peer], { kind: 'ticket', ticketId })).resolves.toBeUndefined();
  });

  it('refuses a seat technician on another client\'s ticket', async () => {
    const s = await arrangement();
    const ticketId = await ticket(s.tenant, s.otherClientId, s.scopedBoard);
    const error = await refusal(assign(s.tenant, [s.technician], { kind: 'ticket', ticketId }));
    expect(error.reason).toBe('seat_out_of_scope');
    expect(error.userIds).toEqual([s.technician]);
  });

  it('refuses a seat technician on an own-client ticket on an out-of-scope board', async () => {
    const s = await arrangement();
    const ticketId = await ticket(s.tenant, s.clientId, s.unscopedBoard);
    await refusal(assign(s.tenant, [s.technician], { kind: 'ticket', ticketId }));
  });

  it('admits a new ticket only on a board that admits creation', async () => {
    const s = await arrangement();
    await refusal(assign(s.tenant, [s.technician], { kind: 'ticket_draft', clientId: s.clientId, boardId: s.scopedBoard }));
    await setCoManagedSeatBoardScope(db, { sponsorTenant: s.tenant, arrangementId: s.arrangementId,
      boards: [{ boardId: s.scopedBoard, canCreate: true }] });
    await expect(assign(s.tenant, [s.technician], { kind: 'ticket_draft', clientId: s.clientId, boardId: s.scopedBoard })).resolves.toBeUndefined();
    await refusal(assign(s.tenant, [s.technician], { kind: 'ticket_draft', clientId: s.otherClientId, boardId: s.scopedBoard }));
  });

  it('refuses a seat technician on a task of an unshared project, accepts it once shared', async () => {
    const s = await arrangement();
    const p = await project(s.tenant, s.clientId);
    await refusal(assign(s.tenant, [s.technician], { kind: 'project_task', taskId: p.taskId }));
    await refusal(assign(s.tenant, [s.technician], { kind: 'project_phase', phaseId: p.phaseId }));
    await db('co_managed_seat_project_grants').insert({ tenant: s.tenant, arrangement_id: s.arrangementId, project_id: p.projectId });
    await expect(assign(s.tenant, [s.technician], { kind: 'project_task', taskId: p.taskId })).resolves.toBeUndefined();
    const foreign = await project(s.tenant, s.otherClientId);
    await db('co_managed_seat_project_grants').insert({ tenant: s.tenant, arrangement_id: s.arrangementId, project_id: foreign.projectId });
    await refusal(assign(s.tenant, [s.technician], { kind: 'project_task', taskId: foreign.taskId }));
  });

  it('refuses a seat technician on every work item it cannot place, and once the seat is not live', async () => {
    const s = await arrangement();
    await refusal(assign(s.tenant, [s.technician], { kind: 'unscoped', surface: 'interaction' }));
    const ticketId = await ticket(s.tenant, s.clientId, s.scopedBoard);
    await db('co_managed_seat_assignments').where({ tenant: s.tenant, user_id: s.technician })
      .update({ state: 'revoked', revoked_at: new Date() });
    await refusal(assign(s.tenant, [s.technician], { kind: 'ticket', ticketId }));
  });

  // T029 / F052
  it('offers a seat technician only the technicians of their own client, and refuses an MSP assignee', async () => {
    const s = await arrangement();
    const audience = await resolveSeatAssigneeAudience(db, s.tenant, s.technician);
    expect(audience?.sort()).toEqual([s.technician, s.peer].sort());

    // The same users query the ticket pickers run, narrowed for the actor.
    const offered = await restrictToSeatAudience(
      tenantDb(db, s.tenant).table('users').where('user_type', 'internal').where('is_inactive', false), audience,
    ).select('user_id');
    const ids = offered.map((row: { user_id: string }) => row.user_id);
    expect(ids).not.toContain(s.msp);
    expect(ids.sort()).toEqual([s.technician, s.peer].sort());

    await expect(assertActorMayAssign(db, s.tenant, s.technician, [s.technician, s.peer])).resolves.toBeUndefined();
    expect((await refusal(assertActorMayAssign(db, s.tenant, s.technician, [s.msp]))).userIds).toEqual([s.msp]);

    // A technician of another client's arrangement is not a peer.
    const other = await arrangement();
    expect(audience).not.toContain(other.technician);
  });

  // T029 regression
  it('leaves MSP users and MSP actors exactly as before', async () => {
    const s = await arrangement();
    const ticketId = await ticket(s.tenant, s.otherClientId, s.unscopedBoard);
    await expect(assign(s.tenant, [s.msp], { kind: 'ticket', ticketId })).resolves.toBeUndefined();
    await expect(assign(s.tenant, [s.msp], { kind: 'unscoped', surface: 'interaction' })).resolves.toBeUndefined();
    expect(await resolveSeatAssigneeAudience(db, s.tenant, s.msp)).toBeNull();
    await expect(assertActorMayAssign(db, s.tenant, s.msp, [s.msp, s.technician])).resolves.toBeUndefined();
    const inactive = await createUser(db, s.tenant, { user_type: 'internal', is_inactive: true });
    await refusal(assign(s.tenant, [inactive], { kind: 'ticket', ticketId }));
  });
});
