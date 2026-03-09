import { describe, expect, it } from 'vitest';
import { createTimeEntrySchema, startTimeTrackingSchema, updateTimeEntrySchema } from '../../../lib/api/schemas/timeEntry';
import { saveTimeEntryParamsSchema } from '../../../../../packages/scheduling/src/actions/timeEntrySchemas';

describe('time entry service requirement validation', () => {
  const baseCreatePayload = {
    work_item_id: '00000000-0000-0000-0000-000000000000',
    work_item_type: 'ticket',
    start_time: '2026-03-08T10:00:00Z',
    end_time: '2026-03-08T11:00:00Z',
    notes: 'Test entry',
    is_billable: true,
  } as const;

  const baseSavePayload = {
    tenant: '00000000-0000-0000-0000-000000000000',
    entry_id: null,
    work_item_id: '00000000-0000-0000-0000-000000000000',
    work_item_type: 'ticket',
    start_time: '2026-03-08T10:00:00Z',
    end_time: '2026-03-08T11:00:00Z',
    created_at: '2026-03-08T11:00:00Z',
    updated_at: '2026-03-08T11:00:00Z',
    billable_duration: 60,
    notes: '',
    user_id: '00000000-0000-0000-0000-000000000000',
    time_sheet_id: '00000000-0000-0000-0000-000000000000',
    approval_status: 'DRAFT',
  } as const;

  it('rejects API time entry creation without service_id', () => {
    const result = createTimeEntrySchema.safeParse(baseCreatePayload);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(issue => issue.path[0] === 'service_id')).toBe(true);
  });

  it('rejects scheduling time entry saves without service_id', () => {
    const result = saveTimeEntryParamsSchema.safeParse(baseSavePayload);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(issue => issue.path[0] === 'service_id')).toBe(true);
  });

  it('rejects clearing service_id during API time entry updates', () => {
    const result = updateTimeEntrySchema.safeParse({
      service_id: '',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(issue => issue.path[0] === 'service_id')).toBe(true);
  });

  it('rejects starting time tracking without service_id', () => {
    const result = startTimeTrackingSchema.safeParse({
      work_item_id: '00000000-0000-0000-0000-000000000000',
      work_item_type: 'ticket',
      notes: 'Track time',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(issue => issue.path[0] === 'service_id')).toBe(true);
  });
});
