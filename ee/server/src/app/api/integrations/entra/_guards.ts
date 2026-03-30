import { NextResponse } from 'next/server';
import { TIER_FEATURES } from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth/rbac';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';
import { TierAccessError, assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';

type EntraGuardPermission = 'read' | 'update';

export async function requireEntraUiFlagEnabled(
  requiredPermission: EntraGuardPermission = 'read'
): Promise<Response | { tenantId: string; userId: string }> {
  const user = await getCurrentUser();

  if (!user || !user.user_id || !user.tenant) {
    return NextResponse.json(
      {
        success: false,
        error: 'Authentication required',
      },
      { status: 401 }
    );
  }

  if (user.user_type === 'client') {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
      },
      { status: 403 }
    );
  }

  const allowed = await hasPermission(user, 'system_settings', requiredPermission);
  if (!allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Forbidden: insufficient permissions (${requiredPermission})`,
      },
      { status: 403 }
    );
  }

  try {
    await assertTierAccess(TIER_FEATURES.INTEGRATIONS);
  } catch (error) {
    if (error instanceof TierAccessError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 403 }
      );
    }
    throw error;
  }

  const enabled = await featureFlags.isEnabled('entra-integration-ui', {
    userId: user.user_id,
    tenantId: user.tenant,
  });

  if (!enabled) {
    return NextResponse.json(
      {
        success: false,
        error: 'Microsoft Entra integration is disabled for this tenant.',
      },
      { status: 404 }
    );
  }

  return { tenantId: user.tenant, userId: user.user_id };
}
