'use client';

import { useEffect, useState } from 'react';
import { getTimePeriodCapabilities, type TimePeriodCapabilities } from '../../../actions/timePeriodsActions';

export interface TimePeriodPermissions extends TimePeriodCapabilities {
  /** False until the permission check has resolved. */
  loaded: boolean;
}

const NONE: TimePeriodCapabilities = {
  read: false,
  create: false,
  update: false,
  delete: false,
  manage: false,
};

/**
 * The viewer's `time_period` permissions, fetched in one batch. Settings controls are gated on
 * them; the server actions remain the authoritative check. Everything is false until the check
 * resolves, so no control flashes in for a user who is not allowed to use it.
 */
export function useTimePeriodPermissions(): TimePeriodPermissions {
  const [permissions, setPermissions] = useState<TimePeriodPermissions>({ ...NONE, loaded: false });

  useEffect(() => {
    let cancelled = false;
    getTimePeriodCapabilities()
      .then((capabilities) => { if (!cancelled) setPermissions({ ...capabilities, loaded: true }); })
      .catch(() => { if (!cancelled) setPermissions({ ...NONE, loaded: true }); });
    return () => { cancelled = true; };
  }, []);

  return permissions;
}
