import { Knex } from 'knex';
import { ICountSession } from '@alga-psa/types';
import { assertLocationWritable } from './scope';

async function getCountSessionOrThrow(
  trx: Knex.Transaction,
  tenant: string,
  sessionId: string,
  forUpdate = false,
): Promise<ICountSession> {
  const q = trx('count_sessions').where({ tenant, session_id: sessionId });
  if (forUpdate) q.forUpdate();
  const row = await q.first();
  if (!row) throw new Error('Count session not found');
  return row as ICountSession;
}

async function inStockSerials(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  locationId: string,
): Promise<string[]> {
  const rows = await trx('stock_units')
    .where({ tenant, service_id: serviceId, location_id: locationId, status: 'in_stock' })
    .select('serial_number');
  return rows.map((row: { serial_number: string | null }) => row.serial_number).filter(Boolean) as string[];
}

export interface StartCountSessionInput {
  location_id: string;
  notes?: string | null;
}

/** Snapshot a location into a new in-progress cycle-count session. */
export async function startCountSessionCore(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  input: StartCountSessionInput,
): Promise<ICountSession> {
  if (!input.location_id) throw new Error('location_id is required');
  await assertLocationWritable(trx, tenant, userId, input.location_id);
  const location = await trx('stock_locations').where({ tenant, location_id: input.location_id }).first();
  if (!location) throw new Error('Stock location not found');

  const open = await trx('count_sessions')
    .where({ tenant, location_id: input.location_id })
    .whereIn('status', ['draft', 'in_progress', 'review'])
    .first();
  if (open) throw new Error('This location already has an open count session');

  const [session] = await trx('count_sessions')
    .insert({
      tenant,
      location_id: input.location_id,
      status: 'in_progress',
      created_by: userId,
      notes: input.notes ?? null,
    })
    .returning('*');

  const levels = (await trx('stock_levels as sl')
    .join('product_inventory_settings as pis', function () {
      this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
    })
    .where({ 'sl.tenant': tenant, 'sl.location_id': input.location_id, 'pis.track_stock': true })
    .select('sl.service_id', 'sl.quantity_on_hand', 'pis.is_serialized')) as Array<{
    service_id: string;
    quantity_on_hand: number;
    is_serialized: boolean;
  }>;

  for (const level of levels) {
    const serials = level.is_serialized
      ? await inStockSerials(trx, tenant, level.service_id, input.location_id)
      : null;
    await trx('count_lines').insert({
      tenant,
      session_id: (session as ICountSession).session_id,
      service_id: level.service_id,
      expected_qty: Number(level.quantity_on_hand),
      expected_serials: serials ? JSON.stringify(serials) : null,
    });
  }

  return session as ICountSession;
}

export interface RecordCountInput {
  session_id: string;
  service_id: string;
  counted_qty?: number;
  serials?: string[];
}

/** Record one blind count line in an existing in-progress session. */
export async function recordCountCore(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  input: RecordCountInput,
): Promise<{ recorded: boolean }> {
  const session = await getCountSessionOrThrow(trx, tenant, input.session_id, true);
  if (session.status !== 'in_progress') {
    throw new Error(`Counts can only be recorded on an in-progress session (current: ${session.status})`);
  }
  const line = await trx('count_lines')
    .where({ tenant, session_id: input.session_id, service_id: input.service_id })
    .first();
  if (!line) throw new Error('This product is not part of the count session');

  const isSerialized = line.expected_serials != null;
  let countedQty: number;
  let countedSerials: string[] | null = null;
  if (isSerialized) {
    countedSerials = [...new Set((input.serials ?? []).map((serial) => serial.trim()).filter(Boolean))];
    countedQty = countedSerials.length;
  } else {
    countedQty = Number(input.counted_qty);
    if (!Number.isInteger(countedQty) || countedQty < 0) {
      throw new Error('counted_qty must be a non-negative integer');
    }
  }

  await trx('count_lines')
    .where({ tenant, count_line_id: line.count_line_id })
    .update({
      counted_qty: countedQty,
      counted_serials: countedSerials ? JSON.stringify(countedSerials) : null,
      counted_at: trx.fn.now(),
      counted_by: userId,
      updated_at: trx.fn.now(),
    });
  return { recorded: true };
}

/** Move an in-progress count session to review. */
export async function submitCountForReviewCore(
  trx: Knex.Transaction,
  tenant: string,
  _userId: string,
  input: { session_id: string },
): Promise<ICountSession> {
  const session = await getCountSessionOrThrow(trx, tenant, input.session_id, true);
  if (session.status !== 'in_progress') {
    throw new Error(`Only an in-progress session can be submitted (current: ${session.status})`);
  }
  const [row] = await trx('count_sessions')
    .where({ tenant, session_id: input.session_id })
    .update({ status: 'review', submitted_at: trx.fn.now(), updated_at: trx.fn.now() })
    .returning('*');
  return row as ICountSession;
}

/** Discard a count session with no stock effect. Approved sessions cannot be cancelled. */
export async function cancelCountSessionCore(
  trx: Knex.Transaction,
  tenant: string,
  _userId: string,
  input: { session_id: string },
): Promise<ICountSession> {
  const session = await getCountSessionOrThrow(trx, tenant, input.session_id, true);
  if (session.status === 'approved') throw new Error('An approved session cannot be cancelled');
  if (session.status === 'cancelled') return session as ICountSession;
  const [row] = await trx('count_sessions')
    .where({ tenant, session_id: input.session_id })
    .update({ status: 'cancelled', updated_at: trx.fn.now() })
    .returning('*');
  return row as ICountSession;
}
