/* @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import AgentScheduleDrawer from './AgentScheduleDrawer';
import { SchedulingCallbackProvider } from '@alga-psa/ui/context';

describe('AgentScheduleDrawer', () => {
  it('renders calendar when provider is present', () => {
    const callbacks = {
      renderAgentSchedule: (agentId: string) => <div data-testid={`calendar-${agentId}`} />,
      launchTimeEntry: vi.fn(),
      launchScheduleEntry: vi.fn(),
      fetchTimeEntriesForTicket: vi.fn(),
      deleteTimeEntry: vi.fn(),
    };

    const { getByTestId } = render(
      <SchedulingCallbackProvider value={callbacks}>
        <AgentScheduleDrawer agentId="agent-1" />
      </SchedulingCallbackProvider>
    );

    expect(getByTestId('calendar-agent-1')).toBeTruthy();
  });

  it('forwards the work item context to the schedule renderer', () => {
    const renderAgentSchedule = vi.fn(() => <div data-testid="calendar-agent-1" />);
    const callbacks = {
      renderAgentSchedule,
      launchTimeEntry: vi.fn(),
      launchScheduleEntry: vi.fn(),
      fetchTimeEntriesForTicket: vi.fn(),
      deleteTimeEntry: vi.fn(),
    };
    const workItemContext = {
      workItemId: 'ticket-1',
      workItemType: 'ticket' as const,
      title: 'Printer offline',
    };

    render(
      <SchedulingCallbackProvider value={callbacks}>
        <AgentScheduleDrawer agentId="agent-1" workItemContext={workItemContext} />
      </SchedulingCallbackProvider>
    );

    expect(renderAgentSchedule).toHaveBeenCalledWith('agent-1', workItemContext);
  });

  it('shows fallback alert when no provider is present', () => {
    const { getByText } = render(<AgentScheduleDrawer agentId="agent-1" />);
    expect(getByText(/Agent schedule view is now owned by Scheduling/i)).toBeTruthy();
  });
});