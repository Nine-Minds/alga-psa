/* @vitest-environment jsdom */
/**
 * Ticket alga-2026-0003109: the saved filters must reach the server with the FIRST query.
 * The preference resolves in two stages (localStorage, then the authoritative server value),
 * and the cards sections mount before either; without the readiness gate each section fetched
 * with the defaults, flashed unfiltered rows, and refetched. Real dashboard, real cards view,
 * real sections and real activities cache — only the data boundary is mocked.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ActivityType } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  fetchActivities: vi.fn(),
  setSaved: vi.fn(),
  /** The saved preference this user comes back to (filled in beforeEach). */
  savedFilters: null as any,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/msp/user-activities',
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }),
}));
// Staged exactly like the real hook: stage 1 is the localStorage read (defaults here, as on a
// fresh device), stage 2 the server value that must be the one actually queried.
vi.mock('@alga-psa/user-composition/hooks', async () => {
  const React = await import('react');
  return {
    useUserPreference: (key: string, opts: any) => {
      const [stage, setStage] = React.useState(0);
      React.useEffect(() => {
        if (key !== 'activitiesTableFilters') return;
        const local = setTimeout(() => setStage(1), 0);
        const server = setTimeout(() => setStage(2), 20);
        return () => { clearTimeout(local); clearTimeout(server); };
      }, [key]);
      if (key === 'activitiesTableFilters') {
        return {
          value: stage === 2 ? mocks.savedFilters : opts.defaultValue,
          setValue: mocks.setSaved,
          hasLoadedInitial: stage >= 1,
          hasResolved: stage >= 2,
        };
      }
      // The view-mode preference (and any other): already settled on the cards view.
      return { value: 'cards', setValue: vi.fn(), hasLoadedInitial: true, hasResolved: true };
    },
  };
});
vi.mock('../actions/activityServerActions', () => ({ fetchActivities: mocks.fetchActivities }));
vi.mock('@alga-psa/user-activities/actions', () => ({ createAdHocActivity: vi.fn() }));
vi.mock('../hooks/useActivityFilterOptions', () => ({
  useActivityFilterOptions: () => ({
    priorities: [], clients: [], projects: [], boards: [], ticketStatuses: [], ticketTags: [], projectTaskTags: [],
  }),
}));
vi.mock('../hooks/useViewableUsers', () => ({
  useViewableUsers: () => ({ canViewOthers: false, viewableUsers: [] }),
}));
vi.mock('./ActivityDrawerProvider', () => ({ useActivityDrawer: () => ({ openActivityDrawer: vi.fn() }) }));
vi.mock('./NotificationsSection', () => ({ NotificationsSection: () => null }));
vi.mock('./ViewingUserPicker', () => ({ ViewingUserPicker: () => null }));
vi.mock('./ActivitiesDataTableSection', () => ({ ActivitiesDataTableSection: () => null }));
vi.mock('./filters/ActivitiesTableFilters', () => ({ ActivitiesTableFilters: () => null }));
vi.mock('./WorkflowTaskListDrawer', () => ({ WorkflowTaskListDrawer: () => null }));
vi.mock('./ActivityCard', () => ({
  TicketCard: () => null,
  ProjectTaskCard: () => null,
  ScheduleCard: () => null,
  WorkflowTaskCard: () => null,
}));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openListDrawer: vi.fn(), closeDrawer: vi.fn() }) }));
vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children, id }: any) => <div id={id}>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (p: any) => <input {...p} /> }));

import { UserActivitiesDashboard } from './UserActivitiesDashboard';

const CARD_TYPES = [ActivityType.SCHEDULE, ActivityType.TICKET, ActivityType.PROJECT_TASK, ActivityType.WORKFLOW_TASK];

beforeEach(() => {
  mocks.setSaved.mockReset();
  mocks.savedFilters = { types: CARD_TYPES, isClosed: false, clientId: 'client-7', ticketStatusIds: ['status-9'] };
  mocks.fetchActivities.mockReset().mockResolvedValue({ activities: [], totalCount: 0 });
});
afterEach(cleanup);

describe('UserActivitiesDashboard saved-filter hydration', () => {
  it('queries each cards section exactly once, with the saved filters and never with the defaults', async () => {
    render(<UserActivitiesDashboard />);

    // Stage 1 (localStorage) must not open the gate.
    await waitFor(() => expect(mocks.fetchActivities).not.toHaveBeenCalled());

    await waitFor(() => expect(mocks.fetchActivities).toHaveBeenCalledTimes(CARD_TYPES.length));
    // Let any late duplicate land before counting.
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.fetchActivities).toHaveBeenCalledTimes(CARD_TYPES.length);

    const calls = mocks.fetchActivities.mock.calls.map(([filters]: any[]) => filters);
    expect(calls.map((f) => f.types[0]).sort()).toEqual([...CARD_TYPES].sort());
    for (const filters of calls) {
      expect(filters.clientId).toBe('client-7');
      expect(filters.ticketStatusIds).toEqual(['status-9']);
    }
    expect(calls.some((f) => f.clientId === undefined)).toBe(false);
    expect(mocks.setSaved).not.toHaveBeenCalled();
  });
});
