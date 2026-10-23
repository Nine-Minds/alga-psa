'use client';

import { useEffect, useState } from 'react';
import { checkCurrentUserPermissions } from '@alga-psa/auth/actions';

const ACTIONS = ['read', 'create', 'update', 'delete'] as const;

export interface TicketTemplatePermissions {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  /** False until the permission check has resolved. */
  loaded: boolean;
}

/** Folds a batch permission result into the four `ticket_template` flags; `null` means "not checked yet". */
export function templatePermissionsFromChecks(
  results: ReadonlyArray<{ resource: string; action: string; granted: boolean }> | null,
): TicketTemplatePermissions {
  const granted = (action: string) =>
    results?.some((result) => result.resource === 'ticket_template' && result.action === action && result.granted) ?? false;
  return {
    read: granted('read'),
    create: granted('create'),
    update: granted('update'),
    delete: granted('delete'),
    loaded: results !== null,
  };
}

/**
 * The viewer's `ticket_template` permissions, fetched in one batch. UI controls are gated on them; the
 * server actions remain the authoritative check. Everything is false until the check resolves, so a
 * control never flashes in for a user who is not allowed to use it.
 */
export function useTicketTemplatePermissions(): TicketTemplatePermissions {
  const [permissions, setPermissions] = useState<TicketTemplatePermissions>(() => templatePermissionsFromChecks(null));

  useEffect(() => {
    let cancelled = false;
    checkCurrentUserPermissions(ACTIONS.map((action) => ({ resource: 'ticket_template', action })))
      .then((results) => { if (!cancelled) setPermissions(templatePermissionsFromChecks(results)); })
      .catch(() => { if (!cancelled) setPermissions({ ...templatePermissionsFromChecks([]), loaded: true }); });
    return () => { cancelled = true; };
  }, []);

  return permissions;
}
