import { NextResponse } from 'next/server';
import { TIER_FEATURES } from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth/rbac';
import { TierAccessError, assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';

type HuduGuardPermission = 'read' | 'update';

/**
 * Hudu UI access guard — mirrors requireEntraUiFlagEnabled.
 *
 * Requires the integrations tier and `system_settings` RBAC. Returns a Response
 * (401/403) when the caller is unauthorized, otherwise resolves the tenant +
 * user ids for the handler (read=view, update=connect/disconnect/manage mappings).
 */
export async function requireHuduUiFlagEnabled(
  requiredPermission: HuduGuardPermission = 'read'
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
          error: 'Hudu integration is not available for this workspace.',
        },
        { status: 403 }
      );
    }
    throw error;
  }

  return { tenantId: user.tenant, userId: user.user_id };
}
