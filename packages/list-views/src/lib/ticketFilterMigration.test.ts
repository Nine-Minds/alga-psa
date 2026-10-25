import { describe, expect, it } from 'vitest';
import {
  TICKET_FILTERS_SCHEMA_VERSION,
  applyTicketPathAliases,
  migrateTicketDefaultView,
  migrateTicketFilters,
} from './ticketFilterMigration';
import { getListViewDefinition, migrateListViewSettings } from './registry';

const TAG = '11111111-1111-4111-8111-111111111111';
const ids = new Map([['urgent', TAG]]);

describe('ticket filters v1 -> v2', () => {
  it('turns legacy tags text into a where clause on definition ids and drops the VIP keys', () => {
    const out = migrateTicketFilters({ tags: ['urgent'], requester_vip: true, client_vip: true, statusId: 's' }, 1, { tagIdsByText: ids });
    expect(out).toEqual({ statusId: 's', where: { join: 'and', clauses: [{ path: 'tags', operator: 'in', value: [TAG] }] } });
  });

  it('drops tag text that no longer names a definition, keeps it when no lookup was offered', () => {
    expect(migrateTicketFilters({ tags: ['gone'] }, 1, { tagIdsByText: ids })).toEqual({});
    expect(migrateTicketFilters({ tags: ['urgent'] }, 1)).toEqual({ tags: ['urgent'] });
  });

  it('leaves v2 documents alone and is idempotent', () => {
    const v2 = { where: { join: 'and', clauses: [{ path: 'contact.tags', operator: 'in', value: [TAG] }] }, tags: ['x'] };
    expect(migrateTicketFilters(v2, 2, { tagIdsByText: ids })).toEqual(v2);
  });

  it('registers version 2 and migrates through the registry, then passes the strict schema', () => {
    const def = getListViewDefinition('tickets')!;
    expect(def.schemaVersion).toBe(TICKET_FILTERS_SCHEMA_VERSION);
    const migrated = migrateListViewSettings(def, { filters: { tags: ['urgent'], client_vip: true } } as never, 1, { tagIdsByText: ids });
    expect(def.settingsSchema.safeParse(migrated).success).toBe(true);
    expect((migrated.filters as { where: unknown }).where).toBeDefined();
  });

  it('rejects nested groups in the strict schema', () => {
    const def = getListViewDefinition('tickets')!;
    const nested = { filters: { where: { join: 'and', clauses: [{ join: 'or', clauses: [] }] } } };
    expect(def.settingsSchema.safeParse(nested).success).toBe(false);
  });

  it('migrates board/tenant default documents on their own version field', () => {
    const out = migrateTicketDefaultView({ densityLevel: 50, filters: { tags: ['urgent'], requester_vip: true } }, { tagIdsByText: ids });
    expect(out.schemaVersion).toBe(2);
    expect((out.filters as Record<string, unknown>).requester_vip).toBeUndefined();
    expect(out.densityLevel).toBe(50);
  });

  it('applies the path alias map to stored where (named and default views)', () => {
    const where = { join: 'and', clauses: [{ path: 'old.path', operator: 'in', value: ['a'] }, { path: 'tags', operator: 'is_empty' }] };
    expect(applyTicketPathAliases(where, { 'old.path': 'contact.tags' })).toEqual({
      join: 'and',
      clauses: [{ path: 'contact.tags', operator: 'in', value: ['a'] }, { path: 'tags', operator: 'is_empty' }],
    });
  });
});
