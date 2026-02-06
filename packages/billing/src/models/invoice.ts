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
import type {
  IInvoice,
  IInvoiceCharge,
  IInvoiceTemplate,
  ICustomField,
  IConditionalRule,
  IInvoiceAnnotation,
  InvoiceViewModel,
} from '@alga-psa/types';
import { getClientLogoUrlAsync } from '../lib/documentsHelpers';

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

    const [createdInvoice] = await knexOrTrx('invoices')
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
      const invoice = await knexOrTrx('invoices')
        .where({
          invoice_id: invoiceId,
          tenant
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
      const [updatedInvoice] = await knexOrTrx('invoices')
        .where({
          invoice_id: invoiceId,
          tenant
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
        await knexOrTrx('payment_webhook_events')
          .where({ invoice_id: invoiceId, tenant })
          .update({ invoice_id: null });
      }

      const deleted = await knexOrTrx('invoices')
        .where({
          invoice_id: invoiceId,
          tenant
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
      const invoices = await knexOrTrx('invoices')
        .where({ tenant })
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

    const invoice = await knexOrTrx('invoices')
      .select(
        '*',
        knexOrTrx.raw('CAST(subtotal AS BIGINT) as subtotal'),
        knexOrTrx.raw('CAST(tax AS BIGINT) as tax'),
        knexOrTrx.raw('CAST(total_amount AS BIGINT) as total_amount'),
        knexOrTrx.raw('CAST(credit_applied AS BIGINT) as credit_applied')
      )
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .first();

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const [invoiceChargesRaw, client, contact, logoUrl] = await Promise.all([
      Invoice.getInvoiceCharges(knexOrTrx, tenant, invoiceId),
      knexOrTrx('clients as c')
        .leftJoin('client_locations as cl', function () {
          this.on('c.client_id', '=', 'cl.client_id')
            .andOn('c.tenant', '=', 'cl.tenant')
            .andOn(function () {
              this.on('cl.is_billing_address', '=', knexOrTrx.raw('true'))
                .orOn('cl.is_default', '=', knexOrTrx.raw('true'));
            });
        })
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
          'c.client_id': invoice.client_id,
          'c.tenant': tenant
        })
        .orderByRaw('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST')
        .first(),
      knexOrTrx('contacts')
        .select('full_name')
        .where({ client_id: invoice.client_id, tenant })
        .first(),
      getClientLogoUrlAsync(invoice.client_id, tenant).catch(() => null),
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

    const invoiceCharges: IInvoiceCharge[] = invoiceChargesRaw.map((item) => ({
      ...item,
      quantity: parseMinorUnit(item.quantity),
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
      tax_source: invoice.tax_source || 'internal'
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

    const [createdItem] = await knexOrTrx('invoice_charges')
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
      const query = knexOrTrx('invoice_charges as ic')
        .leftJoin('service_catalog as sc', function () {
          this.on('ic.service_id', '=', 'sc.service_id').andOn('ic.tenant', '=', 'sc.tenant');
        })
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
          knexOrTrx.raw('CAST(ic.quantity AS INTEGER) as quantity'),
          knexOrTrx.raw('CAST(ic.unit_price AS BIGINT) as unit_price'),
          knexOrTrx.raw('CAST(ic.total_price AS BIGINT) as total_price'),
          knexOrTrx.raw('CAST(ic.tax_amount AS BIGINT) as tax_amount'),
          knexOrTrx.raw('CAST(ic.net_amount AS BIGINT) as net_amount'),
          'ic.is_manual'
        )
        .where({
          'ic.invoice_id': invoiceId,
          'ic.tenant': tenant
        });

      const items = await query;

      return items;
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
      const [updatedItem] = await knexOrTrx('invoice_charges')
        .where({
          item_id: itemId,
          tenant
        })
        .update(updateData)
        .returning('*');

      if (!updatedItem) {
        throw new Error(`Invoice item ${itemId} not found in tenant ${tenant}`);
      }

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
      const deleted = await knexOrTrx('invoice_charges')
        .where({
          item_id: itemId,
          tenant
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

    return knexOrTrx('invoice_templates').where({ tenant }).select('*');
  },

  /**
   * Get standard invoice templates. This is intentionally tenant-less as these are system-wide templates
   * that are available to all tenants.
   */
  getStandardTemplates: async (
    knexOrTrx: Knex | Knex.Transaction
  ): Promise<IInvoiceTemplate[]> => {
    return knexOrTrx('standard_invoice_templates')
      .select(
        'template_id',
        'name',
        'version',
        'standard_invoice_template_code',
        'assemblyScriptSource',
        'sha'
      )
      .orderBy('name');
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
      knexOrTrx('invoice_templates')
        .where({ tenant })
        .select(
          'template_id',
          'name',
          'version',
          'is_default',
          'assemblyScriptSource',
          'created_at',
          'updated_at'
        ),
      Invoice.getStandardTemplates(knexOrTrx),
      knexOrTrx('invoice_template_assignments')
        .select('template_source', 'standard_invoice_template_code', 'invoice_template_id')
        .where({ tenant, scope_type: 'tenant' })
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
      tenant
    };

    const [savedTemplate] = await knexOrTrx('invoice_templates')
      .insert(templateWithDefaults)
      .onConflict(['tenant', 'template_id'])
      .merge(['name', 'version', 'assemblyScriptSource', 'wasmBinary', 'is_default'])
      .returning('*');

    return savedTemplate;
  },

  /**
   * Get custom fields for a tenant.
   */
  getCustomFields: async (
    knexOrTrx: Knex | Knex.Transaction,
    _tenant: string
  ): Promise<ICustomField[]> => {
    return knexOrTrx('custom_fields');
  },

  /**
   * Save a custom field.
   */
  saveCustomField: async (
    knexOrTrx: Knex | Knex.Transaction,
    field: ICustomField
  ): Promise<ICustomField> => {
    const [savedField] = await knexOrTrx('custom_fields')
      .insert(field)
      .onConflict('field_id')
      .merge()
      .returning('*');
    return savedField;
  },

  /**
   * Get conditional rules for a template.
   */
  getConditionalRules: async (
    knexOrTrx: Knex | Knex.Transaction,
    templateId: string
  ): Promise<IConditionalRule[]> => {
    return knexOrTrx('conditional_display_rules').where({ template_id: templateId });
  },

  /**
   * Save a conditional rule.
   */
  saveConditionalRule: async (
    knexOrTrx: Knex | Knex.Transaction,
    rule: IConditionalRule
  ): Promise<IConditionalRule> => {
    const [savedRule] = await knexOrTrx('conditional_display_rules')
      .insert(rule)
      .onConflict('rule_id')
      .merge()
      .returning('*');
    return savedRule;
  },

  /**
   * Add an annotation to an invoice.
   */
  addAnnotation: async (
    knexOrTrx: Knex | Knex.Transaction,
    annotation: Omit<IInvoiceAnnotation, 'annotation_id'>
  ): Promise<IInvoiceAnnotation> => {
    const [savedAnnotation] = await knexOrTrx('invoice_annotations')
      .insert(annotation)
      .returning('*');
    return savedAnnotation;
  },

  /**
   * Get annotations for an invoice.
   */
  getAnnotations: async (
    knexOrTrx: Knex | Knex.Transaction,
    invoiceId: string
  ): Promise<IInvoiceAnnotation[]> => {
    return knexOrTrx('invoice_annotations').where({ invoice_id: invoiceId });
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
      const [updatedInvoice] = await knexOrTrx('invoices')
        .where({
          invoice_id: invoiceId,
          tenant
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
