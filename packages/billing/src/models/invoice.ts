/**
 * @alga-psa/billing - Invoice Model
 *
 * Data access layer for invoice entities.
 * Migrated from server/src/lib/models/invoice.ts
 *
 * Key changes from original:
 * - Tenant is an explicit parameter (not from getCurrentTenantId)
 * - This decouples the model from Next.js runtime
 * - Class-based API converted to object with methods
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  IInvoice,
  IInvoiceCharge,
  IInvoiceChargeRecurringDetailPeriod,
  IInvoiceTemplate,
  ICustomField,
  IConditionalRule,
  IInvoiceAnnotation,
  InvoiceViewModel,
} from '@alga-psa/types';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';
import { publishEvent } from '@alga-psa/event-bus/publishers';

type InvoiceChargeDetailPeriodRow = {
  tenant?: string;
  item_id: string;
  service_period_start?: string | Date | null;
  service_period_end?: string | Date | null;
  billing_timing?: 'arrears' | 'advance' | null;
};

type InvoiceChargeDisplayRow = IInvoiceCharge & {
  name?: string | null;
};

type InvoiceAnnotationRow = IInvoiceAnnotation & {
  tenant: string;
};

type InvoiceClientDetailsRow = {
  client_name?: string | null;
  properties?: unknown;
  location_address?: string | null;
};

type InvoiceContactRow = {
  full_name?: string | null;
};

type InvoiceTenantClientDetailsRow = {
  client_id?: string | null;
  client_name?: string | null;
  location_address?: string | null;
};

type RecurringInvoiceSummaryRow = {
  invoice_id?: string | null;
  service_period_start?: string | Date | null;
  service_period_end?: string | Date | null;
  invoice_window_start?: string | Date | null;
  invoice_window_end?: string | Date | null;
  cadence_owner?: string | null;
};

type CustomFieldRow = ICustomField & {
  tenant: string;
};

type ConditionalRuleRow = IConditionalRule & {
  tenant: string;
  template_id: string;
};

const GLOBAL_TEMPLATE_LOOKUP = 'global-template-lookup';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string
) {
  return tenantDb(conn, tenant).table<Row>(tableExpression);
}

function normalizeRecurringDetailPeriodDate(
  value: string | Date | null | undefined
): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return null;
}

function sortInvoiceChargesForDisplay(charges: IInvoiceCharge[]): IInvoiceCharge[] {
  return charges
    .map((charge, index) => ({ charge, index }))
    .sort((left, right) => {
      const leftStart = left.charge.service_period_start;
      const rightStart = right.charge.service_period_start;
      const leftEnd = left.charge.service_period_end;
      const rightEnd = right.charge.service_period_end;
      const leftHasPeriod = typeof leftStart === 'string' && leftStart.length > 0;
      const rightHasPeriod = typeof rightStart === 'string' && rightStart.length > 0;

      if (leftHasPeriod && rightHasPeriod) {
        if (leftStart !== rightStart) {
          return String(leftStart).localeCompare(String(rightStart));
        }
        if (leftEnd !== rightEnd) {
          return String(leftEnd ?? '').localeCompare(String(rightEnd ?? ''));
        }
      } else if (leftHasPeriod !== rightHasPeriod) {
        return leftHasPeriod ? -1 : 1;
      }

      return left.index - right.index;
    })
    .map(({ charge }) => charge);
}

function attachCanonicalRecurringDetailPeriods(
  charges: IInvoiceCharge[],
  detailRows: InvoiceChargeDetailPeriodRow[]
): IInvoiceCharge[] {
  const detailRowsByItemId = new Map<string, InvoiceChargeDetailPeriodRow[]>();

  for (const detailRow of detailRows) {
    const existing = detailRowsByItemId.get(detailRow.item_id) ?? [];
    existing.push(detailRow);
    detailRowsByItemId.set(detailRow.item_id, existing);
  }

  return charges.map((charge) => {
    const chargeDetailRows = detailRowsByItemId.get(charge.item_id);
    if (!chargeDetailRows || chargeDetailRows.length === 0) {
      // Historical flat invoices stay parent-only when canonical detail rows do not exist.
      return charge;
    }

    const recurringDetailPeriods: IInvoiceChargeRecurringDetailPeriod[] = chargeDetailRows
      .map((detailRow) => ({
        service_period_start: normalizeRecurringDetailPeriodDate(detailRow.service_period_start),
        service_period_end: normalizeRecurringDetailPeriodDate(detailRow.service_period_end),
        billing_timing: detailRow.billing_timing ?? null,
      }))
      .sort((left, right) => {
        if (left.service_period_start !== right.service_period_start) {
          return String(left.service_period_start ?? '').localeCompare(String(right.service_period_start ?? ''));
        }
        return String(left.service_period_end ?? '').localeCompare(String(right.service_period_end ?? ''));
      });

    const servicePeriodStarts = chargeDetailRows
      .map((detailRow) => normalizeRecurringDetailPeriodDate(detailRow.service_period_start))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort();
    const servicePeriodEnds = chargeDetailRows
      .map((detailRow) => normalizeRecurringDetailPeriodDate(detailRow.service_period_end))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort();
    const billingTimings = Array.from(
      new Set(
        chargeDetailRows
          .map((detailRow) => detailRow.billing_timing)
          .filter((value): value is 'arrears' | 'advance' => value === 'arrears' || value === 'advance')
      )
    );
    return {
      ...charge,
      service_period_start: servicePeriodStarts[0] ?? null,
      service_period_end: servicePeriodEnds[servicePeriodEnds.length - 1] ?? null,
      billing_timing: billingTimings.length === 1 ? billingTimings[0] : null,
      recurring_detail_periods: recurringDetailPeriods,
    };
  });
}

/**
 * Invoice model with tenant-explicit methods.
 * All methods require an explicit tenant parameter for multi-tenant safety.
 */
