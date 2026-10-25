/**
 * GET /api/labels/templates?labelClass=ticket-work-tag|asset-identity|stock-unit-identity
 *
 * Read-only lookup for the print dialog: the templates a tenant can print a label class with and the
 * one that is the default. Session-authenticated in-handler (withAuth), internal users only, and the
 * caller needs `ticket:read` / `asset:read` matching the class. No record access, nothing written.
 * Same middleware skip-list treatment as POST /api/labels/pdf.
 */

import { AuthenticationError, withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { listLabelTemplatesForTenant } from '@alga-psa/billing/services';
import { isLabelClass, type LabelClass } from '@alga-psa/types';

const RBAC_RESOURCE_BY_CLASS: Record<LabelClass, string> = {
  'ticket-work-tag': 'ticket',
  'asset-identity': 'asset',
  'stock-unit-identity': 'inventory',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const listTemplates = withAuth(async (user, { tenant }, labelClass: LabelClass) => {
  if (user.user_type !== 'internal' || !(await hasPermission(user, RBAC_RESOURCE_BY_CLASS[labelClass], 'read'))) {
    return null;
  }
  return listLabelTemplatesForTenant(tenant, labelClass);
});

export async function GET(request: Request) {
  const labelClass = new URL(request.url).searchParams.get('labelClass');
  if (!isLabelClass(labelClass)) {
    return json(400, { error: 'labelClass must be a valid label class.' });
  }
  try {
    const result = await listTemplates(labelClass);
    // Same answer as "not found" for a caller who may not print this class.
    return result ? json(200, result) : json(404, { error: 'Not found.' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return json(401, { error: 'Not authenticated.' });
    }
    return json(500, { error: 'Failed to load label templates.' });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
