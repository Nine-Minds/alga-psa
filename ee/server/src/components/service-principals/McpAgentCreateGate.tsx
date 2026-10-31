'use client';

import React, { useEffect, useState } from 'react';
import { TIER_FEATURES } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useTier } from 'server/src/context/TierContext';
import { getServicePrincipalUsage } from '../../lib/actions/service-principal-actions';
import type { ServicePrincipalUsage } from '../../lib/service-principals/usage';

export interface McpAgentCreateGateProps {
  /** Bumped by the caller after an agent is created so the shared count refreshes. */
  refreshKey?: unknown;
  children: (state: { disabled: boolean }) => React.ReactNode;
}

/**
 * MCP agents are service principals of kind `mcp_agent`, so they share the principal limit and the
 * Pro requirement. This gate shows the shared "N of M" line and tells the MCP settings whether the
 * create button must be disabled, with the reason.
 */
export function McpAgentCreateGate({ refreshKey, children }: McpAgentCreateGateProps) {
  const { t } = useTranslation('msp/settings');
  const { hasFeature } = useTier();
  const hasPro = hasFeature(TIER_FEATURES.SERVICE_PRINCIPALS);
  const [usage, setUsage] = useState<ServicePrincipalUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    getServicePrincipalUsage()
      .then((value) => {
        if (!cancelled) setUsage(value);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const atLimit = usage ? usage.used >= usage.limit : false;

  return (
    <>
      {usage && (
        <p className="text-sm text-[rgb(var(--color-text-600))]" data-testid="mcp-shared-limit">
          {t('servicePrincipals.mcp.sharedLimit', {
            defaultValue: 'MCP agents count toward your service principal limit: {{used}} of {{limit}} in use.',
            used: usage.used,
            limit: usage.limit,
          })}
        </p>
      )}
      {!hasPro && (
        <p className="text-sm text-[rgb(var(--color-text-600))]" data-testid="mcp-requires-pro">
          {t('servicePrincipals.mcp.requiresPro', { defaultValue: 'Adding MCP agents requires the Pro plan.' })}
        </p>
      )}
      {hasPro && atLimit && (
        <p className="text-sm text-[rgb(var(--color-text-600))]" data-testid="mcp-limit-reached">
          {t('servicePrincipals.mcp.limitReached', {
            defaultValue: 'You have reached your limit of {{limit}} active service principals. Deactivate or remove one to add an agent.',
            limit: usage?.limit ?? 0,
          })}
        </p>
      )}
      {children({ disabled: !hasPro || atLimit })}
    </>
  );
}

export default McpAgentCreateGate;
