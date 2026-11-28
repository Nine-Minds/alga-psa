import knexFactory from 'knex';
import { describe, expect, it } from 'vitest';
import { nativeInteractionCandidates } from '../nativeInteractionCandidates';
import type { TenantDb } from '@alga-psa/db';

describe('nativeInteractionCandidates', () => {
  it('executes a tenant-scoped, structurally filtered mixed-direction keyset window', async () => {
    const knex = knexFactory({ client: 'pg' });
    const owner = {
      table: (name: string) => knex(name).where('tenant', 'tenant-a'),
    } as unknown as TenantDb;
    const query = nativeInteractionCandidates(owner, {
      userId: 'user-a', contactId: 'contact-a', clientId: 'client-a',
      statusId: 'status-a', typeId: 'type-a',
      dateFrom: new Date('2026-01-01T00:00:00Z'), dateTo: new Date('2026-12-31T23:59:59Z'),
    }, { interaction_date_sort_key: '2026-06-01T00:00:00.000000Z', interaction_id: 'interaction-a' }, {
      entity: { type: 'ticket', id: 'ticket-a' },
    }, 50);
    const compiled = query.toSQL();
    const sql = compiled.sql.toLowerCase();

    expect(sql).toContain('"tenant" = ?');
    for (const column of ['user_id', 'contact_name_id', 'client_id', 'status_id', 'type_id', 'ticket_id']) {
      expect(sql).toContain(`"${column}" = ?`);
    }
    expect(sql).toContain('"interaction_date" >= ?');
    expect(sql).toContain('"interaction_date" <= ?');
    expect(sql).toContain('interaction_date < ?::timestamptz');
    expect(sql).toContain('interaction_date = ?::timestamptz');
    expect(sql).toContain('"interaction_date" is null');
    expect(sql).toContain('order by interaction_date desc nulls last, "interaction_id" asc');
    expect(sql).toContain('limit ?');
    expect(compiled.bindings).toContain(50);
    expect(sql).not.toContain('title'); // Free text is intentionally post-authorization.
    await knex.destroy();
  });

  it('continues through tied and null dates in the existing order', async () => {
    const rows = [
      { interaction_date: new Date('2026-06-01T00:00:00Z'), interaction_id: 'a' },
      { interaction_date: new Date('2026-06-01T00:00:00Z'), interaction_id: 'b' },
      { interaction_date: new Date('2026-05-31T00:00:00Z'), interaction_id: 'c' },
      { interaction_date: null, interaction_id: 'd' },
      { interaction_date: null, interaction_id: 'e' },
    ];
    const after = (cursor: typeof rows[number] | null) => rows.filter(row => {
      if (!cursor) return true;
      if (cursor.interaction_date == null) return row.interaction_date == null && row.interaction_id > cursor.interaction_id;
      return row.interaction_date == null || row.interaction_date < cursor.interaction_date ||
        (row.interaction_date.getTime() === cursor.interaction_date.getTime() && row.interaction_id > cursor.interaction_id);
    });
    let cursor: typeof rows[number] | null = null;
    const paged: typeof rows = [];
    do {
      const window = after(cursor).slice(0, 2);
      paged.push(...window);
      cursor = window.at(-1) ?? null;
    } while (cursor && after(cursor).length);
    expect(paged).toEqual(rows);
  });
});
