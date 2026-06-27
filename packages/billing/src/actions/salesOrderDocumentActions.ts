'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';

import { createPDFGenerationService } from '../services/pdfGenerationService';

/**
 * Generate a Sales Order document (Phase 1: the standard Order Confirmation) as a PDF.
 * Returns the bytes as a plain number[] so it can cross the server-action / route boundary.
 * Lives in billing because the render pipeline does; inventory cannot depend on billing.
 */
export type SalesOrderDocumentType = 'sales-order' | 'packing-slip' | 'pick-list';

// Note: a 'use server' file may only export async functions (plus erased types) — no object/const
// exports, or Next throws "use server file can only export async functions".
export const downloadSalesOrderPDF = withAuth(
  async (
    user,
    { tenant },
    soId: string,
    documentType: SalesOrderDocumentType = 'sales-order',
  ): Promise<{ pdfData: number[]; soNumber: string; documentType: SalesOrderDocumentType }> => {
    if (!(await hasPermission(user, 'sales_order', 'read'))) {
      throw new Error('Permission denied: cannot download sales order documents');
    }

    const { knex } = await createTenantKnex();
    const so = await knex('sales_orders').where({ tenant, so_id: soId }).first();
    if (!so) {
      throw new Error('Sales order not found');
    }

    const pdfGenerationService = createPDFGenerationService(tenant);
    const pdfBuffer = await pdfGenerationService.generatePDF({
      salesOrderId: soId,
      salesOrderDocumentType: documentType,
      userId: user.user_id,
    });

    return { pdfData: Array.from(pdfBuffer), soNumber: so.so_number, documentType };
  },
);
