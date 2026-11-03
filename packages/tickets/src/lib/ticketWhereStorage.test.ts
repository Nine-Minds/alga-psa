import { describe, expect, it } from 'vitest';
import { hasTicketViewFilterParams } from './boardTabs';
import { parseReturnFilters } from './ticketFilterUtils';
import { sanitizeStoredTicketView, validateCapturedFilters, captureTicketViewSettings } from './ticketViewSettings';
import { sanitizeTicketListView } from './ticketListViewAdapter';
import { encodeTicketWhere } from './ticketWhereUrl';
import { parseTicketViewSettings } from '../actions/board-actions/boardViewSettingsSchema';
import type { PredicateGroup } from '@alga-psa/predicates';

const LIVE = '11111111-1111-4111-8111-111111111111';
const DEAD = '22222222-2222-4222-8222-222222222222';
const where: PredicateGroup = {
  join: 'and',
  clauses: [
    { path: 'contact.tags', operator: 'in', value: [LIVE, DEAD] },
    { path: 'client.tags', operator: 'not_in', value: [DEAD] },
  ],
};

describe('where in stored views (sanitize / validate)', () => {
  it('sanitizeStoredTicketView keeps a valid where and migrates a v1 default (VIP keys dropped)', () => {
    const out = sanitizeStoredTicketView({ filters: { where, requester_vip: true, tags: ['x'] } });
    expect(out?.filters?.where).toEqual(where);
    expect((out?.filters as Record<string, unknown>).requester_vip).toBeUndefined();
    expect(out?.schemaVersion).toBe(2);
  });

  it('sanitizeStoredTicketView drops malformed clauses and nested groups', () => {
    const out = sanitizeStoredTicketView({
      filters: { where: { join: 'and', clauses: [{ path: 'nope', operator: 'in', value: ['a'] }, { join: 'or', clauses: [] }, where.clauses[0]] } },
    });
    expect(out?.filters?.where?.clauses).toHaveLength(1);
  });

  it('applies the alias-free path as a contract: unknown path is dropped, not guessed', () => {
    expect(sanitizeStoredTicketView({ filters: { where: { join: 'and', clauses: [{ path: 'requester.tags', operator: 'in', value: ['a'] }] } } })?.filters?.where).toBeUndefined();
  });

  it('validateCapturedFilters drops deleted tag ids, and clauses left empty', () => {
    const out = validateCapturedFilters({ where }, { whereTagIds: { 'contact.tags': new Set([LIVE]), 'client.tags': new Set([LIVE]) } });
    expect(out.where?.clauses).toEqual([{ path: 'contact.tags', operator: 'in', value: [LIVE] }]);
  });

  it('adapter sanitize reports dropped tag ids through the collector', () => {
    const { settings, dropped } = sanitizeTicketListView(
      { filters: { where } } as never,
      { whereTagIds: { 'contact.tags': new Set([LIVE]), 'client.tags': new Set([LIVE]) } },
    );
    expect(settings.filters?.where?.clauses).toHaveLength(1);
    expect(dropped).toEqual(expect.arrayContaining([{ field: 'contact.tags', count: 1 }, { field: 'client.tags', count: 1 }]));
  });

  it('an unknown universe keeps the clause (cannot validate is not drop)', () => {
    const { settings, dropped } = sanitizeTicketListView({ filters: { where } } as never, {});
    expect(settings.filters?.where).toEqual(where);
    expect(dropped).toEqual([]);
  });

  it('capture stamps the current version and skips an empty where; the write schema accepts it', () => {
    const captured = captureTicketViewSettings({ filters: { where, tags: [] } });
    expect(captured.schemaVersion).toBe(2);
    expect(parseTicketViewSettings(captured).filters?.where).toEqual(where);
    expect(captureTicketViewSettings({ filters: { where: { join: 'and', clauses: [] } } }).filters).toEqual({});
  });

  it('the write schema rejects nested groups', () => {
    expect(() => parseTicketViewSettings({ filters: { where: { join: 'and', clauses: [{ join: 'or', clauses: [] }] } } })).toThrow();
  });
});

describe('where in URLs', () => {
  it('a where-only URL outranks the board default', () => {
    expect(hasTicketViewFilterParams(`?where=${encodeURIComponent(encodeTicketWhere(where))}`)).toBe(true);
  });

  it('parseReturnFilters (prev/next) restores where; garbage is dropped', () => {
    const query = new URLSearchParams({ where: encodeTicketWhere(where) }).toString();
    expect(parseReturnFilters(encodeURIComponent(query)).where).toEqual(where);
    expect(parseReturnFilters(encodeURIComponent('where=v9:x')).where).toBeUndefined();
  });
});
