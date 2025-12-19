import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { options } from '@/app/api/auth/[...nextauth]/options';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { observabilityLogger } from '@/lib/observability/logging';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(options);

    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    if (session.user.tenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    // LOG: Access event
    observabilityLogger.info('Tenant list accessed', {
      event_type: 'tenant_management_access',
      action: 'list_tenants',
      accessed_by: session.user.user_id,
      accessed_by_email: session.user.email,
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
        't.portal_domain',
        't.created_at',
        's.status as subscription_status',
      ])
      .orderBy('t.client_name', 'asc');

    return NextResponse.json({ success: true, data: tenants }, { headers: corsHeaders });
  } catch (error) {
    observabilityLogger.error('Failed to list tenants', error, {
      event_type: 'tenant_management_error',
    });

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500, headers: corsHeaders });
  }
}