const Invoice = {
  /**
   * Create a new invoice.
   */
  create: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoice: Omit<IInvoice, 'invoice_id' | 'tenant'>
  ): Promise<IInvoice> => {
    if (!tenant) {
      throw new Error('Tenant context is required for creating invoice');
    }

    if (!Number.isInteger(invoice.total_amount)) {
      throw new Error('Total amount must be an integer');
    }

    const [createdInvoice] = await tenantScopedTable<IInvoice>(knexOrTrx, tenant, 'invoices')
      .insert({ ...invoice, tenant })
      .returning('*');

    return createdInvoice;
  },

  /**
   * Get an invoice by ID.
   */
  getById: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId: string
  ): Promise<IInvoice | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting invoice');
    }

    try {
      const invoice = await tenantScopedTable<IInvoice>(knexOrTrx, tenant, 'invoices')
        .where({
          invoice_id: invoiceId
        })
        .first();

      if (invoice) {
        invoice.invoice_charges = await Invoice.getInvoiceCharges(knexOrTrx, tenant, invoiceId);
        invoice.invoice_items = invoice.invoice_charges;
      }

      return invoice || null;
    } catch (error) {
      console.error(`Error getting invoice ${invoiceId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get invoice: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Update an invoice.
   */
  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId: string,
    updateData: Partial<IInvoice>
  ): Promise<IInvoice> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating invoice');
    }

    try {
      const [updatedInvoice] = await tenantScopedTable<IInvoice>(knexOrTrx, tenant, 'invoices')
        .where({
          invoice_id: invoiceId
        })
        .update(updateData)
        .returning('*');

      if (!updatedInvoice) {
        throw new Error(`Invoice ${invoiceId} not found in tenant ${tenant}`);
      }

      return updatedInvoice;
    } catch (error) {
      console.error(`Error updating invoice ${invoiceId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to update invoice: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Delete an invoice.
   */
  delete: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId: string
  ): Promise<boolean> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting invoice');
    }

    try {
      // Nullify invoice_id in payment_webhook_events
      const hasPaymentWebhookEvents = await knexOrTrx.schema.hasTable('payment_webhook_events');
      if (hasPaymentWebhookEvents) {
        await tenantScopedTable(knexOrTrx, tenant, 'payment_webhook_events')
          .where({ invoice_id: invoiceId })
          .update({ invoice_id: null });
      }

      const deleted = await tenantScopedTable(knexOrTrx, tenant, 'invoices')
        .where({
          invoice_id: invoiceId
        })
        .del();

      if (deleted === 0) {
        throw new Error(`Invoice ${invoiceId} not found in tenant ${tenant}`);
      }

      return true;
    } catch (error) {
      console.error(`Error deleting invoice ${invoiceId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to delete invoice: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Get all invoices for a tenant.
   */
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IInvoice[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for listing invoices');
    }

    try {
      const invoices = await tenantScopedTable<IInvoice>(knexOrTrx, tenant, 'invoices')
        .select('*');
      return invoices;
    } catch (error) {
      console.error(`Error getting all invoices in tenant ${tenant}:`, error);
      throw new Error(`Failed to get invoices: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Get a fully hydrated invoice view model for rendering.
   */
  getFullInvoiceById: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId: string
  ): Promise<InvoiceViewModel> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting full invoice details');
    }

    const parseMinorUnit = (value: unknown): number => {
      if (typeof value === 'number') {
        return Math.trunc(value);
      }
      if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
      }
      if (typeof value === 'bigint') {
        return Number(value);
      }
      return 0;
    };
    // Quantities are not minor units — they can be fractional (e.g. 4.25 hours
    // for hourly time charges), so parse them as decimals instead of truncating
    // to whole integers the way parseMinorUnit does for cents.
    const parseDecimal = (value: unknown): number => {
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isNaN(parsed) ? 0 : parsed;
      }
      if (typeof value === 'bigint') {
        return Number(value);
      }
      return 0;
    };
    const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
    const normalizeDateLikeString = (value: unknown): string => {
      if (typeof value === 'string') {
        return value.trim();
      }
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const year = value.getUTCFullYear();
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        const day = String(value.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return '';
    };

    const invoice = await tenantScopedTable<IInvoice>(knexOrTrx, tenant, 'invoices')
      .select(
        '*',
        knexOrTrx.raw('CAST(subtotal AS BIGINT) as subtotal'),
        knexOrTrx.raw('CAST(tax AS BIGINT) as tax'),
        knexOrTrx.raw('CAST(total_amount AS BIGINT) as total_amount'),
        knexOrTrx.raw('CAST(credit_applied AS BIGINT) as credit_applied')
      )
      .where({
        invoice_id: invoiceId
      })
      .first();

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const db = tenantDb(knexOrTrx, tenant);
    const clientQuery = db.table('clients as c');
    db.tenantJoin(clientQuery, 'client_locations as cl', 'c.client_id', 'cl.client_id', {
      type: 'left',
      on(join) {
        join.andOn(function () {
          this.on('cl.is_billing_address', '=', knexOrTrx.raw('true'))
            .orOn('cl.is_default', '=', knexOrTrx.raw('true'));
        });
      },
    });

    const tenantClientQuery = db.table('tenant_companies as tc');
    db.tenantJoin(tenantClientQuery, 'clients as c', 'tc.client_id', 'c.client_id');
    db.tenantJoin(tenantClientQuery, 'client_locations as cl', 'c.client_id', 'cl.client_id', {
      type: 'left',
      on(join) {
        join.andOn(function () {
          this.on('cl.is_billing_address', '=', knexOrTrx.raw('true'))
            .orOn('cl.is_default', '=', knexOrTrx.raw('true'));
        });
      },
    });

    const [invoiceChargesRaw, client, contact, logoUrl, tenantClientDetails, recurringInvoiceSummaryRows] = await Promise.all([
      Invoice.getInvoiceCharges(knexOrTrx, tenant, invoiceId),
      clientQuery
        .select(
          'c.client_name',
          'c.properties',
          knexOrTrx.raw(`CONCAT_WS(', ',
            cl.address_line1,
            cl.address_line2,
            cl.city,
            cl.state_province,
            cl.postal_code,
            cl.country_name
          ) as location_address`)
        )
        .where({
          'c.client_id': invoice.client_id
        })
        .orderByRaw('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST')
        .first() as unknown as Promise<InvoiceClientDetailsRow | undefined>,
      tenantScopedTable(knexOrTrx, tenant, 'contacts')
        .select('full_name')
        .where({ client_id: invoice.client_id })
        .first() as unknown as Promise<InvoiceContactRow | undefined>,
      getClientLogoUrl(invoice.client_id, tenant).catch(() => null),
      tenantClientQuery
        .select(
          'tc.client_id',
          'c.client_name',
          knexOrTrx.raw(`CONCAT_WS(', ',
            cl.address_line1,
            cl.address_line2,
            cl.city,
            cl.state_province,
            cl.postal_code,
            cl.country_name
          ) as location_address`)
        )
        .where({
          'tc.is_default': true
        })
        .whereNull('tc.deleted_at')
        .orderByRaw('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST')
        .first() as unknown as Promise<InvoiceTenantClientDetailsRow | undefined>,
      tenantScopedTable<RecurringInvoiceSummaryRow>(knexOrTrx, tenant, 'recurring_service_periods')
        .select(
          'service_period_start',
          'service_period_end',
          'invoice_window_start',
          'invoice_window_end',
          'cadence_owner'
        )
        .where('invoice_id', invoiceId) as unknown as Promise<RecurringInvoiceSummaryRow[]>,
    ]);

    if (!client) {
      throw new Error(`Customer client details not found for invoice ${invoiceId}`);
    }

    let clientProperties: { logo?: string } = {};
    if (typeof client.properties === 'string') {
      try {
        clientProperties = JSON.parse(client.properties) as { logo?: string };
      } catch {
        clientProperties = {};
      }
    } else if (client.properties && typeof client.properties === 'object') {
      clientProperties = client.properties as { logo?: string };
    }

    const resolveTenantNameFallback = async (): Promise<InvoiceViewModel['tenantClient']> => {
      const tenantRecord = await tenantScopedTable(knexOrTrx, tenant, 'tenants')
        .select('client_name')
        .first();
      const fallbackName = asTrimmedString(tenantRecord?.client_name);
      if (fallbackName.length === 0) {
        return null;
      }
      return {
        name: fallbackName,
        address: null,
        logoUrl: null,
      };
    };

    let tenantClient: InvoiceViewModel['tenantClient'] = null;
    if (tenantClientDetails?.client_id) {
      const tenantLogoUrl = await getClientLogoUrl(tenantClientDetails.client_id, tenant).catch(() => null);
      const tenantClientName = asTrimmedString(tenantClientDetails.client_name);
      const tenantClientAddress = asTrimmedString(tenantClientDetails.location_address);

      if (tenantClientName.length > 0 || tenantClientAddress.length > 0 || tenantLogoUrl) {
        tenantClient = {
          name: tenantClientName.length > 0 ? tenantClientName : null,
          address: tenantClientAddress.length > 0 ? tenantClientAddress : null,
          logoUrl: tenantLogoUrl || null,
        };
      }
    }
    if (!tenantClient) {
      tenantClient = await resolveTenantNameFallback();
    }

    const recurringSummaryRows = Array.isArray(recurringInvoiceSummaryRows) ? recurringInvoiceSummaryRows : [];
    const recurringServicePeriodStarts = recurringSummaryRows
      .map((row) => normalizeDateLikeString(row.service_period_start))
      .filter((value) => value.length > 0)
      .sort();
    const recurringServicePeriodEnds = recurringSummaryRows
      .map((row) => normalizeDateLikeString(row.service_period_end))
      .filter((value) => value.length > 0)
      .sort();
    const recurringInvoiceWindowStarts = recurringSummaryRows
      .map((row) => normalizeDateLikeString(row.invoice_window_start))
      .filter((value) => value.length > 0)
      .sort();
    const recurringInvoiceWindowEnds = recurringSummaryRows
      .map((row) => normalizeDateLikeString(row.invoice_window_end))
      .filter((value) => value.length > 0)
      .sort();
    const cadenceOwners = Array.from(
      new Set(
        recurringSummaryRows
          .map((row) => asTrimmedString(row.cadence_owner))
          .filter((value) => value === 'contract' || value === 'client')
      )
    );
    const recurringCadenceOwner = cadenceOwners.length === 1 ? cadenceOwners[0] : null;

    const invoiceCharges: IInvoiceCharge[] = invoiceChargesRaw.map((item) => ({
      ...item,
      quantity: parseDecimal(item.quantity),
      unit_price: parseMinorUnit(item.unit_price),
      total_price: parseMinorUnit(item.total_price),
      tax_amount: parseMinorUnit(item.tax_amount),
      net_amount: parseMinorUnit(item.net_amount),
      tenant,
      is_manual: Boolean(item.is_manual),
      rate: parseMinorUnit(item.unit_price),
    }));

    const subtotal = parseMinorUnit(invoice.subtotal);
    const tax = parseMinorUnit(invoice.tax);
    const totalAmount = parseMinorUnit(invoice.total_amount);
    const creditApplied = parseMinorUnit(invoice.credit_applied);

    return {
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      client_id: invoice.client_id,
      po_number: invoice.po_number ?? null,
      client_contract_id: invoice.client_contract_id ?? null,
      client: {
        name: client.client_name || '',
        logo: logoUrl || clientProperties.logo || '',
        address: client.location_address || ''
      },
      contact: {
        name: contact?.full_name || '',
        address: ''
      },
      tenantClient,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      status: invoice.status,
      currencyCode: invoice.currency_code || 'USD',
      subtotal,
      tax,
      total: totalAmount,
      total_amount: totalAmount,
      invoice_charges: invoiceCharges,
      finalized_at: invoice.finalized_at,
      credit_applied: creditApplied,
      billing_cycle_id: invoice.billing_cycle_id,
      is_manual: Boolean(invoice.is_manual),
      tax_source: invoice.tax_source || 'internal',
      recurring_service_period_start: recurringServicePeriodStarts[0] || null,
      recurring_service_period_end: recurringServicePeriodEnds[recurringServicePeriodEnds.length - 1] || null,
      recurring_invoice_window_start: recurringInvoiceWindowStarts[0] || null,
      recurring_invoice_window_end: recurringInvoiceWindowEnds[recurringInvoiceWindowEnds.length - 1] || null,
      recurring_execution_window_kind:
        recurringCadenceOwner === 'contract'
          ? 'contract_cadence_window'
          : recurringCadenceOwner === 'client'
            ? 'client_cadence_window'
            : null,
      recurring_cadence_source:
        recurringCadenceOwner === 'contract'
          ? 'contract_anniversary'
          : recurringCadenceOwner === 'client'
            ? 'client_schedule'
            : null,
    };
  },

  /**
   * Add an invoice charge/item.
   */
  addInvoiceCharge: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceItem: Omit<IInvoiceCharge, 'item_id' | 'tenant'>
  ): Promise<IInvoiceCharge> => {
    if (!tenant) {
      throw new Error('Tenant context is required for adding invoice charge');
    }

    if (!Number.isInteger(invoiceItem.total_price)) {
      throw new Error('Total price must be an integer');
    }

    if (!Number.isInteger(invoiceItem.unit_price)) {
      throw new Error('Unit price must be an integer');
    }

    if (!Number.isInteger(invoiceItem.tax_amount)) {
      throw new Error('Tax amount must be an integer');
    }

    if (!Number.isInteger(invoiceItem.net_amount)) {
      throw new Error('Net amount must be an integer');
    }

    // Make service_id optional
    const itemToInsert: Record<string, unknown> = { ...invoiceItem, tenant };
    if (!itemToInsert.service_id) {
      delete itemToInsert.service_id;
    }
    delete itemToInsert.contract_name;

    const [createdItem] = await tenantScopedTable<IInvoiceCharge>(knexOrTrx, tenant, 'invoice_charges')
      .insert(itemToInsert)
      .returning('*');

    return createdItem;
  },

  /**
   * Get all invoice charges for an invoice.
   */
  getInvoiceCharges: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId: string
  ): Promise<IInvoiceCharge[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting invoice items');
    }

    try {
      const db = tenantDb(knexOrTrx, tenant);
      const query = db.table<InvoiceChargeDisplayRow>('invoice_charges as ic');
      db.tenantJoin(query, 'service_catalog as sc', 'ic.service_id', 'sc.service_id', { type: 'left' });
      query
        .select(
          'ic.item_id',
          'ic.invoice_id',
          'ic.service_id',
          'sc.item_kind as service_item_kind',
          'sc.sku as service_sku',
          'sc.service_name as service_name',
          'ic.description as name',
          'ic.description',
          'ic.is_discount',
          knexOrTrx.raw('CAST(ic.quantity AS DOUBLE PRECISION) as quantity'),
          knexOrTrx.raw('CAST(ic.unit_price AS BIGINT) as unit_price'),
          knexOrTrx.raw('CAST(ic.total_price AS BIGINT) as total_price'),
          knexOrTrx.raw('CAST(ic.tax_amount AS BIGINT) as tax_amount'),
          knexOrTrx.raw('CAST(ic.net_amount AS BIGINT) as net_amount'),
          'ic.is_manual',
          'ic.location_id'
        )
        .where('ic.invoice_id', invoiceId);

      const items = (await query) as InvoiceChargeDisplayRow[];
      if (items.length === 0) {
        return items;
      }

      const itemIds = items.map((item) => item.item_id).filter(Boolean);
      const detailRows: InvoiceChargeDetailPeriodRow[] = itemIds.length === 0
        ? []
        : await tenantScopedTable<InvoiceChargeDetailPeriodRow>(knexOrTrx, tenant, 'invoice_charge_details')
            .select('item_id', 'service_period_start', 'service_period_end', 'billing_timing')
            .whereIn('item_id', itemIds)
            .orderBy('service_period_start', 'asc');

      return sortInvoiceChargesForDisplay(attachCanonicalRecurringDetailPeriods(items, detailRows));
    } catch (error) {
      console.error(`Error getting invoice items for invoice ${invoiceId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get invoice items: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Update an invoice charge.
   */
  updateInvoiceCharge: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    itemId: string,
    updateData: Partial<IInvoiceCharge>
  ): Promise<IInvoiceCharge> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating invoice item');
    }

    try {
      const [updatedItem] = await tenantScopedTable<IInvoiceCharge>(knexOrTrx, tenant, 'invoice_charges')
        .where({
          item_id: itemId
        })
        .update(updateData)
        .returning('*');

      if (!updatedItem) {
        throw new Error(`Invoice item ${itemId} not found in tenant ${tenant}`);
      }

      await publishEvent({
        eventType: 'INVOICE_ITEM_UPDATED',
        payload: {
          tenantId: tenant,
          invoiceId: updatedItem.invoice_id,
          itemId: updatedItem.item_id,
          changes: updateData as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        },
      });

      return updatedItem;
    } catch (error) {
      console.error(`Error updating invoice item ${itemId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to update invoice item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Delete an invoice charge.
   */
  deleteInvoiceItem: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    itemId: string
  ): Promise<boolean> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting invoice item');
    }

    try {
      const deleted = await tenantScopedTable(knexOrTrx, tenant, 'invoice_charges')
        .where({
          item_id: itemId
        })
        .del();

      if (deleted === 0) {
        throw new Error(`Invoice item ${itemId} not found in tenant ${tenant}`);
      }

      return true;
    } catch (error) {
      console.error(`Error deleting invoice item ${itemId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to delete invoice item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Get all invoice templates for a tenant.
   */
  getTemplates: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IInvoiceTemplate[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting templates');
    }

    return tenantScopedTable<IInvoiceTemplate>(knexOrTrx, tenant, 'invoice_templates').select('*');
  },

  /**
   * Get standard invoice templates. This is intentionally tenant-less as these are system-wide templates
   * that are available to all tenants.
   */
  getStandardTemplates: async (
    knexOrTrx: Knex | Knex.Transaction
  ): Promise<IInvoiceTemplate[]> => {
    const records = await tenantDb(knexOrTrx, GLOBAL_TEMPLATE_LOOKUP)
      .unscoped('standard_invoice_templates', 'global standard invoice template catalog')
      .select(
        'template_id',
        'name',
        'version',
        'standard_invoice_template_code',
        'templateAst',
        'is_default',
        'created_at',
        'updated_at'
      )
      .orderBy('name');

    const missingAst = records.filter((record) => !record.templateAst);
    if (missingAst.length > 0) {
      const missingCodes = missingAst
        .map((record) => record.standard_invoice_template_code || record.template_id)
        .join(', ');
      throw new Error(`Standard invoice template rows missing templateAst: ${missingCodes}`);
    }

    return records as IInvoiceTemplate[];
  },

  /**
   * Get all templates (both tenant-specific and standard).
   */
  getAllTemplates: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IInvoiceTemplate[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting all templates');
    }

    const [tenantTemplates, standardTemplates, tenantAssignment] = await Promise.all([
      tenantScopedTable<IInvoiceTemplate>(knexOrTrx, tenant, 'invoice_templates')
        .select(
          'template_id',
          'name',
          'version',
          'is_default',
          'templateAst',
          'created_at',
          'updated_at'
        ),
      Invoice.getStandardTemplates(knexOrTrx),
      tenantScopedTable(knexOrTrx, tenant, 'invoice_template_assignments')
        .select('template_source', 'standard_invoice_template_code', 'invoice_template_id')
        .where({ scope_type: 'tenant' })
        .whereNull('scope_id')
        .first()
    ]);

    return [
      ...standardTemplates.map((t): IInvoiceTemplate => {
        const isTenantDefault =
          tenantAssignment?.template_source === 'standard' &&
          tenantAssignment.standard_invoice_template_code === t.standard_invoice_template_code;

        return {
          ...t,
          isStandard: true,
          templateSource: 'standard',
          standard_invoice_template_code: t.standard_invoice_template_code,
          isTenantDefault,
          is_default: isTenantDefault,
          selectValue: t.standard_invoice_template_code
            ? `standard:${t.standard_invoice_template_code}`
            : `standard:${t.template_id}`
        };
      }),
      ...tenantTemplates.map((t): IInvoiceTemplate => {
        const isTenantDefault =
          tenantAssignment?.template_source === 'custom' &&
          tenantAssignment.invoice_template_id === t.template_id;

        return {
          ...t,
          isStandard: false,
          templateSource: 'custom',
          isTenantDefault,
          is_default: isTenantDefault,
          selectValue: `custom:${t.template_id}`
        };
      })
    ];
  },

  /**
   * Save an invoice template.
   */
  saveTemplate: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    template: Omit<IInvoiceTemplate, 'tenant'>
  ): Promise<IInvoiceTemplate> => {
    if (!tenant) {
      throw new Error('Tenant context is required for saving template');
    }

    const templateWithDefaults = {
      ...template,
      version: template.version || 1,
      tenant,
    };

    // Avoid passing UI-only / computed fields (or any unknown keys) straight into a DB insert.
    const insertRecord: Record<string, unknown> = {
      tenant,
      template_id: (templateWithDefaults as any).template_id,
      name: (templateWithDefaults as any).name,
      version: (templateWithDefaults as any).version,
      is_default: (templateWithDefaults as any).is_default ?? false,
    };

    if ((templateWithDefaults as any).templateAst !== undefined) {
      insertRecord.templateAst = (templateWithDefaults as any).templateAst;
    }

    const updateRecord: Record<string, unknown> = {
      name: insertRecord.name,
      version: insertRecord.version,
      is_default: insertRecord.is_default,
    };
    if (Object.prototype.hasOwnProperty.call(insertRecord, 'templateAst')) {
      updateRecord.templateAst = insertRecord.templateAst;
    }

    const [savedTemplate] = await tenantScopedTable<IInvoiceTemplate>(knexOrTrx, tenant, 'invoice_templates')
      .insert(insertRecord)
      .onConflict(['tenant', 'template_id'])
      .merge(updateRecord)
      .returning('*');

    return savedTemplate;
  },

  /**
   * Get custom fields for a tenant.
   */
  getCustomFields: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<ICustomField[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting custom fields');
    }

    return tenantScopedTable<CustomFieldRow>(knexOrTrx, tenant, 'custom_fields')
      .select('*');
  },

  /**
   * Save a custom field.
   */
  saveCustomField: async (
    knexOrTrx: Knex | Knex.Transaction,
    field: ICustomField
  ): Promise<ICustomField> => {
    const tenant = (field as CustomFieldRow).tenant;
    if (!tenant) {
      throw new Error('Tenant context is required for saving custom field');
    }

    const [savedField] = await tenantScopedTable<CustomFieldRow>(knexOrTrx, tenant, 'custom_fields')
      .insert(field as CustomFieldRow)
      .onConflict(['tenant', 'field_id'])
      .merge()
      .returning('*');
    return savedField;
  },

  /**
   * Get conditional rules for a template.
   */
  getConditionalRules: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    templateId: string
  ): Promise<IConditionalRule[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting conditional rules');
    }

    return tenantScopedTable<ConditionalRuleRow>(knexOrTrx, tenant, 'conditional_display_rules')
      .where({ template_id: templateId });
  },

  /**
   * Save a conditional rule.
   */
  saveConditionalRule: async (
    knexOrTrx: Knex | Knex.Transaction,
    rule: IConditionalRule
  ): Promise<IConditionalRule> => {
    const tenant = (rule as ConditionalRuleRow).tenant;
    if (!tenant) {
      throw new Error('Tenant context is required for saving conditional rule');
    }

    const [savedRule] = await tenantScopedTable<ConditionalRuleRow>(knexOrTrx, tenant, 'conditional_display_rules')
      .insert(rule as ConditionalRuleRow)
      .onConflict(['tenant', 'rule_id'])
      .merge()
      .returning('*');
    return savedRule;
  },

  /**
   * Add an annotation to an invoice.
   */
  addAnnotation: async (
    knexOrTrx: Knex | Knex.Transaction,
    annotation: Omit<InvoiceAnnotationRow, 'annotation_id'>
  ): Promise<IInvoiceAnnotation> => {
    const [savedAnnotation] = await tenantScopedTable<InvoiceAnnotationRow>(knexOrTrx, annotation.tenant, 'invoice_annotations')
      .insert(annotation)
      .returning('*');

    if (savedAnnotation?.tenant && savedAnnotation?.invoice_id && savedAnnotation?.annotation_id) {
      await publishEvent({
        eventType: 'INVOICE_ANNOTATION_CREATED',
        payload: {
          tenantId: savedAnnotation.tenant,
          invoiceId: savedAnnotation.invoice_id,
          annotationId: savedAnnotation.annotation_id,
          userId: savedAnnotation.user_id ?? undefined,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return savedAnnotation;
  },

  /**
   * Update an invoice annotation.
   */
  updateAnnotation: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    annotationId: string,
    updateData: Partial<Pick<IInvoiceAnnotation, 'content' | 'is_internal'>>
  ): Promise<IInvoiceAnnotation> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating invoice annotation');
    }

    const [updatedAnnotation] = await tenantScopedTable<InvoiceAnnotationRow>(knexOrTrx, tenant, 'invoice_annotations')
      .where({
        annotation_id: annotationId,
      })
      .update(updateData)
      .returning('*');

    if (!updatedAnnotation) {
      throw new Error(`Invoice annotation ${annotationId} not found in tenant ${tenant}`);
    }

    await publishEvent({
      eventType: 'INVOICE_ANNOTATION_UPDATED',
      payload: {
        tenantId: tenant,
        invoiceId: updatedAnnotation.invoice_id,
        annotationId: updatedAnnotation.annotation_id,
        userId: updatedAnnotation.user_id ?? undefined,
        changes: updateData as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      },
    });

    return updatedAnnotation;
  },

  /**
   * Get annotations for an invoice.
   */
  getAnnotations: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId: string
  ): Promise<IInvoiceAnnotation[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting invoice annotations');
    }

    return tenantScopedTable<InvoiceAnnotationRow>(knexOrTrx, tenant, 'invoice_annotations')
      .where({ invoice_id: invoiceId });
  },

  /**
   * Generate an invoice (finalize and mark as sent).
   */
  generateInvoice: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId: string
  ): Promise<IInvoice> => {
    if (!tenant) {
      throw new Error('Tenant context is required for generating invoice');
    }

    try {
      const [updatedInvoice] = await tenantScopedTable<IInvoice>(knexOrTrx, tenant, 'invoices')
        .where({
          invoice_id: invoiceId
        })
        .update({
          status: 'sent',
          finalized_at: knexOrTrx.fn.now()
        })
        .returning('*');

      if (!updatedInvoice) {
        throw new Error(`Invoice ${invoiceId} not found in tenant ${tenant}`);
      }

      return updatedInvoice;
    } catch (error) {
      console.error(`Error generating invoice ${invoiceId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to generate invoice: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * @deprecated Use addInvoiceCharge
   */
  addInvoiceItem: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceItem: Omit<IInvoiceCharge, 'item_id' | 'tenant'>
  ): Promise<IInvoiceCharge> => {
    return Invoice.addInvoiceCharge(knexOrTrx, tenant, invoiceItem);
  },

  /**
   * @deprecated Use getInvoiceCharges
   */
  getInvoiceItems: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    invoiceId: string
  ): Promise<IInvoiceCharge[]> => {
    return Invoice.getInvoiceCharges(knexOrTrx, tenant, invoiceId);
  },

  /**
   * @deprecated Use updateInvoiceCharge
   */
  updateInvoiceItem: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    itemId: string,
    updateData: Partial<IInvoiceCharge>
  ): Promise<IInvoiceCharge> => {
    return Invoice.updateInvoiceCharge(knexOrTrx, tenant, itemId, updateData);
  },
};

export default Invoice;
