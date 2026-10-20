import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

/**
 * The Time Entry page shows a manager flavour of the time sheet to anyone who leads a
 * team, which it learns from getTeams(). That read needs `user_settings:read`, which a
 * technician-only user does not hold, and the page used to answer the refusal with a bare
 * `return` — rendering `undefined`, i.e. the blank Time Entry screen in ticket
 * alga-2026-0002742. A refused or failed teams read means "not a manager", never no page.
 */

const getCurrentUserMock = vi.fn();
const getTeamsMock = vi.fn();

function TimeTrackingClientMock() {
  return null;
}

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: getTeamsMock,
  isTeamActionError: (value: unknown) =>
    Boolean(value && typeof value === 'object' && ('permissionError' in value || 'actionError' in value)),
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/TimeTrackingClient', () => ({
  default: TimeTrackingClientMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: async () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '' }),
}));

const { default: TimeTrackingPage } = await import('server/src/app/msp/time-entry/page');

const renderProps = async () => {
  const element = (await TimeTrackingPage()) as React.ReactElement<Record<string, unknown>>;
  expect(element?.type).toBe(TimeTrackingClientMock);
  return element.props;
};

describe('MSP time entry page manager check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });
  });

  it('renders the time sheet as non-manager when the teams read is refused', async () => {
    getTeamsMock.mockResolvedValue({ permissionError: 'Permission denied: cannot view teams.' });

    const props = await renderProps();

    expect(props.initialIsManager).toBe(false);
    expect(props.initialUser).toMatchObject({ user_id: 'user-1' });
  });

  it('renders the time sheet as non-manager when the teams read throws', async () => {
    getTeamsMock.mockRejectedValue(new Error('boom'));

    const props = await renderProps();

    expect(props.initialIsManager).toBe(false);
  });

  it('marks a team lead as manager', async () => {
    getTeamsMock.mockResolvedValue([
      { team_id: 'team-1', manager_id: 'user-2' },
      { team_id: 'team-2', manager_id: 'user-1' },
    ]);

    const props = await renderProps();

    expect(props.initialIsManager).toBe(true);
  });

  it('marks a plain member as non-manager', async () => {
    getTeamsMock.mockResolvedValue([{ team_id: 'team-1', manager_id: 'user-2' }]);

    const props = await renderProps();

    expect(props.initialIsManager).toBe(false);
  });

  it('skips the teams read when there is no signed-in user', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const props = await renderProps();

    expect(getTeamsMock).not.toHaveBeenCalled();
    expect(props.initialIsManager).toBe(false);
  });
});
