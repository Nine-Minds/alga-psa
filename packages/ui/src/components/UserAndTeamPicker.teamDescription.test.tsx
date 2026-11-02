/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import UserAndTeamPicker from './UserAndTeamPicker';
import MultiUserAndTeamPicker from './MultiUserAndTeamPicker';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) =>
      (typeof options === 'string' ? options : options?.defaultValue) ?? key,
  }),
}));

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const LONG_DESCRIPTION =
  'Handles procurement for the vendor estate, the yellow brick road resurfacing programme and every balloon in the fleet';
const SHORT_DESCRIPTION = 'Handles procurement';

const users = [
  {
    user_id: 'user-1',
    username: 'dorothy',
    first_name: 'Dorothy',
    last_name: 'Gale',
    user_type: 'internal',
    is_inactive: false,
    tenant: 't',
  },
] as any[];

const makeTeams = (description: string) =>
  [
    {
      team_id: 'team-1',
      team_name: 'Emerald Desk',
      manager_id: 'user-1',
      description,
      members: [],
      tenant: 't',
    },
  ] as any[];

const getUserAvatars = vi.fn(async () => new Map<string, string | null>());
const getTeamAvatars = vi.fn(async () => new Map<string, string | null>());

const openDropdown = async (triggerId: string) => {
  await act(async () => {
    fireEvent.click(document.getElementById(triggerId) as HTMLElement);
  });
  await act(async () => {
    vi.advanceTimersByTime(20);
  });
};

// jsdom has no layout, so `truncate` can never clip anything here: the row text
// itself has to come back trimmed.
const descriptionRow = (description: string): HTMLElement =>
  screen.getByTitle(description);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('team description in the team pickers', () => {
  it('trims a long description on a UserAndTeamPicker row and keeps the full text as a tooltip', async () => {
    vi.useFakeTimers();
    render(
      <UserAndTeamPicker
        id="assign-to"
        value=""
        onValueChange={vi.fn()}
        onTeamSelect={vi.fn()}
        users={users}
        teams={makeTeams(LONG_DESCRIPTION)}
        getUserAvatarUrlsBatch={getUserAvatars as any}
        getTeamAvatarUrlsBatch={getTeamAvatars as any}
      />
    );

    await openDropdown('assign-to');

    const row = descriptionRow(LONG_DESCRIPTION);
    expect(row.textContent).toBe(
      'Handles procurement for the vendor estate, the yellow brick road resurfacing pro…'
    );
    expect(row.textContent).not.toBe(LONG_DESCRIPTION);
    expect(screen.queryByText(LONG_DESCRIPTION)).toBeNull();
  });

  it('leaves a short description alone', async () => {
    vi.useFakeTimers();
    render(
      <UserAndTeamPicker
        id="assign-to"
        value=""
        onValueChange={vi.fn()}
        onTeamSelect={vi.fn()}
        users={users}
        teams={makeTeams(SHORT_DESCRIPTION)}
        getUserAvatarUrlsBatch={getUserAvatars as any}
        getTeamAvatarUrlsBatch={getTeamAvatars as any}
      />
    );

    await openDropdown('assign-to');

    expect(descriptionRow(SHORT_DESCRIPTION).textContent).toBe(SHORT_DESCRIPTION);
  });

  it('trims a long description on a MultiUserAndTeamPicker row too', async () => {
    vi.useFakeTimers();
    render(
      <MultiUserAndTeamPicker
        id="additional-agents"
        values={[]}
        onValuesChange={vi.fn()}
        users={users}
        teams={makeTeams(LONG_DESCRIPTION)}
        getUserAvatarUrlsBatch={getUserAvatars as any}
        getTeamAvatarUrlsBatch={getTeamAvatars as any}
      />
    );

    await openDropdown('additional-agents');

    const row = descriptionRow(LONG_DESCRIPTION);
    expect(row.textContent?.endsWith('…')).toBe(true);
    expect(row.textContent?.length).toBeLessThan(LONG_DESCRIPTION.length);
    expect(screen.queryByText(LONG_DESCRIPTION)).toBeNull();
  });
});
