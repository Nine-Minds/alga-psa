// @vitest-environment jsdom
/**
 * The Audits tab gate. It is probed, not assumed: the Install base tile's
 * "Site audits" link keys off the tab existing, so a user without asset:read
 * must lose both rather than be sent into a refusal.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useClientAuditsTab } from './useClientAuditsTab';

describe('useClientAuditsTab', () => {
  it('shows the tab when the probe says the user may read assets', async () => {
    const { result } = renderHook(() => useClientAuditsTab(async () => true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(true);
  });

  it('hides the tab when the user may not read assets', async () => {
    const { result } = renderHook(() => useClientAuditsTab(async () => false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
  });

  it('hides the tab when the probe fails, rather than guessing', async () => {
    const probe = vi.fn(async () => {
      throw new Error('probe exploded');
    });
    const { result } = renderHook(() => useClientAuditsTab(probe));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
  });

  it('hides the tab, and stops loading, when no probe was injected at all', async () => {
    // AlgaDesk and the client quick view supply neither renderer nor probe.
    const { result } = renderHook(() => useClientAuditsTab(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visible).toBe(false);
  });
});
