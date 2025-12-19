/**
 * Tenant Creation API - Creates a new tenant via Temporal workflow
 *
 * POST /api/v1/tenant-management/create-tenant
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 * All actions are logged to the unified extension_audit_logs table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { options } from '@/app/api/auth/[...nextauth]/options';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { observabilityLogger } from '@/lib/observability/logging';
import { TenantWorkflowClient } from '../../../../../../../temporal-workflows/src/client';
import type { TenantCreationInput, TenantCreationResult } from '../../../../../../../temporal-workflows/src/types/workflow-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/** CORS headers for extension iframe access */
function corsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function jsonResponse(data: unknown, init: ResponseInit & { request?: NextRequest } = {}): NextResponse {
  const headers = init.request ? corsHeaders(init.request) : {};
  return NextResponse.json(data, { ...init, headers: { ...headers, ...init.headers } });
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/**
 * POST /api/v1/tenant-management/create-tenant
 * Creates a new tenant via Temporal workflow
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    const session = await getServerSession(options);

    if (!session?.user) {
      return jsonResponse(
        { success: false, error: 'Unauthorized' },
        { status: 401, request }
      );
    }

    // Verify user is from master tenant
    if (session.user.tenant !== MASTER_BILLING_TENANT_ID) {
      return jsonResponse(
        { success: false, error: 'Forbidden' },
        { status: 403, request }
      );
    }

    const body = await request.json();
    const { companyName, firstName, lastName, email, licenseCount } = body;

    // Validate required fields
    if (!companyName || !firstName || !lastName || !email) {
      return jsonResponse({
        success: false,
        error: 'Missing required fields: companyName, firstName, lastName, email',
      }, { status: 400, request });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return jsonResponse({
        success: false,
        error: 'Invalid email format',
      }, { status: 400, request });
    }

    // LOG: Action initiated
    observabilityLogger.info('Tenant creation initiated', {
      event_type: 'tenant_management_action',
      action: 'create_tenant',
      company_name: companyName,
      admin_email: email,
      triggered_by: session.user.user_id,
      triggered_by_email: session.user.email,
    });

    // Log to unified extension audit table (pending status)
    const knex = await getAdminConnection();
    const [auditRecord] = await knex('extension_audit_logs')
      .insert({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.create',
        user_id: session.user.user_id,
        user_email: session.user.email,
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
    const client = await TenantWorkflowClient.create();

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

    const { workflowId, runId, result } = await client.startTenantCreation(workflowInput);

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
      const workflowResult = await Promise.race([result, timeoutPromise]) as TenantCreationResult;

      // Update audit with final result
      await knex('extension_audit_logs')
        .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
        .update({
          resource_id: workflowResult.tenantId || 'unknown',
          status: workflowResult.success !== false ? 'completed' : 'failed',
          error_message: workflowResult.success === false ? 'Workflow execution failed' : undefined,
          details: JSON.stringify({
            source: 'ninemindsreporting_extension',
            company_name: companyName,
            admin_email: email,
            result: workflowResult,
            duration_ms: Date.now() - startTime,
          }),
        });

      // LOG: Workflow completed
      observabilityLogger.info('Tenant creation workflow completed', {
        event_type: 'tenant_management_action_completed',
        action: 'create_tenant',
        workflow_id: workflowId,
        tenant_id: workflowResult.tenantId,
        success: workflowResult.success !== false,
        duration_ms: Date.now() - startTime,
      });

      // Close the client connection
      await client.close();

      if (workflowResult.success !== false) {
        return jsonResponse({
          success: true,
          workflowId,
          tenantId: workflowResult.tenantId,
          adminUserId: workflowResult.adminUserId,
          message: `Tenant "${companyName}" created successfully. Welcome email sent to ${email}.`,
        }, { request });
      } else {
        return jsonResponse({
          success: false,
          workflowId,
          error: 'Tenant creation failed',
        }, { status: 500, request });
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

      // Close the client connection
      await client.close();

      return jsonResponse({
        success: true,
        workflowId,
        status: 'running',
        message: `Tenant creation started. Workflow ID: ${workflowId}. Check Temporal UI for status.`,
      }, { request });
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
      return jsonResponse(
        { success: false, error: errorMessage },
        { status: 403, request }
      );
    }

    return jsonResponse({
      success: false,
      error: errorMessage,
    }, { status: 500, request });
  }
}
