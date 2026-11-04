'use client';

import { useEffect, useState } from 'react';
import { checkCurrentUserPermissions } from '@alga-psa/auth/actions';

const ACTIONS = ['read', 'create', 'update', 'delete'] as const;

export interface CannedResponsePermissions {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  /** False until the permission check has resolved. */
  loaded: boolean;
}

/** Folds a batch permission result into the four `canned_response` flags; `null` means "not checked yet". */
export function cannedResponsePermissionsFromChecks(
  results: ReadonlyArray<{ resource: string; action: string; granted: boolean }> | null,
): CannedResponsePermissions {
  const granted = (action: string) =>
    results?.some((result) => result.resource === 'canned_response' && result.action === action && result.granted) ?? false;
  return {
    read: granted('read'),
    create: granted('create'),
    update: granted('update'),
    delete: granted('delete'),
    loaded: results !== null,
  };
}

// LEVERAGE: pattern resource-permissions-hook — identical to useTicketTemplatePermissions apart from the resource name; a useResourcePermissions(resource) layer would serve both
/**
 * The viewer's `canned_response` permissions in one batch. UI controls are gated on them; the server
 * actions remain the authoritative check. Everything is false until the check resolves.
 */
export function useCannedResponsePermissions(): CannedResponsePermissions {
  const [permissions, setPermissions] = useState<CannedResponsePermissions>(() => cannedResponsePermissionsFromChecks(null));

  useEffect(() => {
    let cancelled = false;
    checkCurrentUserPermissions(ACTIONS.map((action) => ({ resource: 'canned_response', action })))
      .then((results) => { if (!cancelled) setPermissions(cannedResponsePermissionsFromChecks(results)); })
      .catch(() => { if (!cancelled) setPermissions({ ...cannedResponsePermissionsFromChecks([]), loaded: true }); });
    return () => { cancelled = true; };
  }, []);

  return permissions;
}
