import { TIER_FEATURES } from '@alga-psa/types';
import type { EntraDiagnosticsReadiness } from '@alga-psa/types';
import {
  TierAccessError,
  assertTierAccess,
} from 'server/src/lib/tier-gating/assertTierAccess';
import { hasPermission } from '@alga-psa/auth/rbac';

function isEeEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

async function tierCheck(feature: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    await assertTierAccess(feature as any);
    return { ok: true };
  } catch (error) {
    if (error instanceof TierAccessError) {
      return { ok: false, detail: 'Requires a higher subscription tier.' };
    }
    throw error;
  }
}

/**
 * Read-only evaluation of Entra access policy. The diagnostics route already
 * enforces this through `requireEntraAccess`; this evaluates the same policy so
 * the report can show real subcheck evidence instead of hardcoded success and
 * so denied requests can carry a precise reason.
 */
export async function evaluateEntraReadiness(user: any): Promise<EntraDiagnosticsReadiness> {
  const authenticated = Boolean(user?.user_id && user?.tenant);
  const clientPortal = user?.user_type === 'client' || user?.userType === 'client';

  let systemSettingsRead = false;
  if (authenticated && !clientPortal) {
    try {
      systemSettingsRead = await hasPermission(user, 'system_settings', 'read');
    } catch {
      systemSettingsRead = false;
    }
  }

  const edition = isEeEdition() ? 'enterprise' : 'community';
  const integrations = await tierCheck(TIER_FEATURES.INTEGRATIONS);
  const entraSync = await tierCheck(TIER_FEATURES.ENTRA_SYNC);

  const checks = [
    { key: 'authenticated', ok: authenticated, detail: authenticated ? null : 'Not signed in.' },
    {
      key: 'notClientPortal',
      ok: !clientPortal,
      detail: clientPortal ? 'Client portal users cannot manage integrations.' : null,
    },
    {
      key: 'edition',
      ok: edition === 'enterprise',
      detail: edition === 'enterprise' ? null : 'Microsoft Entra integration requires Enterprise Edition.',
    },
    {
      key: 'integrationsTier',
      ok: integrations.ok,
      detail: integrations.detail ?? null,
    },
    {
      key: 'entraSyncTier',
      ok: entraSync.ok,
      detail: entraSync.ok ? null : 'Entra requires the Pro tier.',
    },
    {
      key: 'systemSettingsRead',
      ok: systemSettingsRead,
      detail: systemSettingsRead ? null : 'Requires system_settings read permission.',
    },
  ];

  let deniedReason: string | null = null;
  if (!authenticated) deniedReason = 'Authentication required.';
  else if (clientPortal) deniedReason = 'Forbidden.';
  else if (edition !== 'enterprise')
    deniedReason = 'Microsoft Entra integration is only available in Enterprise Edition.';
  else if (!integrations.ok || !entraSync.ok) deniedReason = 'Entra requires the Pro tier.';
  else if (!systemSettingsRead)
    deniedReason = 'Forbidden: insufficient permissions (read).';

  return {
    authenticated,
    clientPortal,
    edition,
    checks,
    ok: deniedReason === null,
    deniedReason,
  };
}
