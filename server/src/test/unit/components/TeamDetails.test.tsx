/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TeamDetails from '../../../components/settings/general/TeamDetails';
import { getTeamById, saveTeamChanges, updateTeam } from '@alga-psa/teams/actions/team-actions/teamActions';
import { getAllUsers } from '@alga-psa/user-composition/actions/userQueryActions';

vi.mock('@alga-psa/teams/actions/team-actions/teamActions', () => ({
  getTeamById: vi.fn(),
  updateTeam: vi.fn(),
  saveTeamChanges: vi.fn(),
}));
vi.mock('@alga-psa/teams/actions/team-actions/avatarActions', () => ({
  uploadTeamAvatar: vi.fn(),
  deleteTeamAvatar: vi.fn(),
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getAllUsers: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  detectClientLocale: () => 'en',
}));
// The real picker is a popover; a stub that exposes "clear" and "pick" keeps this about TeamDetails.
vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  default: (props: { id: string; value: string; onValueChange: (v: string) => void }) => (
    <div>
      <button id={`${props.id}-clear`} onClick={() => props.onValueChange('')}>{`${props.id}:clear`}</button>
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/EntityImageUpload', () => ({ default: () => null }));

const TEAM = {
  team_id: 'team-1',
  tenant: 'tenant-1',
  team_name: 'Service Desk',
  manager_id: 'user-lead',
  members: [
    { user_id: 'user-lead', first_name: 'Lee', last_name: 'Lead', email: 'lee@example.com', role: 'lead', roles: [] },
    { user_id: 'user-b', first_name: 'Bea', last_name: 'Member', email: 'bea@example.com', role: 'member', roles: [] },
  ],
};

async function renderLoaded() {
  render(<TeamDetails teamId="team-1" onUpdate={vi.fn()} />);
  await screen.findByText('Service Desk');
}

function mockTeam(team: Record<string, unknown> = TEAM) {
  vi.mocked(getTeamById).mockResolvedValue(team as any);
}

describe('TeamDetails "Not assigned" lead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeam();
    vi.mocked(getAllUsers).mockResolvedValue([
      { user_id: 'user-lead', first_name: 'Lee', last_name: 'Lead', email: 'lee@example.com', is_inactive: false, roles: [] },
      { user_id: 'user-b', first_name: 'Bea', last_name: 'Member', email: 'bea@example.com', is_inactive: false, roles: [] },
    ] as any);
  });
  afterEach(() => cleanup());

  it('sends managerId: null when the lead is set to Not Assigned', async () => {
    vi.mocked(saveTeamChanges).mockResolvedValue({ ...TEAM, manager_id: null } as any);
    await renderLoaded();

    fireEvent.click(screen.getByText('team-lead-picker:clear'));
    fireEvent.click(await screen.findByText('teams.details.actions.saveChanges'));

    await waitFor(() => expect(saveTeamChanges).toHaveBeenCalledTimes(1));
    expect(saveTeamChanges).toHaveBeenCalledWith('team-1', { managerId: null, removeUserIds: [], addUserIds: [] });
  });
});

describe('TeamDetails description', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllUsers).mockResolvedValue([
      { user_id: 'user-lead', first_name: 'Lee', last_name: 'Lead', email: 'lee@example.com', is_inactive: false, roles: [] },
    ] as any);
  });
  afterEach(() => cleanup());

  it('shows the stored description', async () => {
    mockTeam({ ...TEAM, description: 'Handles escalations for the east region' });
    await renderLoaded();

    expect(screen.getByText('Handles escalations for the east region')).toBeInTheDocument();
  });

  it('shows placeholder copy when the team has no description', async () => {
    mockTeam({ ...TEAM, description: null });
    await renderLoaded();

    expect(screen.getByText('teams.details.noDescription')).toBeInTheDocument();
  });

  it('saves an edited description through updateTeam', async () => {
    mockTeam({ ...TEAM, description: null });
    vi.mocked(updateTeam).mockResolvedValue({ ...TEAM, description: 'Second-line support' } as any);
    await renderLoaded();

    fireEvent.click(screen.getByTitle('teams.details.actions.editDescription'));
    fireEvent.change(await screen.findByLabelText('teams.details.fields.description'), {
      target: { value: 'Second-line support' },
    });
    fireEvent.click(screen.getByTitle('teams.details.actions.saveDescription'));

    await waitFor(() => expect(updateTeam).toHaveBeenCalledWith('team-1', { description: 'Second-line support' }));
    expect(await screen.findByText('Second-line support')).toBeInTheDocument();
  });

  it('abandons the edit on Escape without calling updateTeam', async () => {
    mockTeam({ ...TEAM, description: 'Handles escalations for the east region' });
    await renderLoaded();

    fireEvent.click(screen.getByTitle('teams.details.actions.editDescription'));
    const input = await screen.findByLabelText('teams.details.fields.description');
    fireEvent.change(input, { target: { value: 'Typed but abandoned' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(updateTeam).not.toHaveBeenCalled();
    expect(await screen.findByText('Handles escalations for the east region')).toBeInTheDocument();
  });
});
