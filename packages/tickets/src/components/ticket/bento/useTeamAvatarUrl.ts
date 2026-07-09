'use client';

import { useEffect, useState } from 'react';
import type { GetTeamAvatarUrlsBatch } from '@alga-psa/ui/components/UserAndTeamPicker';

/** Resolves one team's avatar URL through the batch loader (null while loading or absent). */
export function useTeamAvatarUrl(
  teamId: string | null | undefined,
  tenant: string | null | undefined,
  fetcher?: GetTeamAvatarUrlsBatch,
): string | null {
  const [urls, setUrls] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!teamId || !tenant || !fetcher || urls[teamId] !== undefined) return;
    let cancelled = false;
    fetcher([teamId], tenant)
      .then((map) => {
        if (!cancelled) setUrls((prev) => ({ ...prev, [teamId]: map.get(teamId) ?? null }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [teamId, tenant, fetcher, urls]);

  return teamId ? urls[teamId] ?? null : null;
}

export default useTeamAvatarUrl;
