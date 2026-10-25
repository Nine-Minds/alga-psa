'use server';

import { createTenantKnex, listInvoiceAuditHistory, type InvoiceHistoryEntry } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

/**
 * Lifecycle audit trail (finalize / unfinalize / delete) for one invoice,
 * oldest first. MSP-only: client-portal users never see internal audit rows.
 */
export const getInvoiceHistory = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<InvoiceHistoryEntry[] | ActionPermissionError> => {
  if (user.user_type === 'client' || !await hasPermission(user, 'invoice', 'read')) {
    return permissionError('Permission denied: invoice read required', 'msp/invoicing:errors.permissions.invoiceRead');
  }
  const { knex } = await createTenantKnex();
  return listInvoiceAuditHistory(knex, tenant, invoiceId);
});
