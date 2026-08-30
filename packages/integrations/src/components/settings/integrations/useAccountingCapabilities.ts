'use client';

import { useCallback, useEffect, useState } from 'react';
import { checkCurrentUserPermissions } from '@alga-psa/auth/actions';

/**
 * The five accounting-integration capability permissions, fetched in one
 * batch for the current user. Client-side controls are gated on these; the
 * server actions remain the authoritative enforcement.
 */
export interface AccountingCapabilities {
  catalogRead: boolean;
  connectionsManage: boolean;
  mappingsManage: boolean;
  exportsExecute: boolean;
  remoteMutate: boolean;
  /** True when the user holds at least one accounting capability. */
  hasAny: boolean;
}

const EMPTY: AccountingCapabilities = {
  catalogRead: false,
  connectionsManage: false,
  mappingsManage: false,
  exportsExecute: false,
  remoteMutate: false,
  hasAny: false,
};

export function useAccountingCapabilities(): AccountingCapabilities {
  const [capabilities, setCapabilities] = useState<AccountingCapabilities>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    checkCurrentUserPermissions([
      { resource: 'accounting_integrations', action: 'catalog_read' },
      { resource: 'accounting_integrations', action: 'connections_manage' },
      { resource: 'accounting_integrations', action: 'mappings_manage' },
      { resource: 'accounting_integrations', action: 'exports_execute' },
      { resource: 'accounting_integrations', action: 'remote_mutate' },
    ])
      .then((results) => {
        if (cancelled) return;
        const granted = (resource: string, action: string): boolean =>
          results.some((result) => result.resource === resource && result.action === action && result.granted);
        setCapabilities({
          catalogRead: granted('accounting_integrations', 'catalog_read'),
          connectionsManage: granted('accounting_integrations', 'connections_manage'),
          mappingsManage: granted('accounting_integrations', 'mappings_manage'),
          exportsExecute: granted('accounting_integrations', 'exports_execute'),
          remoteMutate: granted('accounting_integrations', 'remote_mutate'),
          hasAny: results.some((result) => result.resource === 'accounting_integrations' && result.granted),
        });
      })
      .catch(() => {
        if (!cancelled) setCapabilities(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return capabilities;
}
