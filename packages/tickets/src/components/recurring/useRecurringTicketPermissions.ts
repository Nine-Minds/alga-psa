'use client';

import { useEffect, useState } from 'react';
import { checkCurrentUserPermissions } from '@alga-psa/auth/actions';
import { permissionsFromChecks, type RecurringTicketPermissions } from './recurringUi';

const ACTIONS = ['read', 'create', 'update', 'delete'] as const;

/**
 * The viewer's `recurring_ticket` permissions, fetched in one batch. UI controls are gated on them;
 * the server actions remain the authoritative check. Everything is false until the check resolves, so a
 * control never flashes in for a user who is not allowed to use it.
 */
export function useRecurringTicketPermissions(): RecurringTicketPermissions {
  const [permissions, setPermissions] = useState<RecurringTicketPermissions>(() => permissionsFromChecks(null));

  useEffect(() => {
    let cancelled = false;
    checkCurrentUserPermissions(ACTIONS.map((action) => ({ resource: 'recurring_ticket', action })))
      .then((results) => { if (!cancelled) setPermissions(permissionsFromChecks(results)); })
      .catch(() => { if (!cancelled) setPermissions({ ...permissionsFromChecks([]), loaded: true }); });
    return () => { cancelled = true; };
  }, []);

  return permissions;
}
