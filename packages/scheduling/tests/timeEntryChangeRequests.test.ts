import { describe, expect, it } from 'vitest';
import {
  getProminentTimeEntryChangeRequest,
  getTimeEntryChangeRequestState,
} from '../src/lib/timeEntryChangeRequests';

describe('time entry change request selectors', () => {
  it('T007: chooses the most recent feedback as the prominent inline message', () => {
    const prominent = getProminentTimeEntryChangeRequest([
      {
        change_request_id: 'older',
        time_entry_id: 'entry-1',
        time_sheet_id: 'sheet-1',
        comment: 'Older note',
        created_at: '2026-03-10T09:00:00.000Z',
        created_by: 'manager-1',
        tenant: 'tenant-1',
      },
      {
        change_request_id: 'latest',
        time_entry_id: 'entry-1',
        time_sheet_id: 'sheet-1',
        comment: 'Latest note',
        created_at: '2026-03-11T09:00:00.000Z',
        created_by: 'manager-1',
        tenant: 'tenant-1',
      },
    ]);

    expect(prominent?.change_request_id).toBe('latest');
    expect(prominent?.comment).toBe('Latest note');
  });

  it('T026: updates the prominent feedback to a new review-cycle request after a handled cycle', () => {
    const state = getTimeEntryChangeRequestState([
      {
        change_request_id: 'handled-request',
        time_entry_id: 'entry-1',
        time_sheet_id: 'sheet-1',
        comment: 'First review cycle',
        created_at: '2026-03-10T09:00:00.000Z',
        created_by: 'manager-1',
        handled_at: '2026-03-10T12:00:00.000Z',
        handled_by: 'user-1',
        tenant: 'tenant-1',
      },
      {
        change_request_id: 'new-request',
        time_entry_id: 'entry-1',
        time_sheet_id: 'sheet-1',
        comment: 'Second review cycle',
        created_at: '2026-03-11T09:00:00.000Z',
        created_by: 'manager-1',
        tenant: 'tenant-1',
      },
    ]);

    const prominent = getProminentTimeEntryChangeRequest([
      {
        change_request_id: 'handled-request',
        time_entry_id: 'entry-1',
        time_sheet_id: 'sheet-1',
        comment: 'First review cycle',
        created_at: '2026-03-10T09:00:00.000Z',
        created_by: 'manager-1',
        handled_at: '2026-03-10T12:00:00.000Z',
        handled_by: 'user-1',
        tenant: 'tenant-1',
      },
      {
        change_request_id: 'new-request',
        time_entry_id: 'entry-1',
        time_sheet_id: 'sheet-1',
        comment: 'Second review cycle',
        created_at: '2026-03-11T09:00:00.000Z',
        created_by: 'manager-1',
        tenant: 'tenant-1',
      },
    ]);

    expect(state).toBe('unresolved');
    expect(prominent?.change_request_id).toBe('new-request');
  });

  it('keeps the entry unresolved while any older feedback remains open', () => {
    const state = getTimeEntryChangeRequestState([
      {
        change_request_id: 'latest-handled',
        time_entry_id: 'entry-1',
        time_sheet_id: 'sheet-1',
        comment: 'Latest review cycle was handled.',
        created_at: '2026-03-12T09:00:00.000Z',
        created_by: 'manager-1',
        handled_at: '2026-03-12T12:00:00.000Z',
        handled_by: 'user-1',
        tenant: 'tenant-1',
      },
      {
        change_request_id: 'older-unresolved',
        time_entry_id: 'entry-1',
        time_sheet_id: 'sheet-1',
        comment: 'An older request is still unresolved.',
        created_at: '2026-03-11T09:00:00.000Z',
        created_by: 'manager-1',
        tenant: 'tenant-1',
      },
    ]);

    expect(state).toBe('unresolved');
  });
});
