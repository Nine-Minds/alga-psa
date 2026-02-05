import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSchedulingCallbacks } from '@alga-psa/ui/context';

const toastSpy = vi.fn();
vi.mock('react-hot-toast', () => ({ toast: toastSpy }));

describe('fallback time entry behavior', () => {
  it('shows a toast when scheduling provider is absent', async () => {
    const { result } = renderHook(() => useSchedulingCallbacks());

    await result.current.launchTimeEntry({
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      context: {
        workItemId: 'ticket-1',
        workItemType: 'ticket',
        workItemName: 'Ticket 1',
      },
    });

    expect(toastSpy).toHaveBeenCalledWith('Time entry is managed in Scheduling.');
  });
});
