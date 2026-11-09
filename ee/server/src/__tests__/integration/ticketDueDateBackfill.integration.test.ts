import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { backfillTicketDueDatesFromAttributes } = require('../../../../../server/migrations/20261109120000_backfill_ticket_due_date_from_attributes.cjs');

/** The backfill copies a valid attributes.due_date into the column, only where the column is empty. Rolled back per test. */
describe('ticket due_date backfill from attributes', () => {
  let db: Knex;
  beforeAll(async () => { db = await createTestDbConnection(); });
  afterAll(async () => { await db?.destroy(); });

  it('copies valid attribute dates, never overwrites a column, skips junk, and is idempotent', async () => {
    const tenant = String((await db('tenants').first('tenant')).tenant);
    const trx = await db.transaction();
    try {
      const clientId = uuidv4();
      await trx('clients').insert({ tenant, client_id: clientId, client_name: 'Backfill client', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' });
      const boardId = uuidv4();
      await trx('boards').insert({ tenant, board_id: boardId, board_name: 'B', display_order: 0 });
      const statusId = uuidv4();
      await trx('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
      const make = async (attributes: unknown, dueDate: string | null = null) => {
        const ticketId = uuidv4();
        await trx('tickets').insert({
          tenant, ticket_id: ticketId, ticket_number: `BF-${ticketId.slice(0, 8)}`, title: 't', board_id: boardId, status_id: statusId,
          client_id: clientId, entered_at: '2026-01-01T00:00:00Z', due_date: dueDate, attributes: attributes === null ? null : JSON.stringify(attributes),
        });
        return ticketId;
      };
      const valid = await make({ due_date: '2027-01-08T17:00:00.000Z', keep: 1 });
      const preset = await make({ due_date: '2027-02-01T00:00:00.000Z' }, '2026-12-25T10:00:00.000Z');
      const junk = await make({ due_date: 'soon' });
      const impossible = await make({ due_date: '2026-13-45T00:00:00Z' });
      const none = await make({ other: true });
      const nullAttrs = await make(null);

      const first = await backfillTicketDueDatesFromAttributes(trx, () => undefined);
      expect(first.copied).toBeGreaterThanOrEqual(1);
      const due = async (id: string) => (await trx('tickets').where({ tenant, ticket_id: id }).first('due_date', 'attributes'));
      expect(new Date((await due(valid)).due_date).toISOString()).toBe('2027-01-08T17:00:00.000Z');
      expect((await due(valid)).attributes).toMatchObject({ due_date: '2027-01-08T17:00:00.000Z', keep: 1 });
      expect(new Date((await due(preset)).due_date).toISOString()).toBe('2026-12-25T10:00:00.000Z');
      for (const id of [junk, impossible, none, nullAttrs]) expect((await due(id)).due_date).toBeNull();

      const second = await backfillTicketDueDatesFromAttributes(trx, () => undefined);
      expect(second.copied).toBe(0);
    } finally {
      await trx.rollback();
    }
  });
});
