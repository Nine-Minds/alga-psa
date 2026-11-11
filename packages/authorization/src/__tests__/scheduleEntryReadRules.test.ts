import { describe, expect, it } from 'vitest';
import { bundleRulesRestrict, type BundleNarrowingRule } from '../kernel';
import {
  CLIENTLESS_WORK_ITEM_TYPES,
  scheduleEntryReadRules,
  unreadableScheduleEntryIds,
  type ScheduleEntryReadScope,
} from '../scheduleEntryReadAuthorization';

const rule = (over: Partial<BundleNarrowingRule>): BundleNarrowingRule => ({
  id: 'r1', resource: 'ticket', action: 'read', ...over,
});

describe('scheduleEntryReadRules', () => {
  it('re-labels ticket:read client-scope rules to schedule_entry:read', () => {
    const [derived] = scheduleEntryReadRules([rule({ templateKey: 'client_portfolio', selectedClientIds: ['c1'] })]);
    expect(derived).toMatchObject({ resource: 'schedule_entry', action: 'read', templateKey: 'client_portfolio', selectedClientIds: ['c1'] });
  });

  it('neutralises ticket-only templates, constraints and redactions but keeps the rule', () => {
    const [derived] = scheduleEntryReadRules([
      rule({ templateKey: 'own_or_assigned', constraintKey: 'client_visible_only', redactedFields: ['title'] }),
    ]);
    expect(derived).toMatchObject({ resource: 'schedule_entry', templateKey: null, constraintKey: null });
    expect(derived.redactedFields).toBeUndefined();
  });

  it('leaves rules for other resources untouched so a closed bundle is still derived from the full set', () => {
    const other = rule({ resource: 'document', templateKey: 'selected_clients' });
    expect(scheduleEntryReadRules([other])).toEqual([other]);
  });

  it('is restricted by a client-scope ticket rule or a closed bundle, and by nothing else', () => {
    expect(bundleRulesRestrict(scheduleEntryReadRules([]), 'schedule_entry', 'read')).toBe(false);
    expect(bundleRulesRestrict(scheduleEntryReadRules([rule({ templateKey: 'client_portfolio' })]), 'schedule_entry', 'read')).toBe(true);
    expect(bundleRulesRestrict(scheduleEntryReadRules([rule({ resource: 'document', baseline: 'closed', bundleId: 'b' })]), 'schedule_entry', 'read')).toBe(true);
  });
});

describe('unreadableScheduleEntryIds', () => {
  const unrestricted = { tenant: 't', restricted: false } as unknown as ScheduleEntryReadScope;
  const restricted = { tenant: 't', restricted: true } as unknown as ScheduleEntryReadScope;
  const noDb = new Proxy({}, { get() { throw new Error('no query expected'); } }) as any;

  it('costs no query for an unrestricted reader', async () => {
    const ids = await unreadableScheduleEntryIds(noDb, unrestricted, [{ entry_id: 'e1', work_item_type: 'ticket', work_item_id: 'x' }]);
    expect(ids.size).toBe(0);
  });

  it('never narrows entries with no client by design, and costs no query for them', async () => {
    const entries = [
      { entry_id: 'a', work_item_type: null, work_item_id: null },
      ...CLIENTLESS_WORK_ITEM_TYPES.map((type, i) => ({ entry_id: `b${i}`, work_item_type: type, work_item_id: null })),
    ];
    expect((await unreadableScheduleEntryIds(noDb, restricted, entries)).size).toBe(0);
  });
});
