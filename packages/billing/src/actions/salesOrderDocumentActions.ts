'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import { TenantEmailService } from '@alga-psa/email';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

import { createPDFGenerationService } from '../services/pdfGenerationService';
import {
  buildSalesOrderConfirmationEmailContent,
  dedupeRecipients,
} from '../lib/salesOrderConfirmationEmail';
import { SalesOrderDocumentError } from '../lib/salesOrderDocumentError';

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
    const { t } = await getServerTranslation(undefined, 'features/inventory');

    if (!(await hasPermission(user, 'sales_order', 'read'))) {
      throw new SalesOrderDocumentError(
        t(
          'salesOrders.errors.downloadPermissionDenied',
          'Permission denied: cannot download sales order documents',
        ),
        'permission_denied',
      );
    }

    const { knex } = await createTenantKnex();
    const so = await knex('sales_orders').where({ tenant, so_id: soId }).first();
    if (!so) {
      throw new SalesOrderDocumentError(
        t('salesOrders.errors.notFound', 'Sales order not found'),
        'not_found',
      );
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

/**
 * Resolve the recipient email(s) for a Sales Order: any explicitly-passed addresses, else the
 * client's billing email. (SOs carry only a client_id — no contact — so the client billing email is
 * the canonical recipient, mirroring how a quote falls back to clients.billing_email.)
 */
async function resolveSalesOrderRecipients(
  knex: any,
  tenant: string,
  clientId: string | null | undefined,
  explicit: string[] = [],
): Promise<{ recipients: string[]; clientName: string | null }> {
  const client = clientId
    ? await knex('clients')
        .select('billing_email', 'client_name')
        .where({ tenant, client_id: clientId })
        .first()
    : null;
  const recipients = dedupeRecipients([...explicit, client?.billing_email ?? '']);
  return { recipients, clientName: client?.client_name ?? null };
}

/**
 * Email the Sales Order confirmation to the client with the rendered PDF auto-attached (F205).
 * Best-effort send through the tenant's configured outbound provider, mirroring the quote send path.
 * Outward-facing, so it is an explicit user action (not a silent auto-send on confirm) and reports
 * the resolved recipients back for the UI to confirm.
 */
export const emailSalesOrderConfirmation = withAuth(
  async (
    user,
    { tenant },
    soId: string,
    opts?: { recipients?: string[]; message?: string },
  ): Promise<{ success: boolean; recipients: string[]; messageId?: string; error?: string }> => {
    const { t } = await getServerTranslation(undefined, 'features/inventory');

    if (!(await hasPermission(user, 'sales_order', 'update'))) {
      throw new SalesOrderDocumentError(
        t(
          'salesOrders.errors.emailPermissionDenied',
          'Permission denied: cannot email sales order documents',
        ),
        'permission_denied',
      );
    }

    const { knex } = await createTenantKnex();
    const so = await knex('sales_orders').where({ tenant, so_id: soId }).first();
    if (!so) {
      throw new SalesOrderDocumentError(
        t('salesOrders.errors.notFound', 'Sales order not found'),
        'not_found',
      );
    }

    const { recipients, clientName } = await resolveSalesOrderRecipients(
      knex,
      tenant,
      so.client_id,
      opts?.recipients ?? [],
    );
    if (recipients.length === 0) {
      return {
        success: false,
        recipients: [],
        error: t(
          'salesOrders.errors.noRecipientEmail',
          'No recipient email on file for this client.',
        ),
      };
    }

    const pdfBuffer = await createPDFGenerationService(tenant).generatePDF({
      salesOrderId: soId,
      salesOrderDocumentType: 'sales-order',
      userId: user.user_id,
    });

    const soNumber = so.so_number ?? soId;
    const tenantRow = await knex('tenants').select('client_name').where({ tenant }).first();
    const content = buildSalesOrderConfirmationEmailContent({
      soNumber,
      clientName,
      companyName: tenantRow?.client_name ?? null,
      message: opts?.message ?? null,
    });

    const result = await TenantEmailService.getInstance(tenant).sendEmail({
      tenantId: tenant,
      to: recipients,
      subject: content.subject,
      html: content.html,
      text: content.text,
      attachments: [
        { filename: content.attachmentFilename, content: pdfBuffer, contentType: 'application/pdf' },
      ],
      entityType: 'sales_order',
      entityId: soId,
      userId: user.user_id,
    });

    return {
      success: result.success,
      recipients,
      messageId: result.messageId,
      error: result.success
        ? undefined
        : result.error ?? t('salesOrders.errors.emailSendFailed', 'Email failed to send.'),
    };
  },
);
