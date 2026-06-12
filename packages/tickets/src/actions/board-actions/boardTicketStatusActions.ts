'use server'

import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import type { IStatus } from '@alga-psa/types';

import Status from '../../models/status';

type StatusSearchEventType = 'STATUS_CREATED' | 'STATUS_UPDATED' | 'STATUS_DELETED';

// Keeps the app-wide search index in sync when ticket statuses change.
// Failures are swallowed: the daily search reconcile job is the backstop.
async function publishStatusSearchEvent(
  eventType: StatusSearchEventType,
  tenant: string,
  statusId: string,
  boardId: string,
  userId?: string,
): Promise<void> {
  try {
    await publishEvent({
      eventType,
      payload: {
        tenantId: tenant,
        statusId,
        statusType: 'ticket',
        boardId,
        userId,
      },
    });
  } catch (eventError) {
    console.error(`[boardTicketStatusActions] Failed to publish ${eventType} search event:`, eventError);
  }
}

export interface BoardTicketStatusInput {
  status_id?: string;
  name: string;
  is_closed: boolean;
  is_default?: boolean;
  order_number?: number;
  color?: string | null;
  icon?: string | null;
}

type NormalizedBoardTicketStatus = {
  status_id?: string;
  name: string;
  is_closed: boolean;
  is_default: boolean;
  order_number: number;
  color: string | null;
  icon: string | null;
};

function formatBoardTicketStatusValidationError(message: string): Error {
  return new Error(message);
}

async function ensureBoardExists(
  trx: Knex.Transaction,
  tenant: string,
  boardId: string
): Promise<void> {
  const board = await trx('boards')
    .where({ tenant, board_id: boardId })
    .first('board_id');

  if (!board) {
    throw new Error('Board not found');
  }
}

function normalizeBoardTicketStatuses(
  statuses: BoardTicketStatusInput[]
): NormalizedBoardTicketStatus[] {
  const normalized: NormalizedBoardTicketStatus[] = [];

  statuses.forEach((status) => {
    const name = status.name.trim();
    if (!name) {
      if (status.status_id) {
        throw formatBoardTicketStatusValidationError('Ticket status names are required.');
      }
      return;
    }

    normalized.push({
      status_id: status.status_id,
      name,
      is_closed: status.is_closed,
      is_default: Boolean(status.is_default),
      order_number: status.order_number ?? ((normalized.length + 1) * 10),
      color: status.color ?? null,
      icon: status.icon ?? null,
    });
  });

  if (normalized.length === 0) {
    throw formatBoardTicketStatusValidationError('Add at least one ticket status before saving the board.');
  }

  const duplicateName = normalized.find((status, index) =>
    normalized.findIndex((candidate) => candidate.name.toLowerCase() === status.name.toLowerCase()) !== index
  );
  if (duplicateName) {
    throw formatBoardTicketStatusValidationError('Ticket status names must be unique within a board.');
  }

  const openDefaultStatuses = normalized.filter((status) => status.is_default && !status.is_closed);
  if (openDefaultStatuses.length !== 1 || normalized.some((status) => status.is_default && status.is_closed)) {
    throw formatBoardTicketStatusValidationError('Select exactly one open default ticket status before saving the board.');
  }

  return normalized.map((status, index) => ({
    ...status,
    order_number: (index + 1) * 10,
  }));
}

async function getTicketUsageByStatus(
  trx: Knex.Transaction,
  tenant: string,
  statusIds: string[]
): Promise<Array<{ status_id: string; count: number }>> {
  if (statusIds.length === 0) {
    return [];
  }

  const rows = await trx('tickets')
    .where({ tenant })
    .whereIn('status_id', statusIds)
    .select('status_id')
    .count('ticket_id as count')
    .groupBy('status_id') as Array<{ status_id: string; count: string }>;

  return rows.map((row) => ({
    status_id: row.status_id,
    count: Number(row.count || 0),
  }));
}

function buildTicketStatusInUseMessage(
  usages: Array<{ status_id: string; count: number }>,
  existingStatuses: IStatus[]
): string {
  const statusNameById = new Map(existingStatuses.map((status) => [status.status_id, status.name]));
  const details = usages
    .map((usage) => {
      const name = statusNameById.get(usage.status_id) || 'Unknown status';
      const ticketLabel = usage.count === 1 ? 'ticket' : 'tickets';
      return `"${name}" (${usage.count} ${ticketLabel})`;
    })
    .join(', ');

  if (usages.length === 1) {
    const usage = usages[0];
    const name = statusNameById.get(usage.status_id) || 'Unknown status';
    const ticketLabel = usage.count === 1 ? 'ticket' : 'tickets';
    const ticketReference = usage.count === 1 ? 'that ticket' : 'those tickets';
    return `Cannot delete ticket status "${name}" because it is used by ${usage.count} ${ticketLabel}. Move ${ticketReference} to another status before deleting it.`;
  }

  return `Cannot delete ticket statuses because they are still used: ${details}. Move those tickets to another status before deleting them.`;
}

async function getStatusColumns(trx: Knex.Transaction): Promise<Record<string, unknown>> {
  return trx('statuses').columnInfo();
}

