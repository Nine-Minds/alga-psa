import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { createClient, createUser } from '../../../../test-utils/testDataFactory';

/** Shared seed helpers for the stopwatch integration tests (real DB). */

export async function createStopwatchUser(db: Knex, tenant: string, label: string, timezone = 'UTC'): Promise<string> {
  const userId = await createUser(db, tenant, {
    email: `${label}-${uuidv4().slice(0, 8)}@example.com`,
    first_name: label,
    last_name: 'Tester',
    user_type: 'internal',
    timezone,
  });
  await grantPermissions(db, tenant, userId, ['create', 'update', 'read'].map((action) => ({ resource: 'time_entry', action })));
  await grantPermissions(db, tenant, userId, [{ resource: 'ticket', action: 'read' }]);
  return userId;
}

async function grantPermissions(
  connection: Knex,
  tenant: string,
  userId: string,
  perms: Array<{ resource: string; action: string }>,
) {
  const scopedDb = tenantDb(connection, tenant);
  const roleId = uuidv4();
  await scopedDb.table('roles').insert({
    tenant,
    role_id: roleId,
    role_name: `Stopwatch test role ${uuidv4().slice(0, 8)}`,
    description: 'Test role for stopwatch integration',
    msp: true,
    client: false,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  for (const perm of perms) {
    const existing = await scopedDb.table('permissions')
      .where({ resource: perm.resource, action: perm.action })
      .first('permission_id');
    const permissionId = existing?.permission_id ?? uuidv4();
    if (!existing) {
      await scopedDb.table('permissions').insert({
        tenant,
        permission_id: permissionId,
        resource: perm.resource,
        action: perm.action,
        msp: true,
        client: false,
        created_at: connection.fn.now(),
      });
    }
    await scopedDb.table('role_permissions')
      .insert({ tenant, role_id: roleId, permission_id: permissionId, created_at: connection.fn.now() })
      .onConflict(['tenant', 'role_id', 'permission_id'])
      .ignore();
  }
  await scopedDb.table('user_roles')
    .insert({ tenant, user_id: userId, role_id: roleId, created_at: connection.fn.now() })
    .onConflict(['tenant', 'user_id', 'role_id'])
    .ignore();
}

export async function createBoard(db: Knex, tenant: string, enableLiveTicketTimer: boolean | undefined): Promise<string> {
  const boardId = randomUUID();
  await tenantDb(db, tenant).table('boards').insert({
    tenant,
    board_id: boardId,
    board_name: `Stopwatch board ${boardId.slice(0, 6)}`,
    ...(enableLiveTicketTimer === undefined ? {} : { enable_live_ticket_timer: enableLiveTicketTimer }),
  });
  return boardId;
}

export interface TicketSeed {
  clientId: string;
  ticketId: string;
  ticketNumber: string;
  title: string;
  boardId: string | null;
}

export async function createTicket(
  db: Knex,
  tenant: string,
  options: { boardId?: string | null; clientId?: string } = {},
): Promise<TicketSeed> {
  const clientId = options.clientId ?? (await createClient(db, tenant, `Stopwatch client ${uuidv4().slice(0, 6)}`));
  const ticketId = randomUUID();
  const ticketNumber = `SW-${uuidv4().slice(0, 6)}`;
  const title = `Stopwatch ticket ${ticketId.slice(0, 6)}`;
  await tenantDb(db, tenant).table('tickets').insert({
    tenant,
    ticket_id: ticketId,
    ticket_number: ticketNumber,
    title,
    client_id: clientId,
    ...(options.boardId ? { board_id: options.boardId } : {}),
  });
  return { clientId, ticketId, ticketNumber, title, boardId: options.boardId ?? null };
}

export interface BucketSeed {
  clientId: string;
  ticketId: string;
  serviceId: string;
  bucketId: string;
  contractLineId: string;
}

/** A client covered by a Bucket contract line with one service, plus a ticket for that client. */
export async function seedBucketClient(db: Knex, tenant: string): Promise<BucketSeed> {
  const scopedDb = tenantDb(db, tenant);
  const clientId = await createClient(db, tenant, `Stopwatch bucket client ${uuidv4().slice(0, 6)}`);
  const contractId = randomUUID();
  const contractLineId = randomUUID();

  let serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
  if (!serviceTypeId) {
    await scopedDb.table('service_types').insert({
      id: randomUUID(),
      tenant,
      name: `Stopwatch service type ${uuidv4().slice(0, 6)}`,
      is_active: true,
    });
    serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
  }

  await scopedDb.table('contracts').insert({
    tenant,
    contract_id: contractId,
    contract_name: `Stopwatch contract ${clientId.slice(0, 6)}`,
  });
  await scopedDb.table('contract_lines').insert({
    tenant,
    contract_line_id: contractLineId,
    contract_id: contractId,
    contract_line_name: `Stopwatch line ${clientId.slice(0, 6)}`,
    contract_line_type: 'Bucket',
    billing_frequency: 'monthly',
    cadence_owner: 'client',
    is_template: false,
    is_active: true,
  });
  await scopedDb.table('client_contracts').insert({
    tenant,
    client_contract_id: randomUUID(),
    client_id: clientId,
    contract_id: contractId,
    start_date: '2026-01-01',
    end_date: null,
    is_active: true,
  });

  const serviceId = randomUUID();
  await scopedDb.table('service_catalog').insert({
    tenant,
    service_id: serviceId,
    service_name: `stopwatch-svc-${serviceId.slice(0, 6)}`,
    billing_method: 'hourly',
    custom_service_type_id: serviceTypeId,
  });
  const bucketId = randomUUID();
  await scopedDb.table('contract_line_buckets').insert({
    tenant,
    bucket_id: bucketId,
    contract_line_id: contractLineId,
    total_minutes: 6000,
    overage_rate: 15000,
    allow_rollover: false,
    covers_all_services: false,
  });
  await scopedDb.table('contract_line_bucket_services').insert({
    tenant,
    bucket_id: bucketId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    burn_multiplier: 1,
  });

  const ticket = await createTicket(db, tenant, { clientId });
  return { clientId, ticketId: ticket.ticketId, serviceId, bucketId, contractLineId };
}

export async function createPeriod(db: Knex, tenant: string, start: string, end: string): Promise<string> {
  const periodId = uuidv4();
  await tenantDb(db, tenant).table('time_periods').insert({ period_id: periodId, tenant, start_date: start, end_date: end });
  return periodId;
}

export async function createSheet(db: Knex, tenant: string, periodId: string, owner: string, status = 'DRAFT'): Promise<string> {
  const id = uuidv4();
  await tenantDb(db, tenant).table('time_sheets').insert({ id, tenant, period_id: periodId, user_id: owner, approval_status: status });
  return id;
}
