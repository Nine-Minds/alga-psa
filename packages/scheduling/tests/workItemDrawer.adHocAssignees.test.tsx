/**
 * @vitest-environment jsdom
 */
/**
 * Regression for issue #3682: opening someone else's ad-hoc entry from the time
 * sheet seeded EntryPopup with the *viewer* instead of the entry's assignees
 * (fetchWorkItemsForTimeSheet never selects `users`, so the old
 * `workItem.users`-based fallback always won). Saving without edits then
 * reassigned the entry — silent data loss. The drawer must seed from the
 * authoritative assignees it already fetched via getWorkItemById, and fall back
 * to the viewer only for entries with genuinely no assignees (which EntryPopup's
 * "At least one assigned user" validation requires).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkItemDrawer } from '../src/components/time-management/time-entry/time-sheet/WorkItemDrawer';
import { SchedulingCrossFeatureProvider } from '../src/context/SchedulingCrossFeatureContext';

const { getWorkItemById, getCurrentUser, getAllUsersBasic, entryPopupProps } = vi.hoisted(() => ({
  getWorkItemById: vi.fn(),
  getCurrentUser: vi.fn(),
  getAllUsersBasic: vi.fn(),
  entryPopupProps: [] as any[],
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  getWorkItemById,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser,
  getAllUsersBasic,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, any>) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? key),
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  getErrorMessage: (value: unknown) => String(value),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

// Capturing EntryPopup's props is the whole point: the defect lives in the
// `event` the drawer hands it, before any user interaction.
vi.mock('../src/components/schedule/EntryPopup', () => ({
  default: (props: any) => {
    entryPopupProps.push(props);
    return <div data-testid="entry-popup" />;
  },
}));

const crossFeature = {
  renderTicketDetails: () => null,
  renderInteractionDetails: () => null,
  renderTaskEdit: () => null,
  getConsolidatedTicketData: vi.fn(),
  getInteractionById: vi.fn(),
  getTaskById: vi.fn(),
  getProjectPhase: vi.fn(),
  getProjectMetadata: vi.fn(),
  getProjectTreeData: vi.fn(),
} as any;

// Exactly the shape fetchWorkItemsForTimeSheet returns for ad-hoc rows: no
// `users`, no assignees.
const AD_HOC_WORK_ITEM = {
  work_item_id: 'entry-1',
  type: 'ad_hoc' as const,
  name: 'On-call sweep',
  description: '',
};

const adHocDetails = (assigned_user_ids: string[] | null | undefined) => ({
  work_item_id: 'entry-1',
  type: 'ad_hoc' as const,
  name: 'On-call sweep',
  description: 'notes',
  scheduled_start: '2026-10-13T10:00:00.000Z',
  scheduled_end: '2026-10-13T11:00:00.000Z',
  assigned_user_ids,
});

async function renderDrawer() {
  render(
    <SchedulingCrossFeatureProvider value={crossFeature}>
      <WorkItemDrawer
        workItem={AD_HOC_WORK_ITEM as any}
        onClose={() => {}}
        onTaskUpdate={async () => {}}
        onScheduleUpdate={async () => {}}
      />
    </SchedulingCrossFeatureProvider>
  );

  await screen.findByTestId('entry-popup');
  return entryPopupProps.at(-1);
}

describe('WorkItemDrawer ad-hoc assignees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entryPopupProps.length = 0;
    getCurrentUser.mockResolvedValue({ user_id: 'user-A' });
    getAllUsersBasic.mockResolvedValue([
      { user_id: 'user-A', first_name: 'Ada', last_name: 'Viewer' },
      { user_id: 'user-B', first_name: 'Boq', last_name: 'Owner' },
    ]);
  });

  it("seeds the entry's own assignees, not the viewer", async () => {
    getWorkItemById.mockResolvedValue(adHocDetails(['user-B']));

    const props = await renderDrawer();

    expect(getWorkItemById).toHaveBeenCalledWith('entry-1', 'ad_hoc');
    expect(props.event.assigned_user_ids).toEqual(['user-B']);
  });

  it('keeps every assignee of a multi-assignee entry', async () => {
    getWorkItemById.mockResolvedValue(adHocDetails(['user-B', 'user-A']));

    const props = await renderDrawer();

    expect(props.event.assigned_user_ids).toEqual(['user-B', 'user-A']);
  });

  it('falls back to the viewer when the entry has no assignees', async () => {
    getWorkItemById.mockResolvedValue(adHocDetails([]));

    const props = await renderDrawer();

    expect(props.event.assigned_user_ids).toEqual(['user-A']);
  });

  it('falls back to the viewer when the assignee aggregate is NULL', async () => {
    // array_agg over the left-joined schedule_entry_assignees yields SQL NULL
    // when the entry has no assignee rows.
    getWorkItemById.mockResolvedValue(adHocDetails(null));

    const props = await renderDrawer();

    expect(props.event.assigned_user_ids).toEqual(['user-A']);
  });
});
