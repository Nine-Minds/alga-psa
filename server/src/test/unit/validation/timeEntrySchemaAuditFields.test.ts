import { describe, expect, it } from 'vitest';
import { timeEntrySchema } from '@alga-psa/scheduling/schemas/timeSheet.schemas';

describe('timeEntrySchema audit fields', () => {
  const base = {
    tenant: '00000000-0000-0000-0000-000000000000',
    entry_id: null,
    work_item_id: '00000000-0000-0000-0000-000000000000',
    work_item_type: 'ticket',
    start_time: '2026-01-31T10:00:00Z',
    end_time: '2026-01-31T11:00:00Z',
    created_at: '2026-01-31T11:00:00Z',
    updated_at: '2026-01-31T11:00:00Z',
    billable_duration: 60,
    notes: '',
    user_id: '00000000-0000-0000-0000-000000000000',
    time_sheet_id: '00000000-0000-0000-0000-000000000000',
    approval_status: 'DRAFT',
  } as const;

  it('parses without created_by/updated_by', () => {
    const parsed = timeEntrySchema.parse(base);
    expect(parsed.created_by).toBeUndefined();
    expect(parsed.updated_by).toBeUndefined();
  });

  it('parses with created_by/updated_by', () => {
    const parsed = timeEntrySchema.parse({
      ...base,
      created_by: '00000000-0000-0000-0000-000000000000',
      updated_by: null,
    });
    expect(parsed.created_by).toBeDefined();
    expect(parsed.updated_by).toBeNull();
  });
});

