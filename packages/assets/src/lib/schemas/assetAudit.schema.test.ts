import { describe, expect, it } from 'vitest';
import { assetAuditListFiltersSchema } from './assetAudit.schema';
import { dayRangeBounds } from '../audits/dayRange';

/**
 * The list filters guard the SQL comparison behind `started_at`: the date range
 * has to be as strictly typed here as in the v1 query schema, so a malformed
 * value is refused by the action instead of reaching the database.
 */
describe('assetAuditListFiltersSchema', () => {
  it('accepts the day boundaries the list page computes', () => {
    const bounds = dayRangeBounds({ from: new Date(2026, 2, 1), to: new Date(2026, 2, 31) });

    const parsed = assetAuditListFiltersSchema.parse({ page: 1, limit: 25, ...bounds });

    expect(parsed.started_from).toBe(bounds.started_from);
    expect(parsed.started_to).toBe(bounds.started_to);
  });

  it('accepts an instant with an explicit offset', () => {
    expect(
      assetAuditListFiltersSchema.parse({ started_from: '2026-03-01T00:00:00+02:00' }).started_from,
    ).toBe('2026-03-01T00:00:00+02:00');
  });

  it.each(['2026-03-01', 'yesterday', '', '2026-13-01T00:00:00.000Z'])(
    'refuses %o instead of passing it to the query',
    (value) => {
      expect(() => assetAuditListFiltersSchema.parse({ started_from: value })).toThrow();
      expect(() => assetAuditListFiltersSchema.parse({ started_to: value })).toThrow();
    },
  );
});
