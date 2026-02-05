import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { useSchedulingCallbacks } from './SchedulingContext';

const toastSpy = vi.fn();
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
});
