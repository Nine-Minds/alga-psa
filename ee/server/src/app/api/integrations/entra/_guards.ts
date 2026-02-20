import { NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/users/actions';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';

export async function requireEntraUiFlagEnabled(): Promise<Response | { tenantId: string; userId: string }> {
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