function hasStatusColumn(columns: Record<string, unknown>, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function buildStatusInsertRow(
  columns: Record<string, unknown>,
  tenant: string,
  boardId: string,
  userId: string,
  now: string,
  status: NormalizedBoardTicketStatus
) {
  return {
    status_id: status.status_id || uuidv4(),
    tenant,
    board_id: boardId,
    name: status.name,
    status_type: 'ticket',
    ...(hasStatusColumn(columns, 'item_type') ? { item_type: 'ticket' } : {}),
    is_closed: status.is_closed,
    is_default: status.is_default,
    order_number: status.order_number,
    created_by: userId,
    ...(hasStatusColumn(columns, 'is_custom') ? { is_custom: true } : {}),
    ...(hasStatusColumn(columns, 'color') ? { color: status.color } : {}),
    ...(hasStatusColumn(columns, 'icon') ? { icon: status.icon } : {}),
    ...(hasStatusColumn(columns, 'created_at') ? { created_at: now } : {}),
    ...(hasStatusColumn(columns, 'updated_at') ? { updated_at: now } : {}),
  };
}

async function persistBoardTicketStatuses(
  trx: Knex.Transaction,
  tenant: string,
  boardId: string,
  userId: string,
  statuses: BoardTicketStatusInput[]
): Promise<IStatus[]> {
  await ensureBoardExists(trx, tenant, boardId);

  const normalizedStatuses = normalizeBoardTicketStatuses(statuses);
  const existingStatuses = await Status.getTicketStatusesByBoard(trx, tenant, boardId);
  const existingStatusIds = new Set(existingStatuses.map((status) => status.status_id));

  normalizedStatuses.forEach((status) => {
    if (status.status_id && !existingStatusIds.has(status.status_id)) {
      throw new Error('Ticket status not found on the selected board.');
    }
  });

  const columns = await getStatusColumns(trx);
  const now = new Date().toISOString();
  const keptStatusIds = normalizedStatuses
    .map((status) => status.status_id)
    .filter((statusId): statusId is string => Boolean(statusId));
  const deletedStatusIds = existingStatuses
    .map((status) => status.status_id)
    .filter((statusId) => !keptStatusIds.includes(statusId));

  const deletedStatusUsage = await getTicketUsageByStatus(trx, tenant, deletedStatusIds);
  if (deletedStatusUsage.length > 0) {
    throw formatBoardTicketStatusValidationError(
      buildTicketStatusInUseMessage(deletedStatusUsage, existingStatuses)
    );
  }

  for (const [index, existingStatus] of existingStatuses.entries()) {
    if (!keptStatusIds.includes(existingStatus.status_id)) {
      continue;
    }

    await trx('statuses')
      .where({
        tenant,
        board_id: boardId,
        status_id: existingStatus.status_id,
        status_type: 'ticket',
      })
      .update({
        name: `__tmp__${existingStatus.status_id}`,
        order_number: 100000 + index,
        is_default: false,
        ...(hasStatusColumn(columns, 'updated_at') ? { updated_at: now } : {}),
      });
  }

  if (deletedStatusIds.length > 0) {
    await trx('statuses')
      .where({
        tenant,
        board_id: boardId,
        status_type: 'ticket',
      })
      .whereIn('status_id', deletedStatusIds)
      .del();
  }

  for (const status of normalizedStatuses.filter((candidate) => candidate.status_id)) {
    await trx('statuses')
      .where({
        tenant,
        board_id: boardId,
        status_id: status.status_id,
        status_type: 'ticket',
      })
      .update({
        name: status.name,
        is_closed: status.is_closed,
        is_default: status.is_default,
        order_number: status.order_number,
        ...(hasStatusColumn(columns, 'color') ? { color: status.color } : {}),
        ...(hasStatusColumn(columns, 'icon') ? { icon: status.icon } : {}),
        ...(hasStatusColumn(columns, 'updated_at') ? { updated_at: now } : {}),
      });
  }

  const insertedStatuses = normalizedStatuses.filter((candidate) => !candidate.status_id);
  if (insertedStatuses.length > 0) {
    await trx('statuses').insert(
      insertedStatuses.map((status) => buildStatusInsertRow(columns, tenant, boardId, userId, now, status))
    );
  }

  return Status.getTicketStatusesByBoard(trx, tenant, boardId);
}

export async function saveBoardTicketStatusesForBoard(
  trx: Knex.Transaction,
  tenant: string,
  boardId: string,
  userId: string,
  statuses: BoardTicketStatusInput[]
): Promise<IStatus[]> {
  return persistBoardTicketStatuses(trx, tenant, boardId, userId, statuses);
}

export const getBoardTicketStatuses = withAuth(async (_user, { tenant }, boardId: string): Promise<IStatus[]> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await ensureBoardExists(trx, tenant, boardId);
    return Status.getTicketStatusesByBoard(trx, tenant, boardId);
  });
});

export const saveBoardTicketStatuses = withAuth(async (
  user,
  { tenant },
  boardId: string,
  statuses: BoardTicketStatusInput[]
): Promise<IStatus[]> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => (
    persistBoardTicketStatuses(trx, tenant, boardId, user.user_id, statuses)
  ));
});

