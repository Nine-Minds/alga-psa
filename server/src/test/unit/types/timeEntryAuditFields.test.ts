import { describe, expectTypeOf, it } from 'vitest';
import type { ITimeEntry } from '@alga-psa/types';

describe('ITimeEntry audit fields', () => {
  it('includes optional created_by/updated_by', () => {
    const entry: ITimeEntry = {
      tenant: '00000000-0000-0000-0000-000000000000',
      entry_id: null,
      created_by: '00000000-0000-0000-0000-000000000000',
      updated_by: null,
      work_item_id: '00000000-0000-0000-0000-000000000000',
      work_item_type: 'ticket',
      start_time: '2026-01-31T10:00:00Z',
      end_time: '2026-01-31T11:00:00Z',
      created_at: '2026-01-31T11:00:00Z',
      updated_at: '2026-01-31T11:00:00Z',
      billable_duration: 60,
      notes: '',
      user_id: '00000000-0000-0000-0000-000000000000',
      approval_status: 'DRAFT',
    };

    expectTypeOf(entry.created_by).toEqualTypeOf<string | null | undefined>();
    expectTypeOf(entry.updated_by).toEqualTypeOf<string | null | undefined>();
  });
});

