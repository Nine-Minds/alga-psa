import logger from '@shared/core/logger';

export interface XeroInvoiceLinePayload {
  lineId: string;
  amountCents: number;
  description?: string | null;
  itemCode?: string | null;
  tracking?: Record<string, unknown> | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
}

export interface XeroInvoicePayload {
  invoiceId: string;
  contactId?: string | null;
  currency?: string | null;
  amountCents: number;
  lines: XeroInvoiceLinePayload[];
  metadata?: Record<string, unknown>;
}

/**
 * Thin scaffold around the future Xero REST API client.
 * TODO: replace stub implementations with real OAuth + API calls.
 */
export class XeroClientService {
  private constructor(
    private readonly tenantId: string,
    private readonly connectionId: string
  ) {}

  static async create(tenantId: string, connectionId?: string | null): Promise<XeroClientService> {
    // TODO: hydrate OAuth credentials + tenant connection metadata.
    const resolvedConnectionId = connectionId ?? 'default';
    logger.debug('[XeroClientService] creating client', { tenantId, resolvedConnectionId });
    return new XeroClientService(tenantId, resolvedConnectionId);
  }

  async createInvoices(payloads: XeroInvoicePayload[]): Promise<Array<{ invoiceId: string }>> {
    // TODO: invoke Xero Invoices API.
    logger.info('[XeroClientService] createInvoices stub invoked', {
      tenantId: this.tenantId,
      connectionId: this.connectionId,
      invoiceCount: payloads.length
    });

    return payloads.map((invoice, index) => ({
      invoiceId: `XERO-STUB-${invoice.invoiceId || index.toString()}`.slice(0, 36)
    }));
  }
}
