/** @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? '')),
  }),
}));

import { useDescribeWorkflowTrigger, useFormatWorkflowRunTrigger } from '../useWorkflowRunTriggerPresentation';

describe('run source vs workflow trigger', () => {
  it('calls a hand-started run a manual test, whatever starts the workflow', () => {
    const { result } = renderHook(() => useFormatWorkflowRunTrigger());
    expect(result.current(null)).toBe('Manual test');
    expect(result.current(null, 'TICKET_CREATED')).toBe('Manual test with event: TICKET_CREATED');
    expect(result.current('event', 'TICKET_CREATED')).toBe('Event: TICKET_CREATED');
  });

  it('describes what starts the workflow, date triggers with their timing', () => {
    const { result } = renderHook(() => useDescribeWorkflowTrigger());
    expect(result.current({ type: 'date', source: 'contract.end', offsetDays: -30 })).toBe('Contract end date, 30 days before');
    expect(result.current({ type: 'date', source: 'client.anniversary', offsetDays: 0 })).toBe('Client anniversary, on the day');
    expect(result.current({ type: 'event', eventName: 'TICKET_CREATED' })).toBe('Event: TICKET_CREATED');
    expect(result.current(null)).toBeNull();
  });
});
