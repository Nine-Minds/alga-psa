'use client';

import { useEffect, useState } from 'react';
import { canManageEntraSync } from '../../actions/entraClientSyncActions';

/**
 * Whether this user may start an Entra sync, probed the same way the equipment
 * tab probes inventory:read. Any probe failure resolves to "no": showing a
 * button that will be refused is the defect being fixed.
 */
export function useEntraSyncPermission(): { canManage: boolean; loading: boolean } {
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const allowed = await canManageEntraSync();
        if (!cancelled) setCanManage(allowed === true);
      } catch {
        if (!cancelled) setCanManage(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { canManage, loading };
}
