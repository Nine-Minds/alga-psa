import { describe, expect, it } from 'vitest';
import { evaluateEntryAccess, type CalendarAccess } from '../src/lib/calendarAccess';

describe('read-only review fixture access', () => {
  it('allows a separate viewer to open a shared entry without edit access', () => {
    const ownerId = '00000000-0000-4000-8000-000000000101';
    const viewerId = '00000000-0000-4000-8000-000000000102';
    const access: CalendarAccess = {
      viewerUserId: viewerId,
      canViewAll: false,
      userLevels: new Map([[ownerId, 'read']]),
      groupLevels: new Map(),
      hiddenCalendarIds: [],
    };

    expect(evaluateEntryAccess({
      assigned_user_ids: [ownerId],
      is_private: false,
      calendar_id: null,
      work_item_type: 'ad_hoc',
    }, access)).toEqual({ access: 'full', canEdit: false });
  });
});
