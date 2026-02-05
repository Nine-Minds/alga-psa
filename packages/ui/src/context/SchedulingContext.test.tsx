import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSchedulingCallbacks } from './SchedulingContext';

describe('SchedulingContext', () => {
  it('returns default callbacks when no provider is present', () => {
    const { result } = renderHook(() => useSchedulingCallbacks());

    expect(typeof result.current.renderAgentSchedule).toBe('function');
    expect(typeof result.current.launchTimeEntry).toBe('function');
  });
});
