import { describe, expect, it } from 'vitest';
import { ticketUpdateStamp } from '../ticketUpdateStamp';

describe('ticketUpdateStamp', () => {
  const NOW = Symbol('now');
  const knex = { fn: { now: () => NOW } } as any;

  it('returns the DB now() and the given actor', () => {
    expect(ticketUpdateStamp(knex, 'user-1')).toEqual({ updated_at: NOW, updated_by: 'user-1' });
  });

  it('passes null through so system writes clear the previous editor', () => {
    const stamp = ticketUpdateStamp(knex, null);
    expect(stamp.updated_by).toBeNull();
    expect('updated_by' in stamp).toBe(true);
  });
});
