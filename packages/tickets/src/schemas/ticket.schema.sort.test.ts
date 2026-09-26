// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { ticketListFiltersSchema } from './ticket.schema';

const NEW_SORT_KEYS = ['assigned_to_name', 'assigned_team_name', 'updated_at'] as const;

describe('ticketListFiltersSchema sortBy', () => {
  for (const sortBy of NEW_SORT_KEYS) {
    it(`accepts ${sortBy} in both directions`, () => {
      for (const sortDirection of ['asc', 'desc'] as const) {
        const parsed = ticketListFiltersSchema.safeParse({
          boardFilterState: 'active',
          sortBy,
          sortDirection,
        });
        expect(parsed.success).toBe(true);
      }
    });
  }

  it('still accepts the pre-existing sort keys', () => {
    const parsed = ticketListFiltersSchema.safeParse({
      boardFilterState: 'active',
      sortBy: 'entered_at',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown sort key instead of silently accepting it', () => {
    const parsed = ticketListFiltersSchema.safeParse({
      boardFilterState: 'active',
      sortBy: 'assigned_to_ids',
    });
    expect(parsed.success).toBe(false);
  });
});
