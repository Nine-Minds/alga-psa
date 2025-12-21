import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { observabilityLogger } from '@/lib/observability/logging';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * Check if this is an internal request from ext-proxy with trusted user info.
 */
function getInternalUserInfo(request: NextRequest): { user_id: string; tenant: string; email?: string } | null {
  const internalRequest = request.headers.get('x-internal-request');
  if (internalRequest !== 'ext-proxy-prefetch') {
    return null;
  }

  const userId = request.headers.get('x-internal-user-id');
  const tenant = request.headers.get('x-internal-user-tenant');
  const email = request.headers.get('x-internal-user-email') || undefined;

  if (!userId || !tenant) {
    return null;
  }

  return { user_id: userId, tenant, email };
}

export async function GET(req: NextRequest) {
  try {
    // Check for internal ext-proxy request first
    const internalUser = getInternalUserInfo(req);
    let userTenant: string;
    let userId: string;
    let userEmail: string | undefined;

    if (internalUser) {
      // Trust the user info from ext-proxy (it already validated the session)
      userTenant = internalUser.tenant;
      userId = internalUser.user_id;
      userEmail = internalUser.email;
    } else {
      // Normal request - get user from session
      const session = await getSession();

      if (!session?.user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const user = session.user as any;
      userTenant = user.tenant;
      userId = user.user_id;
      userEmail = user.email;
    }

    if (userTenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // LOG: Access event
    observabilityLogger.info('Tenant list accessed', {
      event_type: 'tenant_management_access',
      action: 'list_tenants',
      accessed_by: userId,
      accessed_by_email: userEmail,
    });

    const knex = await getAdminConnection();

    const tenants = await knex('tenants as t')
      .leftJoin('stripe_subscriptions as s', function () {
        this.on('t.tenant', '=', 's.tenant')
          .andOn('s.status', '=', knex.raw("'active'"));
      })
      .select([
        't.tenant',
        't.client_name',
        't.email',
        't.created_at',
        's.status as subscription_status',
      ])
      .orderBy('t.client_name', 'asc');

    return NextResponse.json({ success: true, data: tenants });
  } catch (error) {
    observabilityLogger.error('Failed to list tenants', error, {
      event_type: 'tenant_management_error',
    });

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
