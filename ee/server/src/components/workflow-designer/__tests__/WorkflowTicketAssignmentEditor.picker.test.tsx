/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pickerState = vi.hoisted(() => ({ userAndTeamMounts: 0 }));

// A picker with its own open/closed state, like the real one: if it unmounts while open, the
// user's pick is lost.
vi.mock('@alga-psa/ui/components/UserAndTeamPicker', async () => {
  const ReactModule = await import('react');
  const MockUserAndTeamPicker = ({
    id,
    users,
    teams,
    value,
    onValueChange,
    onTeamSelect,
  }: {
    id?: string;
    users: Array<{ user_id: string; first_name?: string; last_name?: string }>;
    teams: Array<{ team_id: string; team_name: string }>;
    value: string;
    onValueChange: (value: string) => void;
    onTeamSelect?: (value: string) => void;
  }) => {
    const [open, setOpen] = ReactModule.useState(false);
    ReactModule.useEffect(() => {
      pickerState.userAndTeamMounts += 1;
    }, []);
    return (
      <div>
        <button type="button" data-testid={`${id}-trigger`} onClick={() => setOpen(true)}>
          {value || 'Search users or teams'}
        </button>
        {open && (
          <ul data-testid={`${id}-list`}>
            {users.map((user) => (
              <li key={user.user_id}>
                <button type="button" onClick={() => { onValueChange(user.user_id); setOpen(false); }}>
                  {`${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()}
                </button>
              </li>
            ))}
            {teams.map((team) => (
              <li key={team.team_id}>
                <button type="button" onClick={() => { onTeamSelect?.(team.team_id); setOpen(false); }}>
                  {team.team_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  return { __esModule: true, default: MockUserAndTeamPicker };
});

vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({ BoardPicker: () => null }));
vi.mock('@alga-psa/ui/components/AsyncSearchableSelect', () => ({ AsyncSearchableSelect: () => null }));
vi.mock('@alga-psa/clients/actions', () => ({ getAllContacts: vi.fn(), getContactsByClient: vi.fn() }));
vi.mock('@alga-psa/integrations/actions', () => ({ getAvailableStatuses: vi.fn(), getTicketFieldOptions: vi.fn() }));
vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({ getTicketById: vi.fn() }));
vi.mock('@alga-psa/auth/actions', () => ({ getRoles: vi.fn() }));
vi.mock('@alga-psa/projects/actions/projectActions', () => ({ getProjectsWithPhases: vi.fn() }));
vi.mock('@alga-psa/projects/actions/projectTaskActions', () => ({ getProjectTaskData: vi.fn() }));
vi.mock('../workflowTicketPickerSearch', () => ({
  formatWorkflowTicketLabel: vi.fn(),
  searchWorkflowTickets: vi.fn(),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsersBasic: vi.fn().mockResolvedValue([
    { user_id: 'user-tin', first_name: 'Tin', last_name: 'Woodman' },
    { user_id: 'user-dorothy', first_name: 'Dorothy', last_name: 'Gale' },
  ]),
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));
vi.mock('@alga-psa/teams/actions', () => ({
  getTeamsBasic: vi.fn().mockResolvedValue([{ team_id: 'team-ops', team_name: 'Operations' }]),
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
  isTeamActionError: () => false,
}));

import { getAllUsersBasic } from '@alga-psa/user-composition/actions';
import type { MappingValue } from '@alga-psa/workflows/runtime';
import { readTicketAssignmentLiteral, WorkflowTicketAssignmentEditor } from '../WorkflowTicketAssignmentEditor';

// Mirrors how the step panel hosts the editor: every change re-renders the parent.
const Host: React.FC<{ onValue: (value: MappingValue) => void }> = ({ onValue }) => {
  const [value, setValue] = useState<MappingValue | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const literal = readTicketAssignmentLiteral(value) ?? { primary: null, additionalUserIds: [] };
  return (
    <div onFocusCapture={() => setTick((current) => current + 1)} data-tick={tick}>
      <WorkflowTicketAssignmentEditor
        idPrefix="assign"
        value={literal}
        onChange={(next) => {
          setValue(next);
          onValue(next);
        }}
      />
    </div>
  );
};

describe('WorkflowTicketAssignmentEditor assignee picker', () => {
  afterEach(() => {
    cleanup();
    pickerState.userAndTeamMounts = 0;
    vi.mocked(getAllUsersBasic).mockClear();
  });

  it('keeps the picker mounted across parent re-renders, so a pick commits', async () => {
    const onValue = vi.fn();
    await act(async () => {
      render(<Host onValue={onValue} />);
    });
    await waitFor(() => expect(screen.getByTestId('assign-assignee-literal-picker-trigger')).toBeTruthy());
    const mountsAfterLoad = pickerState.userAndTeamMounts;

    // Opening the list focuses inside the step panel, which re-renders the host.
    await act(async () => {
      fireEvent.focus(screen.getByTestId('assign-assignee-literal-picker-trigger'));
      fireEvent.click(screen.getByTestId('assign-assignee-literal-picker-trigger'));
    });
    // The re-render must not reload the options (which swaps in a loading placeholder and
    // unmounts the open list).
    expect(getAllUsersBasic).toHaveBeenCalledTimes(1);
    expect(pickerState.userAndTeamMounts).toBe(mountsAfterLoad);

    await act(async () => {
      fireEvent.click(screen.getByText('Tin Woodman'));
    });

    expect(onValue).toHaveBeenLastCalledWith({
      primary: { type: 'user', id: 'user-tin' },
      additional_user_ids: [],
    });
  });

  it('records a team pick as a team assignment', async () => {
    const onValue = vi.fn();
    await act(async () => {
      render(<Host onValue={onValue} />);
    });
    await waitFor(() => expect(screen.getByTestId('assign-assignee-literal-picker-trigger')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByTestId('assign-assignee-literal-picker-trigger'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Operations'));
    });
    expect(onValue).toHaveBeenLastCalledWith({
      primary: { type: 'team', id: 'team-ops' },
      additional_user_ids: [],
    });
  });
});
