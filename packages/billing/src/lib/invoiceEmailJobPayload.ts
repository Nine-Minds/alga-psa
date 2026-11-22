/**
 * The invoice-email job payload contract, in one place.
 *
 * Authorisation is NOT done here: every caller must already have established
 * its own right to send — the internal MSP path through the `invoice:send`
 * capability, the client portal through invoice ownership. This module exists
 * so those two entry points cannot drift apart as the job handler's
 * expectations change, and it stays free of service imports so it can be
 * imported (and tested) without pulling in the billing action layer.
 */
export type InvoiceEmailJobPayload = {
  invoiceIds: string[];
  tenantId: string;
  user_id: string;
  senderId?: string;
  steps: Array<{
    stepName: string;
    type: 'pdf_generation' | 'email_sending';
    metadata: { invoiceId: string; tenantId: string };
  }>;
  metadata: { user_id: string; invoice_count: number; tenantId: string };
};

export function buildInvoiceEmailJobPayload(options: {
  tenant: string;
  userId: string;
  invoiceIds: string[];
  senderId?: string;
  /** Human-readable invoice label used in step names; defaults to the invoice id. */
  labelFor?: (invoiceId: string) => string;
}): InvoiceEmailJobPayload {
  const { tenant, userId, invoiceIds, senderId, labelFor } = options;
  const steps: InvoiceEmailJobPayload['steps'] = invoiceIds.flatMap((invoiceId) => {
    const label = labelFor ? labelFor(invoiceId) : `Invoice ${invoiceId}`;
    return [
      {
        stepName: `PDF Generation for ${label}`,
        type: 'pdf_generation' as const,
        metadata: { invoiceId, tenantId: tenant },
      },
      {
        stepName: `Email Sending for ${label}`,
        type: 'email_sending' as const,
        metadata: { invoiceId, tenantId: tenant },
      },
    ];
  });

  return {
    invoiceIds,
    tenantId: tenant,
    user_id: userId,
    ...(senderId ? { senderId } : {}),
    steps,
    metadata: { user_id: userId, invoice_count: invoiceIds.length, tenantId: tenant },
  };
}