export const createBoardTicketStatus = withAuth(async (
  user,
  { tenant },
  boardId: string,
  statusData: BoardTicketStatusInput
): Promise<IStatus> => {
  const { knex: db } = await createTenantKnex();
  const createdStatus = await withTransaction(db, async (trx: Knex.Transaction) => {
    const existingStatuses = await Status.getTicketStatusesByBoard(trx, tenant, boardId);
    const existingStatusIds = new Set(existingStatuses.map((status) => status.status_id));
    const nextStatuses: BoardTicketStatusInput[] = existingStatuses.map((status) => ({
      status_id: status.status_id,
      name: status.name,
      is_closed: status.is_closed,
      is_default: statusData.is_default ? false : Boolean(status.is_default),
      order_number: status.order_number,
      color: status.color ?? null,
      icon: status.icon ?? null,
    }));

    nextStatuses.push({
      ...statusData,
      is_default: statusData.is_default ?? existingStatuses.length === 0,
      order_number: statusData.order_number ?? ((existingStatuses.length + 1) * 10),
    });

    const savedStatuses = await persistBoardTicketStatuses(trx, tenant, boardId, user.user_id, nextStatuses);
    const created = savedStatuses.find((status) => !existingStatusIds.has(status.status_id));

    if (!created) {
      throw new Error('Failed to create board ticket status');
    }

    return created;
  });

  await publishStatusSearchEvent('STATUS_CREATED', tenant, createdStatus.status_id, boardId, user.user_id);
  return createdStatus;
});

export const updateBoardTicketStatus = withAuth(async (
  user,
  { tenant },
  boardId: string,
  statusId: string,
  statusData: Partial<BoardTicketStatusInput>
): Promise<IStatus> => {
  if (statusData.status_id && statusData.status_id !== statusId) {
    throw new Error('Ticket statuses cannot be moved or replaced implicitly.');
  }

  const nextBoardId = (statusData as Partial<IStatus>).board_id;
  if (nextBoardId && nextBoardId !== boardId) {
    throw new Error('Ticket statuses cannot be moved across boards implicitly.');
  }

  const nextStatusType = (statusData as Partial<IStatus>).status_type;
  if (nextStatusType && nextStatusType !== 'ticket') {
    throw new Error('Board ticket status actions only support ticket statuses.');
  }

  const { knex: db } = await createTenantKnex();
  const updatedStatus = await withTransaction(db, async (trx: Knex.Transaction) => {
    const existingStatuses = await Status.getTicketStatusesByBoard(trx, tenant, boardId);
    const currentStatus = existingStatuses.find((status) => status.status_id === statusId);

    if (!currentStatus) {
      throw new Error('Ticket status not found on the selected board.');
    }

    const nextStatuses = existingStatuses.map((status) => {
      if (status.status_id === statusId) {
        return {
          status_id: status.status_id,
          name: statusData.name ?? status.name,
          is_closed: statusData.is_closed ?? status.is_closed,
          is_default: statusData.is_default ?? Boolean(status.is_default),
          order_number: statusData.order_number ?? status.order_number,
          color: statusData.color ?? status.color ?? null,
          icon: statusData.icon ?? status.icon ?? null,
        };
      }

      return {
        status_id: status.status_id,
        name: status.name,
        is_closed: status.is_closed,
        is_default: statusData.is_default ? false : Boolean(status.is_default),
        order_number: status.order_number,
        color: status.color ?? null,
        icon: status.icon ?? null,
      };
    });

    const savedStatuses = await persistBoardTicketStatuses(trx, tenant, boardId, user.user_id, nextStatuses);
    const updated = savedStatuses.find((status) => status.status_id === statusId);

    if (!updated) {
      throw new Error('Failed to update board ticket status');
    }

    return updated;
  });

  await publishStatusSearchEvent('STATUS_UPDATED', tenant, updatedStatus.status_id, boardId, user.user_id);
  return updatedStatus;
});

export const deleteBoardTicketStatus = withAuth(async (
  user,
  { tenant },
  boardId: string,
  statusId: string
): Promise<IStatus[]> => {
  const { knex: db } = await createTenantKnex();
  const remainingStatuses = await withTransaction(db, async (trx: Knex.Transaction) => {
    const existingStatuses = await Status.getTicketStatusesByBoard(trx, tenant, boardId);
    if (!existingStatuses.some((status) => status.status_id === statusId)) {
      throw new Error('Ticket status not found on the selected board.');
    }

    const nextStatuses = existingStatuses
      .filter((status) => status.status_id !== statusId)
      .map((status) => ({
        status_id: status.status_id,
        name: status.name,
        is_closed: status.is_closed,
        is_default: Boolean(status.is_default),
        order_number: status.order_number,
        color: status.color ?? null,
        icon: status.icon ?? null,
      }));

    return persistBoardTicketStatuses(trx, tenant, boardId, user.user_id, nextStatuses);
  });

  await publishStatusSearchEvent('STATUS_DELETED', tenant, statusId, boardId, user.user_id);
  return remainingStatuses;
});
