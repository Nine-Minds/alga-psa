import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getStripeService } from '@ee/lib/stripe/StripeService';
import { observabilityLogger } from '@/lib/observability/logging';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';

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

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    if (!MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'MASTER_BILLING_TENANT_ID not configured' }, { status: 500 });
    }

    // Check for internal ext-proxy request first
    const internalUser = getInternalUserInfo(req);
    let userTenant: string;
    let userId: string;
    let userEmail: string | undefined;

    if (internalUser) {
      userTenant = internalUser.tenant;
      userId = internalUser.user_id;
      userEmail = internalUser.email;
    } else {
      // Check for API key auth
      const apiKey = req.headers.get('x-api-key');
      if (apiKey) {
        const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
        if (keyRecord) {
          if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
            userTenant = MASTER_BILLING_TENANT_ID;
            userId = req.headers.get('x-user-id') || keyRecord.user_id;
            userEmail = req.headers.get('x-user-email') || undefined;
          } else {
            return NextResponse.json({ success: false, error: 'API key not authorized for tenant management' }, { status: 403 });
          }
        } else {
          return NextResponse.json({ success: false, error: 'Invalid API key' }, { status: 401 });
        }
      } else {
        const session = await getSession();
        if (!session?.user) {
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        const user = session.user as any;
        userTenant = user.tenant;
        userId = user.user_id;
        userEmail = user.email;
      }
    }

    // Verify user is from master tenant
    if (userTenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { tenantId } = body;

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'tenantId is required' }, { status: 400 });
    }

    observabilityLogger.info('Start Premium trial initiated', {
      event_type: 'tenant_management_action',
      action: 'start_premium_trial',
      tenant_id: tenantId,
      triggered_by: userId,
      triggered_by_email: userEmail,
    });

    // Log to audit table
    const knex = await getAdminConnection();
    const [auditRecord] = await knex('extension_audit_logs')
      .insert({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.start_premium_trial',
        user_id: userId,
        user_email: userEmail,
        resource_type: 'tenant',
        resource_id: tenantId,
        resource_name: tenantId,
        status: 'pending',
        details: JSON.stringify({ source: 'ninemindsreporting_extension', targetTenantId: tenantId }),
      })
      .returning('log_id');

    // Call StripeService to start Premium trial
    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return NextResponse.json({ success: false, error: 'Stripe billing is not configured' }, { status: 503 });
    }

    const result = await stripeService.startPremiumTrial(tenantId);

    // Update audit record
    await knex('extension_audit_logs')
      .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
      .update({
        status: result.success ? 'completed' : 'failed',
        error_message: result.error,
        details: JSON.stringify({
          source: 'ninemindsreporting_extension',
          targetTenantId: tenantId,
          result,
          duration_ms: Date.now() - startTime,
        }),
      });

    observabilityLogger.info('Start Premium trial completed', {
      event_type: 'tenant_management_action_completed',
      action: 'start_premium_trial',
      tenant_id: tenantId,
      success: result.success,
      duration_ms: Date.now() - startTime,
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `30-day Premium trial started for tenant ${tenantId}`,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
      }, { status: 400 });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    observabilityLogger.error('Start Premium trial failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'start_premium_trial',
    });

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
