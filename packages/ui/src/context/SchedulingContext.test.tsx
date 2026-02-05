import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { useSchedulingCallbacks } from './SchedulingContext';

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
});
