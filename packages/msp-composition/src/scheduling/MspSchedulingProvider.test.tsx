import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useSchedulingCallbacks } from '@alga-psa/ui/context';
import { MspSchedulingProvider } from './MspSchedulingProvider';

const launchTimeEntryForWorkItem = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/scheduling/lib/timeEntryLauncher', () => ({
  launchTimeEntryForWorkItem,
}));

vi.mock('@alga-psa/scheduling/components/schedule/AgentScheduleView', () => ({
  default: ({ agentId }: { agentId: string }) => <div data-testid={`agent-view-${agentId}`} />,
}));

describe('MspSchedulingProvider', () => {
  it('provides renderAgentSchedule that returns AgentScheduleView', () => {
    const Consumer = () => {
      const { renderAgentSchedule } = useSchedulingCallbacks();
      return <div>{renderAgentSchedule('agent-1')}</div>;
    };

    const { getByTestId } = render(
      <MspSchedulingProvider>
        <Consumer />
      </MspSchedulingProvider>
    );

    expect(getByTestId('agent-view-agent-1')).toBeTruthy();
  });

  it('provides launchTimeEntry that calls launchTimeEntryForWorkItem', () => {
    const openDrawer = vi.fn();
    const closeDrawer = vi.fn();

    const Consumer = () => {
      const { launchTimeEntry } = useSchedulingCallbacks();
      useEffect(() => {
        launchTimeEntry({
          openDrawer,
          closeDrawer,
          context: {
            workItemId: 'ticket-1',
            workItemType: 'ticket',
            workItemName: 'Ticket 1',
          },
        });
      }, [launchTimeEntry]);
      return null;
    };

    render(
      <MspSchedulingProvider>
        <Consumer />
      </MspSchedulingProvider>
    );

    expect(launchTimeEntryForWorkItem).toHaveBeenCalled();
  });
});
