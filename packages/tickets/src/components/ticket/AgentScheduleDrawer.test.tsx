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
    };

    const { getByTestId } = render(
      <SchedulingCallbackProvider value={callbacks}>
        <AgentScheduleDrawer agentId="agent-1" />
      </SchedulingCallbackProvider>
    );

    expect(getByTestId('calendar-agent-1')).toBeTruthy();
  });

  it('shows fallback alert when no provider is present', () => {
    const { getByText } = render(<AgentScheduleDrawer agentId="agent-1" />);
    expect(getByText(/Agent schedule view is now owned by Scheduling/i)).toBeTruthy();
  });
});
