/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TeamList from '../../../components/settings/general/TeamList';
import { getAllUsers } from '@alga-psa/user-composition/actions/userQueryActions';

vi.mock('@alga-psa/teams/actions/team-actions/teamActions', () => ({
  createTeam: vi.fn(),
  deleteTeam: vi.fn(),
}));
vi.mock('@alga-psa/teams/actions/team-actions/avatarActions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getAllUsers: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));
vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({ preCheckDeletion: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  detectClientLocale: () => 'en',
}));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui', () => ({ DeleteEntityDialog: () => null }));

const LONG_DESCRIPTION =
  'Handles procurement for the vendor estate, the yellow brick road resurfacing programme and every balloon in the fleet';

const team = (description: string | null) => ({
  team_id: 'team-1',
  tenant: 'tenant-1',
  team_name: 'Service Desk',
  manager_id: 'user-lead',
  description,
  members: [],
});

describe('TeamList team description', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllUsers).mockResolvedValue([] as any);
  });
  afterEach(() => cleanup());

  it('shows a short description under the team name', () => {
    render(<TeamList teams={[team('Second-line support')] as any} onSelectTeam={vi.fn()} />);

    expect(screen.getByText('Second-line support')).toBeInTheDocument();
  });

  it('trims a long description and keeps the full text as a tooltip', () => {
    render(<TeamList teams={[team(LONG_DESCRIPTION)] as any} onSelectTeam={vi.fn()} />);

    const trimmed = screen.getByText(
      'Handles procurement for the vendor estate, the yellow brick road resurfacing pro…'
    );
    expect(trimmed).toHaveAttribute('title', LONG_DESCRIPTION);
    expect(screen.queryByText(LONG_DESCRIPTION)).not.toBeInTheDocument();
  });

  it('renders no description line when the team has none', () => {
    render(<TeamList teams={[team(null)] as any} onSelectTeam={vi.fn()} />);

    expect(screen.getByText('Service Desk')).toBeInTheDocument();
    expect(screen.queryByTitle(LONG_DESCRIPTION)).not.toBeInTheDocument();
  });
});
