// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AgentScheduleView from '../src/components/schedule/AgentScheduleView';

const calendarSpy = vi.fn();

vi.mock('next/dynamic', () => ({
  default: () => (props: any) => {
    calendarSpy(props);
    return <div data-testid="calendar" />;
  }
}));

const getScheduleEntries = vi.fn();
vi.mock('@alga-psa/scheduling/actions', () => ({
  getScheduleEntries,
}));

const getCurrentUser = vi.fn();
const getCurrentUserPermissions = vi.fn();
vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser,
  getCurrentUserPermissions,
}));

const useUsers = vi.fn(() => ({ users: [] }));
vi.mock('@alga-psa/users/hooks', () => ({
  useUsers,
}));

beforeEach(() => {
  calendarSpy.mockClear();
  getScheduleEntries.mockResolvedValue({ success: true, entries: [] });
  getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  getCurrentUserPermissions.mockResolvedValue(['user_schedule:read:all']);
});

describe('AgentScheduleView', () => {
  it('renders without error for a valid agent', () => {
    const { getByTestId } = render(<AgentScheduleView agentId="agent-1" />);
    expect(getByTestId('calendar')).toBeTruthy();
  });

  it('calls getScheduleEntries with the agent ID and date range', async () => {
    render(<AgentScheduleView agentId="agent-1" />);

    await waitFor(() => expect(getScheduleEntries).toHaveBeenCalled());

    const [start, end, technicianIds] = getScheduleEntries.mock.calls[0];
    expect(technicianIds).toEqual(['agent-1']);
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);
    expect((end as Date).getTime()).toBeGreaterThan((start as Date).getTime());
  });

  it('shows a loading state while fetching events', async () => {
    let resolvePromise: (value: any) => void = () => {};
    const pending = new Promise((resolve) => {
      resolvePromise = resolve as (value: any) => void;
    });
    getScheduleEntries.mockReturnValueOnce(pending);

    const { getByText } = render(<AgentScheduleView agentId="agent-1" />);
    expect(getByText(/Loading/i)).toBeTruthy();

    resolvePromise({ success: true, entries: [] });
  });

  it('defaults to week view', () => {
    render(<AgentScheduleView agentId="agent-1" />);
    const props = calendarSpy.mock.calls[0][0];
    expect(props.defaultView).toBe('week');
    expect(props.view).toBe('week');
  });
});
