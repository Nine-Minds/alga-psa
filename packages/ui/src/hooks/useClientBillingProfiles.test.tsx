// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useClientBillingProfiles,
  type BillingProfileOption,
} from './useClientBillingProfiles';

/**
 * T021 — the invisibility rule (decision D6, F042).
 *
 * Nearly every client will only ever have one billing profile, and for those
 * clients this feature must be completely absent: no picker on a ticket, no
 * column on a contract line, no portal segment tab, no spend-by-profile report.
 * Every one of those surfaces renders behind `isSegmented` from this hook, so
 * this is the one place the rule can be tested rather than re-tested per screen.
 *
 * The rule is gated on the data rather than on a feature flag because it is
 * then self-disabling: a client that never gains a second profile never sees the
 * feature, and there is nothing to remember to turn off.
 */

const profile = (
  billing_profile_id: string,
  is_default = false,
): BillingProfileOption => ({
  billing_profile_id,
  client_id: 'client-1',
  name: billing_profile_id,
  is_default,
  is_active: true,
  is_system_managed_default: is_default,
});

describe('T021: a single-profile client is not segmented', () => {
  it('reports isSegmented false for the one profile every client has', () => {
    const loader = vi.fn().mockResolvedValue([profile('default-profile', true)]);
    const { result } = renderHook(() => useClientBillingProfiles('client-1', loader));

    return waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSegmented).toBe(false);
      // The default is still available: surfaces that must *attribute* a charge
      // need it even when nothing about profiles is shown.
      expect(result.current.defaultProfile?.billing_profile_id).toBe('default-profile');
    });
  });

  it('reports isSegmented true only once a second profile exists', async () => {
    const loader = vi
      .fn()
      .mockResolvedValue([profile('default-profile', true), profile('site-b')]);
    const { result } = renderHook(() => useClientBillingProfiles('client-1', loader));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSegmented).toBe(true);
    expect(result.current.profiles).toHaveLength(2);
  });

  it('never claims a client is segmented before the profiles have loaded', () => {
    // A surface that flashed a picker on first paint and then removed it would
    // leak the feature to a single-profile client for exactly one frame.
    const loader = vi.fn(() => new Promise<BillingProfileOption[]>(() => {}));
    const { result } = renderHook(() => useClientBillingProfiles('client-1', loader));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isSegmented).toBe(false);
    expect(result.current.profiles).toEqual([]);
  });
});

describe('T021: a failed read is an error, not "one profile"', () => {
  it('surfaces the error rather than reporting an unsegmented client', async () => {
    // The dangerous failure runs the other way: treating a read failure as
    // `length === 0` would hide a *segmented* client's picker, and the charge
    // would silently land on whichever profile the server defaulted to.
    const loader = vi.fn().mockResolvedValue({ message: 'Permission denied' });
    const { result } = renderHook(() => useClientBillingProfiles('client-1', loader));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('Permission denied');
  });

  it('keeps the last known profiles when a refresh fails', async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce([profile('default-profile', true), profile('site-b')])
      .mockResolvedValueOnce(null);
    const { result } = renderHook(() => useClientBillingProfiles('client-1', loader));

    await waitFor(() => expect(result.current.isSegmented).toBe(true));
    await result.current.refresh();

    await waitFor(() => expect(result.current.error).toBeTruthy());
    // Still segmented: the picker stays on screen with an error beside it,
    // rather than vanishing and taking the user's ability to choose with it.
    expect(result.current.isSegmented).toBe(true);
  });
});

describe('T021: no client, no request', () => {
  it('does not call the loader without a client id', async () => {
    const loader = vi.fn();
    const { result } = renderHook(() => useClientBillingProfiles(null, loader));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(loader).not.toHaveBeenCalled();
    expect(result.current.isSegmented).toBe(false);
  });
});
