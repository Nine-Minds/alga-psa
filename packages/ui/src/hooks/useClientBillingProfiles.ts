'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The one place the billing-profile invisibility rule lives (decision D6, F042).
 *
 * Nearly every client will only ever have one billing profile, and for those
 * clients the feature must be completely invisible: no picker, no column, no
 * portal tab, no spend-by-profile report. Gating on `profiles.length > 1` is
 * strictly better than a feature flag because it is self-disabling — a client
 * that never gains a second profile never sees the feature, with nothing to
 * turn off later.
 *
 * That rule is worth exactly one implementation. Scattered `profiles.length > 1`
 * checks drift, and the first one that drifts leaks the feature into a
 * single-profile client's screen. Every consumer reads `isSegmented` from here.
 *
 * The hook takes its loader as a parameter rather than importing a server
 * action, because the consuming surfaces live in packages that must not depend
 * on each other (tickets, projects, billing, clients). Each package passes its
 * own thin `withAuth` wrapper over the shared model.
 */

export interface BillingProfileOption {
  billing_profile_id: string;
  client_id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  is_system_managed_default: boolean;
}

export type BillingProfileLoader = (
  clientId: string,
) => Promise<BillingProfileOption[] | { message?: string } | null | undefined>;

export interface UseClientBillingProfilesResult {
  profiles: BillingProfileOption[];
  /**
   * True only when the client holds more than one billing profile. This is the
   * single condition every profile surface renders behind.
   */
  isSegmented: boolean;
  defaultProfile: BillingProfileOption | null;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

const isProfileList = (value: unknown): value is BillingProfileOption[] =>
  Array.isArray(value);

export function useClientBillingProfiles(
  clientId: string | null | undefined,
  loadProfiles: BillingProfileLoader,
): UseClientBillingProfilesResult {
  const [profiles, setProfiles] = useState<BillingProfileOption[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(clientId));
  const [error, setError] = useState<unknown>(null);
  // The loader is typically an inline arrow; keeping it in a ref stops a new
  // identity from re-triggering the fetch on every render.
  const loaderRef = useRef(loadProfiles);
  loaderRef.current = loadProfiles;

  const load = useCallback(async () => {
    if (!clientId) {
      setProfiles([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const result = await loaderRef.current(clientId);
      // A read failure must not be mistaken for "this client has one profile" —
      // that would silently hide a segmented client's profile UI. Keep the last
      // known list and surface the error instead.
      if (!isProfileList(result)) {
        throw new Error(
          (result as { message?: string } | null)?.message ??
            'Failed to load billing profiles.',
        );
      }
      setProfiles(result);
      setError(null);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return {
    profiles,
    isSegmented: profiles.length > 1,
    defaultProfile: profiles.find((profile) => profile.is_default) ?? null,
    isLoading,
    error,
    refresh: load,
  };
}
