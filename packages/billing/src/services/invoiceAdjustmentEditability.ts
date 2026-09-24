import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { findInvoiceAccountingMapping } from './accountingSync/invoiceExportGuards';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string,
) {
  return tenantDb(conn, tenant).table<Row>(tableExpression);
}

export type InvoiceAdjustmentBlockCode =
  | 'not_found'
  | 'finalized'
  | 'paid'
  | 'cancelled'
  | 'exported';

export interface InvoiceAdjustmentCapability {
  editable: boolean;
  code: InvoiceAdjustmentBlockCode | null;
  reason: string | null;
  isManualOrigin: boolean;
  currencyCode: string | null;
}

/**
 * Single source of truth for "may this draft accept manual adjustments?".
 *
 * It lives beside the accounting-export guard so the writer that locks under it
 * and the capability the editor renders can never drift apart. Every mutation
 * path re-runs this under `FOR UPDATE` inside its write transaction, so a
 * concurrent finalize/export/void that commits mid-edit is observed rather than
 * raced.
 */
export async function inspectInvoiceEditable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
  options: { forUpdate?: boolean } = {},
): Promise<{ invoice: Record<string, any> | null; capability: InvoiceAdjustmentCapability }> {
  const query = tenantScopedTable<Record<string, any>>(conn, tenant, 'invoices')
    .where({ invoice_id: invoiceId, tenant });
  const invoice = options.forUpdate
    ? await query.clone().forUpdate().first()
    : await query.clone().first();

  if (!invoice) {
    return {
      invoice: null,
      capability: {
        editable: false,
        code: 'not_found',
        reason: 'Invoice not found',
        isManualOrigin: false,
        currencyCode: null,
      },
    };
  }

  const base = {
    isManualOrigin: Boolean(invoice.is_manual),
    currencyCode: (invoice.currency_code as string | null) ?? null,
  };
  const status = typeof invoice.status === 'string' ? invoice.status.toLowerCase() : '';

  if (status === 'cancelled') {
    return {
      invoice,
      capability: {
        ...base,
        editable: false,
        code: 'cancelled',
        reason: 'Cannot modify a cancelled invoice. Cancelled invoices remain historical.',
      },
    };
  }
  if (status === 'paid') {
    return {
      invoice,
      capability: {
        ...base,
        editable: false,
        code: 'paid',
        reason: 'Cannot modify a paid invoice. Issue a credit note or a separate adjustment instead.',
      },
    };
  }
  if (invoice.finalized_at || (status && status !== 'draft')) {
    return {
      invoice,
      capability: {
        ...base,
        editable: false,
        code: 'finalized',
        reason: 'Only draft invoices can be adjusted. Unfinalize this invoice first or issue a separate adjustment.',
      },
    };
  }

  const exported = await findInvoiceAccountingMapping(conn as Knex, tenant, invoiceId);
  if (exported) {
    return {
      invoice,
      capability: {
        ...base,
        editable: false,
        code: 'exported',
        reason: 'This invoice is posted to an accounting system. Adjustments are locked; void and reissue or issue a credit note.',
      },
    };
  }

  return {
    invoice,
    capability: { ...base, editable: true, code: null, reason: null },
  };
}
