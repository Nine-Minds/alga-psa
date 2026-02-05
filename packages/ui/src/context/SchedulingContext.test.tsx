import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { SchedulingCallbackProvider, useSchedulingCallbacks } from './SchedulingContext';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ toast: toastSpy }));

describe('SchedulingContext', () => {
  it('returns default callbacks when no provider is present', () => {
    const { result } = renderHook(() => useSchedulingCallbacks());

    expect(typeof result.current.renderAgentSchedule).toBe('function');
    expect(typeof result.current.launchTimeEntry).toBe('function');
  });

  it('renders fallback alert element for agent schedule by default', () => {
    const { result } = renderHook(() => useSchedulingCallbacks());
    const element = result.current.renderAgentSchedule('agent-123');
    const { getByText } = render(<>{element}</>);

    expect(getByText(/Agent schedule view is now owned by Scheduling/i)).toBeTruthy();
  });

  it('shows a toast when launching time entry without provider', async () => {
    const { result } = renderHook(() => useSchedulingCallbacks());

    await result.current.launchTimeEntry({
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      context: {
        workItemId: 'work-item-1',
        workItemType: 'ticket',
        workItemName: 'Sample',
      },
    });

    expect(toastSpy).toHaveBeenCalledWith('Time entry is managed in Scheduling.');
  });

  it('uses provider callbacks when SchedulingCallbackProvider is present', () => {
    const launchSpy = vi.fn();
    const callbacks = {
      renderAgentSchedule: (agentId: string) => <div data-testid={`custom-${agentId}`} />,
      launchTimeEntry: launchSpy,
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SchedulingCallbackProvider value={callbacks}>
        {children}
      </SchedulingCallbackProvider>
    );

    const { result } = renderHook(() => useSchedulingCallbacks(), { wrapper });
    const element = result.current.renderAgentSchedule('agent-42');
    const { getByTestId } = render(<>{element}</>);

    expect(getByTestId('custom-agent-42')).toBeTruthy();
  });
});
