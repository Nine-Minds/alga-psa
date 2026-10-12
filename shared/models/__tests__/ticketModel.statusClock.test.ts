import { describe, expect, it, vi } from 'vitest';
import { TicketModel } from '../ticketModel';

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => ({
    table: (name: string) => conn(name),
  }),
}));

const TICKET_ID = '11111111-1111-1111-1111-111111111111';
const BOARD_ID = '22222222-2222-2222-2222-222222222222';
const OLD_STATUS = '33333333-3333-3333-3333-333333333333';
const NEW_STATUS = '44444444-4444-4444-4444-444444444444';

function buildTrx() {
  const updates: Record<string, unknown>[] = [];
  const currentTicket = { ticket_id: TICKET_ID, board_id: BOARD_ID, status_id: OLD_STATUS, client_id: null, category_id: null };

  const trx: any = vi.fn((table: string) => {
    if (table === 'statuses') {
      return { where: () => ({ first: async () => ({ status_id: NEW_STATUS, board_id: BOARD_ID }) }) };
    }
    if (table === 'tickets') {
      return {
        where: () => ({
          first: async () => currentTicket,
          update: (data: Record<string, unknown>) => {
            updates.push(data);
            return { returning: async () => [{ ...currentTicket, ...data }] };
          },
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  trx.raw = vi.fn((sql: string, bindings: unknown[]) => ({ sql, bindings }));
  trx.fn = { now: () => 'NOW()' };
  return { trx, updates };
}

describe('TicketModel.updateTicket status clock', () => {
  it('adds the status_changed_at CASE patch when status_id is written', async () => {
    const { trx, updates } = buildTrx();

    await TicketModel.updateTicket(TICKET_ID, { status_id: NEW_STATUS }, 'tenant-1', trx);

    expect(updates).toHaveLength(1);
    expect(trx.raw).toHaveBeenCalledWith(expect.stringContaining('status_changed_at'), [NEW_STATUS]);
    expect(updates[0].status_changed_at).toEqual({
      sql: 'CASE WHEN status_id IS DISTINCT FROM ?::uuid THEN now() ELSE status_changed_at END',
      bindings: [NEW_STATUS],
    });
    expect(updates[0]).toMatchObject({ updated_at: 'NOW()', updated_by: null });
  });

  it('leaves status_changed_at out of updates that do not write status_id', async () => {
    const { trx, updates } = buildTrx();

    await TicketModel.updateTicket(TICKET_ID, { title: 'Renamed' }, 'tenant-1', trx);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ title: 'Renamed', updated_at: 'NOW()', updated_by: null });
    expect(updates[0]).not.toHaveProperty('status_changed_at');
    expect(trx.raw).not.toHaveBeenCalled();
  });
});
