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

  it('keeps legacy tags text untouched when no lookup was offered (the codec resolves it at query time)', () => {
    expect(migrateTicketFilters({ tags: ['urgent'] }, 1)).toEqual({ tags: ['urgent'] });
  });

  it('emits a match-nothing clause when tag texts exist but none resolve, never widening the view', () => {
    const out = migrateTicketFilters({ tags: ['gone', 'also-gone'], statusId: 's' }, 1, { tagIdsByText: ids });
    expect(out).toEqual({ statusId: 's', where: { join: 'and', clauses: [{ path: 'tags', operator: 'in', value: [] }] } });
    const def = getListViewDefinition('tickets')!;
    expect(def.settingsSchema.safeParse({ filters: out }).success).toBe(true);
  });

  it('keeps only the resolved ids on partial resolution', () => {
    const out = migrateTicketFilters({ tags: ['urgent', 'gone'] }, 1, { tagIdsByText: ids });
    expect(out).toEqual({ where: { join: 'and', clauses: [{ path: 'tags', operator: 'in', value: [TAG] }] } });
  });

  it('keeps existing where clauses alongside the new tag clause', () => {
    const existing = { path: 'board_id', operator: 'in', value: ['b1'] };
    const resolved = migrateTicketFilters({ tags: ['urgent'], where: { join: 'and', clauses: [existing] } }, 1, { tagIdsByText: ids });
    expect(resolved?.where).toEqual({ join: 'and', clauses: [existing, { path: 'tags', operator: 'in', value: [TAG] }] });
    const none = migrateTicketFilters({ tags: ['gone'], where: { join: 'and', clauses: [existing] } }, 1, { tagIdsByText: ids });
    expect(none?.where).toEqual({ join: 'and', clauses: [existing, { path: 'tags', operator: 'in', value: [] }] });
  });

  it('leaves v2 documents alone and is idempotent', () => {
    const v2 = { where: { join: 'and', clauses: [{ path: 'contact.tags', operator: 'in', value: [TAG] }] }, tags: ['x'] };
    expect(migrateTicketFilters(v2, 2, { tagIdsByText: ids })).toEqual(v2);
  });

  it('registers the current version and migrates through the registry, then passes the strict schema', () => {
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
    expect(out.schemaVersion).toBe(TICKET_FILTERS_SCHEMA_VERSION);
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

describe('ticket filters v2 -> v3 (clientId folds into where)', () => {
  const C1 = '33333333-3333-4333-8333-333333333333';
  const C2 = '44444444-4444-4444-8444-444444444444';
  const clientRow = (operator: string, ...value: string[]) => ({ path: 'client.id', operator, value });

  it('is version 3', () => expect(TICKET_FILTERS_SCHEMA_VERSION).toBe(3));

  it('moves a string clientId into an in-row and deletes it', () => {
    expect(migrateTicketFilters({ clientId: C1, statusId: 's' }, 2)).toEqual({
      statusId: 's',
      where: { join: 'and', clauses: [clientRow('in', C1)] },
    });
  });

  it('keeps existing where clauses and appends the row', () => {
    const other = { path: 'tags', operator: 'is_empty' };
    expect(migrateTicketFilters({ clientId: C1, where: { join: 'and', clauses: [other] } }, 2)?.where).toEqual({
      join: 'and',
      clauses: [other, clientRow('in', C1)],
    });
  });

  it('lets an existing client.id in/not_in row win and drops clientId', () => {
    for (const operator of ['in', 'not_in']) {
      const where = { join: 'and', clauses: [clientRow(operator, C2)] };
      expect(migrateTicketFilters({ clientId: C1, where }, 2)).toEqual({ where });
    }
  });

  it('is idempotent and leaves v3 input unchanged', () => {
    const once = migrateTicketFilters({ clientId: C1 }, 2);
    expect(migrateTicketFilters(once, 2)).toEqual(once);
    const v3 = { where: { join: 'and', clauses: [clientRow('not_in', C1)] } };
    expect(migrateTicketFilters(v3, 3)).toEqual(v3);
  });

  it('never throws on odd input', () => {
    expect(migrateTicketFilters({ clientId: 42 as never }, 2)).toEqual({ clientId: 42 });
    expect(migrateTicketFilters({ clientId: '' }, 2)).toEqual({});
    expect(() => migrateTicketFilters({ clientId: C1, where: 'nope' as never }, 2)).not.toThrow();
    expect(migrateTicketFilters(undefined, 2)).toBeUndefined();
  });

  it('upgrades a stored default-view document to v3 with the row', () => {
    const out = migrateTicketDefaultView({ schemaVersion: 2, filters: { clientId: C1 } });
    expect(out.schemaVersion).toBe(3);
    expect(out.filters).toEqual({ where: { join: 'and', clauses: [clientRow('in', C1)] } });
  });

  it('upgrades a named view stored at v2 through the registry', () => {
    const def = getListViewDefinition('tickets')!;
    const migrated = migrateListViewSettings(def, { filters: { clientId: C1 } } as never, 2);
    expect(migrated.filters).toEqual({ where: { join: 'and', clauses: [clientRow('in', C1)] } });
    expect(def.settingsSchema.safeParse(migrated).success).toBe(true);
  });
});
