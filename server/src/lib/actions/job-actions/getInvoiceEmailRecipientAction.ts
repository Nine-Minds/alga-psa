'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from '../user-actions/userActions';
import { getInvoiceForRendering } from '../invoiceQueries';
import { getClientById } from '../client-actions/clientActions';
import ContactModel from 'server/src/lib/models/contact';
import { formatCurrency } from 'server/src/lib/utils/formatters';

export interface InvoiceEmailRecipientInfo {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;

  // Recipient info
  recipientEmail: string;
  recipientName: string;
  recipientSource: 'billing_contact' | 'billing_email' | 'client_email' | 'none';

  // Invoice details for display
  totalAmount: string;
  currencyCode: string;
  dueDate: string | null;
  invoiceDate: string | null;

  // For the email
  companyName: string;
  fromEmail: string;
}

export interface GetInvoiceEmailRecipientsResult {
  recipients: InvoiceEmailRecipientInfo[];
  errors: Array<{ invoiceId: string; error: string }>;
}

/**
 * Gets recipient information for invoice emails before sending.
 * Used by the confirmation dialog to show users who will receive the email.
 */
export async function getInvoiceEmailRecipientAction(invoiceIds: string[]): Promise<GetInvoiceEmailRecipientsResult> {
  const { knex, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!tenant || !currentUser) {
    throw new Error('Tenant or user not found');
  }

  if (!invoiceIds || invoiceIds.length === 0) {
    throw new Error('No invoice IDs provided');
  }

  const recipients: InvoiceEmailRecipientInfo[] = [];
  const errors: Array<{ invoiceId: string; error: string }> = [];

  const fromEmail = process.env.EMAIL_FROM || 'noreply@example.com';

  // Get tenant company name
  const tenantRecord = await knex('tenants').where({ tenant }).first();
  const companyName = tenantRecord?.company_name || 'Your Company';

  for (const invoiceId of invoiceIds) {
    try {
      // Get invoice details
      const invoice = await getInvoiceForRendering(invoiceId);
      if (!invoice || !invoice.invoice_number) {
        errors.push({ invoiceId, error: `Invoice not found` });
        continue;
      }

      // Get client details
      const client = await getClientById(invoice.client_id);
      if (!client) {
        errors.push({ invoiceId, error: `Client not found` });
        continue;
      }

      // Determine recipient email with priority order
      let recipientEmail = '';
      let recipientName = client.client_name;
      let recipientSource: InvoiceEmailRecipientInfo['recipientSource'] = 'none';

      if (client.billing_contact_id) {
        const contact = await ContactModel.get(knex, client.billing_contact_id);
        if (contact && contact.email) {
          recipientEmail = contact.email;
          recipientName = contact.full_name;
          recipientSource = 'billing_contact';
        }
      }

      if (!recipientEmail && client.billing_email) {
        recipientEmail = client.billing_email;
        recipientSource = 'billing_email';
      }

      if (!recipientEmail && client.location_email) {
        recipientEmail = client.location_email;
        recipientSource = 'client_email';
      }

      // Format the total amount with proper currency
      const currencyCode = invoice.currencyCode || 'USD';
      const totalAmount = formatCurrency(invoice.total_amount / 100, 'en-US', currencyCode);

      // Format dates
      const invoiceDate = invoice.invoice_date
        ? new Date(invoice.invoice_date).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
          })
        : null;

      const dueDate = invoice.due_date
        ? new Date(invoice.due_date).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
          })
        : null;

      recipients.push({
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        clientName: client.client_name,
        recipientEmail,
        recipientName,
        recipientSource,
        totalAmount,
        currencyCode,
        dueDate,
        invoiceDate,
        companyName,
        fromEmail
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ invoiceId, error: errorMessage });
    }
  }

  return { recipients, errors };
}
