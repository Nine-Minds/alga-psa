/**
 * Shared handler for Appliance Console operator-action triggers.
 *
 * Every trigger does the same five things: gate on the master tenant, validate
 * the body, write a `pending` audit row, start the deterministic Temporal
 * workflow, and mark the row `running`. The status poller
 * (GET /workflows/:id) closes the row when the run ends.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportAuditService, extractClientInfo } from '@ee/lib/platformReports';
import type { AuditEventType } from '@ee/lib/platformReports';
import { assertMasterTenantAccess, isMasterTenantAuthError } from '@ee/lib/auth/masterTenantAccess';
import { getApplianceTenant } from './algaLicenseAdminClient';
import { startApplianceWorkflow, type ApplianceAction } from './workflowClient';
import { ActionValidationError, isTenantId, type OperatorMeta } from './actionInputs';

export interface TriggerSpec<TArgs> {
  action: ApplianceAction;
  eventType: AuditEventType;
  /** Validate the JSON body into workflow args. Throw ActionValidationError for a 400. */
  parse: (body: Record<string, unknown>, tenantId: string | null, base: { auditLogId: string; operator: OperatorMeta }) => TArgs;
}

/** Keys that never belong in an audit row's details. */
const REDACTED_KEYS = new Set(['__method', 'jwt', 'token', 'code', 'install_code']);

export function auditDetailsFromBody(action: ApplianceAction, body: Record<string, unknown>): Record<string, unknown> {
  const details: Record<string, unknown> = { action };
  for (const [k, v] of Object.entries(body)) {
    if (REDACTED_KEYS.has(k)) continue;
    details[k] = v;
  }
  return details;
}

async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Placeholder segment in the workflow id for actions that create the tenant. */
export const NEW_TENANT_SEGMENT = 'new';

export async function handleApplianceTrigger<TArgs>(
  spec: TriggerSpec<TArgs>,
  request: NextRequest,
  tenantId: string | null,
  presetBody?: Record<string, unknown>,
): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const audit = new PlatformReportAuditService(masterTenantId);

    if (tenantId !== null && !isTenantId(tenantId)) {
      return NextResponse.json({ success: false, error: 'Invalid tenant id' }, { status: 400 });
    }

    const body = presetBody ?? (await readJsonBody(request));

    // Validate before touching the audit log so a bad request leaves no trace.
    // The audit id is not known yet; parse against a placeholder and patch it in after.
    let args: TArgs;
    try {
      args = spec.parse(body, tenantId, { auditLogId: '', operator: { userId, userEmail: userEmail ?? null } });
    } catch (error) {
      if (error instanceof ActionValidationError) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }
      throw error;
    }

    let resourceName: string | null = null;
    if (tenantId) {
      const detail = await getApplianceTenant(tenantId);
      if (!detail) {
        return NextResponse.json({ success: false, error: 'Appliance tenant not found' }, { status: 404 });
      }
      resourceName = detail.tenant.company_name;
    }

    const clientInfo = extractClientInfo(request);
    const auditLogId = await audit.logEvent({
      eventType: spec.eventType,
      userId,
      userEmail,
      resourceType: 'appliance',
      resourceId: tenantId,
      resourceName,
      status: 'pending',
      details: auditDetailsFromBody(spec.action, body),
      ...clientInfo,
    });
    if (!auditLogId) {
      return NextResponse.json({ success: false, error: 'Failed to record the audit entry' }, { status: 500 });
    }

    const argsWithAudit = { ...(args as object), auditLogId } as TArgs;

    let workflowId: string;
    try {
      ({ workflowId } = await startApplianceWorkflow({
        action: spec.action,
        tenantId: tenantId ?? NEW_TENANT_SEGMENT,
        auditLogId,
        args: argsWithAudit,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await audit.updateLog(auditLogId, { status: 'failed', errorMessage: `Workflow start failed: ${message}` });
      console.error(`[appliance-installs/${spec.action}] workflow start failed:`, error);
      return NextResponse.json({ success: false, error: 'Failed to start the action workflow' }, { status: 503 });
    }

    await audit.updateLog(auditLogId, { workflowId, status: 'running' });

    return NextResponse.json({ success: true, data: { workflow_id: workflowId, audit_log_id: auditLogId } }, { status: 202 });
  } catch (error) {
    console.error(`[appliance-installs/${spec.action}] POST error:`, error);
    if (isMasterTenantAuthError(error)) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

interface RouteContext {
  params: Promise<{ tenantId: string }>;
}

/** Build a Next.js POST handler for a per-tenant action. */
export function createTenantActionRoute<TArgs>(spec: TriggerSpec<TArgs>) {
  return async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const { tenantId } = await context.params;
    return handleApplianceTrigger(spec, request, tenantId);
  };
}
