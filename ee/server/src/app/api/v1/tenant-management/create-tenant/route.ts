/**
 * Tenant Creation API - Creates a new tenant via Temporal workflow
 *
 * POST /api/v1/tenant-management/create-tenant
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 * All actions are logged to the unified extension_audit_logs table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { observabilityLogger } from '@/lib/observability/logging';
import {
  startTenantCreationWorkflow,
  type TenantCreationInput,
  type TenantCreationResult,
} from '@ee/lib/tenant-management/workflowClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

/**
 * POST /api/v1/tenant-management/create-tenant
 * Creates a new tenant via Temporal workflow
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    // Check for internal ext-proxy request first
    const internalUser = getInternalUserInfo(request);
    let userTenant: string;
    let userId: string;
    let userEmail: string | undefined;

    if (internalUser) {
      userTenant = internalUser.tenant;
      userId = internalUser.user_id;
      userEmail = internalUser.email;
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

    // Verify user is from master tenant
    if (userTenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { companyName, firstName, lastName, email, licenseCount } = body;

    // Validate required fields
    if (!companyName || !firstName || !lastName || !email) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: companyName, firstName, lastName, email',
      }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid email format',
      }, { status: 400 });
    }

    // LOG: Action initiated
    observabilityLogger.info('Tenant creation initiated', {
      event_type: 'tenant_management_action',
      action: 'create_tenant',
      company_name: companyName,
      admin_email: email,
      triggered_by: userId,
      triggered_by_email: userEmail,
    });

    // Log to unified extension audit table (pending status)
    const knex = await getAdminConnection();
    const [auditRecord] = await knex('extension_audit_logs')
      .insert({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.create',
        user_id: userId,
        user_email: userEmail,
        resource_type: 'tenant',
        resource_id: 'pending',
        resource_name: companyName,
        status: 'pending',
        details: JSON.stringify({
          source: 'ninemindsreporting_extension',
          company_name: companyName,
          admin_email: email,
          license_count: licenseCount || 5,
        }),
      })
      .returning('log_id');

    // Trigger existing Temporal workflow
    const workflowInput: TenantCreationInput = {
      tenantName: companyName,
      adminUser: {
        firstName,
        lastName,
        email,
      },
      companyName,
      clientName: companyName,
      licenseCount: licenseCount || 5,
      // No checkout session - this is manual creation
    };

    const workflowResult = await startTenantCreationWorkflow(workflowInput);

    if (!workflowResult.available || !workflowResult.result) {
      return NextResponse.json({
        success: false,
        error: workflowResult.error || 'Temporal workflow client not available',
      }, { status: 503 });
    }

    const { workflowId, runId, result } = workflowResult;

    // LOG: Workflow started
    observabilityLogger.info('Tenant creation workflow started', {
      event_type: 'tenant_management_workflow_started',
      action: 'create_tenant',
      workflow_id: workflowId,
      run_id: runId,
    });

    // Update audit record with workflow ID
    await knex('extension_audit_logs')
      .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
      .update({
        workflow_id: workflowId,
        details: JSON.stringify({
          source: 'ninemindsreporting_extension',
          company_name: companyName,
          admin_email: email,
          license_count: licenseCount || 5,
          workflow_id: workflowId,
          run_id: runId,
        }),
      });

    // For manual creation, we can wait for result (it's not that long)
    // Or return immediately and let user check status
    // Let's wait for a reasonable timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Workflow timeout')), 120000) // 2 min timeout
    );

    try {
      const tenantResult = await Promise.race([result, timeoutPromise]) as TenantCreationResult;

      // Update audit with final result
      await knex('extension_audit_logs')
        .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
        .update({
          resource_id: tenantResult.tenantId || 'unknown',
          status: tenantResult.success !== false ? 'completed' : 'failed',
          error_message: tenantResult.success === false ? 'Workflow execution failed' : undefined,
          details: JSON.stringify({
            source: 'ninemindsreporting_extension',
            company_name: companyName,
            admin_email: email,
            result: tenantResult,
            duration_ms: Date.now() - startTime,
          }),
        });

      // LOG: Workflow completed
      observabilityLogger.info('Tenant creation workflow completed', {
        event_type: 'tenant_management_action_completed',
        action: 'create_tenant',
        workflow_id: workflowId,
        tenant_id: tenantResult.tenantId,
        success: tenantResult.success !== false,
        duration_ms: Date.now() - startTime,
      });

      if (tenantResult.success !== false) {
        return NextResponse.json({
          success: true,
          workflowId,
          tenantId: tenantResult.tenantId,
          adminUserId: tenantResult.adminUserId,
          message: `Tenant "${companyName}" created successfully. Welcome email sent to ${email}.`,
        });
      } else {
        return NextResponse.json({
          success: false,
          workflowId,
          error: 'Tenant creation failed',
        }, { status: 500 });
      }
    } catch (timeoutError) {
      // Workflow is still running, return workflow ID for tracking
      observabilityLogger.info('Tenant creation workflow still running', {
        event_type: 'tenant_management_workflow_running',
        action: 'create_tenant',
        workflow_id: workflowId,
      });

      // Update audit to show workflow is still running
      await knex('extension_audit_logs')
        .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
        .update({
          status: 'running',
          details: JSON.stringify({
            source: 'ninemindsreporting_extension',
            company_name: companyName,
            admin_email: email,
            license_count: licenseCount || 5,
            workflow_id: workflowId,
            run_id: runId,
            note: 'Workflow still running after 2 minute timeout',
          }),
        });

      return NextResponse.json({
        success: true,
        workflowId,
        status: 'running',
        message: `Tenant creation started. Workflow ID: ${workflowId}. Check Temporal UI for status.`,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    observabilityLogger.error('Tenant creation failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'create_tenant',
    });

    if (
      errorMessage.includes('Access denied') ||
      errorMessage.includes('Authentication')
    ) {
      return NextResponse.json({ success: false, error: errorMessage }, { status: 403 });
    }

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
