/* @vitest-environment jsdom */
/**
 * Regression: once the deep-linked row is highlighted, the dashboard strips ?activity= from the
 * URL. That replace MUST pass { scroll: false }, otherwise Next scrolls to the top and the
 * highlighted row leaves the viewport.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  router: null as any,
  // Stable instance, like Next's useSearchParams between renders.
  params: new URLSearchParams('activity=ticket:abc-123&foo=bar'),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.params,
  useRouter: () => (mocks.router ??= { replace: mocks.replace, push: vi.fn() }),
  usePathname: () => '/msp/user-activities',
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }),
}));
vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: (_k: string, opts: any) => ({
    value: opts.defaultValue,
    setValue: vi.fn(),
    hasLoadedInitial: true,
  }),
}));
vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({ default: () => null }));
vi.mock('./ScheduleSection', () => ({ ScheduleSection: () => null }));
vi.mock('./TicketsSection', () => ({ TicketsSection: () => null }));
vi.mock('./ProjectsSection', () => ({ ProjectsSection: () => null }));
vi.mock('./WorkflowTasksSection', () => ({ WorkflowTasksSection: () => null }));
vi.mock('./NotificationsSection', () => ({ NotificationsSection: () => null }));
vi.mock('./ActivitiesDataTableSection', () => ({
  ActivitiesDataTableSection: (props: any) => {
    const { focusActivityKey, onFocusConsumed } = props;
    React.useEffect(() => {
      if (focusActivityKey) onFocusConsumed();
    }, [focusActivityKey, onFocusConsumed]);
    return null;
  },
}));

import { UserActivitiesDashboard } from './UserActivitiesDashboard';

describe('UserActivitiesDashboard focus cleanup', () => {
  afterEach(() => {
    cleanup();
    mocks.replace.mockClear();
  });

  it('removes ?activity= via router.replace with { scroll: false }', () => {
    render(<UserActivitiesDashboard />);
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/msp/user-activities?foo=bar', { scroll: false });
  });
});
