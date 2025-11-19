// server/src/lib/models/invoice.ts
import { Knex } from 'knex';
import { getCurrentTenantId } from '../db';
// Restore InvoiceViewModel import from interfaces
import { IInvoice, IInvoiceCharge, IInvoiceTemplate, LayoutSection, ICustomField, IConditionalRule, IInvoiceAnnotation, InvoiceViewModel } from '../../interfaces/invoice.interfaces';
// Remove direct import from renderer types
import { Temporal } from '@js-temporal/polyfill';
import { getClientLogoUrl } from '../utils/avatarUtils';

export default class Invoice {
  static async create(knexOrTrx: Knex | Knex.Transaction, invoice: Omit<IInvoice, 'invoice_id' | 'tenant'>): Promise<IInvoice> {
    const tenant = await getCurrentTenantId();

    if (!Number.isInteger(invoice.total_amount)) {
      throw new Error('Total amount must be an integer');
    }

    const [createdInvoice] = await knexOrTrx('invoices').insert({...invoice, tenant}).returning('*');
    return createdInvoice;
  }

  static async getById(knexOrTrx: Knex | Knex.Transaction, invoiceId: string): Promise<IInvoice | null> {
    const tenant = await getCurrentTenantId();
    
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
        invoice.invoice_charges = await this.getInvoiceCharges(knexOrTrx, invoiceId);
        invoice.invoice_items = invoice.invoice_charges;
        invoice.due_date = Temporal.PlainDate.from(invoice.due_date);
        if (invoice.finalized_at) {
          invoice.finalized_at = Temporal.PlainDate.from(invoice.finalized_at);
        }
      }

      return invoice || null;
    } catch (error) {
      console.error(`Error getting invoice ${invoiceId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get invoice: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async update(knexOrTrx: Knex | Knex.Transaction, invoiceId: string, updateData: Partial<IInvoice>): Promise<IInvoice> {
    const tenant = await getCurrentTenantId();
    
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
  }

  static async delete(knexOrTrx: Knex | Knex.Transaction, invoiceId: string): Promise<boolean> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deleting invoice');
    }

    try {
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
  }

  static async addInvoiceCharge(knexOrTrx: Knex | Knex.Transaction, invoiceItem: Omit<IInvoiceCharge, 'item_id' | 'tenant'>): Promise<IInvoiceCharge> {
    const tenant = await getCurrentTenantId();

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
    const itemToInsert = { ...invoiceItem, tenant };
    if (!itemToInsert.service_id) {
      delete itemToInsert.service_id;
    }

    const [createdItem] = await knexOrTrx('invoice_charges').insert(itemToInsert).returning('*');
    return createdItem;
  }

  static async getInvoiceCharges(knexOrTrx: Knex | Knex.Transaction, invoiceId: string): Promise<IInvoiceCharge[]> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting invoice items');
    }

    try {
      console.log(`Getting invoice items for invoice ${invoiceId} in tenant ${tenant}`);
      
      const query = knexOrTrx('invoice_charges')
        .select(
          'item_id',
          'invoice_id',
          'service_id',
          'description as name',
          'description',
          'is_discount',
          knexOrTrx.raw('CAST(quantity AS INTEGER) as quantity'),
          knexOrTrx.raw('CAST(unit_price AS BIGINT) as unit_price'),
          knexOrTrx.raw('CAST(total_price AS BIGINT) as total_price'),
          knexOrTrx.raw('CAST(tax_amount AS BIGINT) as tax_amount'),
          knexOrTrx.raw('CAST(net_amount AS BIGINT) as net_amount'),
          'is_manual')
        .where({
          invoice_id: invoiceId,
          tenant
        });

      const items = await query;
      
      console.log(`Found ${items.length} invoice items for invoice ${invoiceId} in tenant ${tenant}:`, {
        total: items.length,
        manual: items.filter(item => item.is_manual).length,
        automated: items.filter(item => !item.is_manual).length
      });

      return items;
    } catch (error) {
      console.error(`Error getting invoice items for invoice ${invoiceId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get invoice items: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async updateInvoiceCharge(knexOrTrx: Knex | Knex.Transaction, itemId: string, updateData: Partial<IInvoiceCharge>): Promise<IInvoiceCharge> {
    const tenant = await getCurrentTenantId();
    
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
  }

  /** @deprecated Use addInvoiceCharge */
  static async addInvoiceItem(knexOrTrx: Knex | Knex.Transaction, invoiceItem: Omit<IInvoiceCharge, 'item_id' | 'tenant'>): Promise<IInvoiceCharge> {
    return this.addInvoiceCharge(knexOrTrx, invoiceItem);
  }

  /** @deprecated Use getInvoiceCharges */
  static async getInvoiceItems(knexOrTrx: Knex | Knex.Transaction, invoiceId: string): Promise<IInvoiceCharge[]> {
    return this.getInvoiceCharges(knexOrTrx, invoiceId);
  }

  /** @deprecated Use updateInvoiceCharge */
  static async updateInvoiceItem(knexOrTrx: Knex | Knex.Transaction, itemId: string, updateData: Partial<IInvoiceCharge>): Promise<IInvoiceCharge> {
    return this.updateInvoiceCharge(knexOrTrx, itemId, updateData);
  }

  static async deleteInvoiceItem(knexOrTrx: Knex | Knex.Transaction, itemId: string): Promise<boolean> {
    const tenant = await getCurrentTenantId();
    
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
  }

  static async getTemplates(knexOrTrx: Knex | Knex.Transaction): Promise<IInvoiceTemplate[]> {
    const tenant = await getCurrentTenantId();
    return knexOrTrx('invoice_templates').where({ tenant }).select('*');
  }

  /**
   * Get standard invoice templates. This is intentionally tenant-less as these are system-wide templates
   * that are available to all tenants. This is a valid exception to the tenant filtering requirement.
   */
  static async getStandardTemplates(knexOrTrx: Knex | Knex.Transaction): Promise<IInvoiceTemplate[]> {
    // Select necessary fields including AS/Wasm related ones
    return knexOrTrx('standard_invoice_templates')
      .select(
        'template_id',
        'name',
        'version',
        'standard_invoice_template_code',
        'assemblyScriptSource', // Add assemblyScriptSource
        'sha' // Add sha
        // wasmBinary is intentionally excluded from the list view/clone source
      )
      .orderBy('name');
  }

  static async getAllTemplates(knexOrTrx: Knex | Knex.Transaction): Promise<IInvoiceTemplate[]> {
    const tenant = await getCurrentTenantId();
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
      this.getStandardTemplates(knexOrTrx),
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
  }

  private static async getTemplateSection(knexOrTrx: Knex | Knex.Transaction, templateId: string, sectionType: string): Promise<LayoutSection> {
    const section = await knexOrTrx('template_sections')
      .where({ template_id: templateId, section_type: sectionType })
      .first();
    if (section) {
      section.layout = await knexOrTrx('layout_blocks')
        .where({ section_id: section.section_id });
    }
    return section;
  }

  private static async getTemplateSections(knexOrTrx: Knex | Knex.Transaction, templateId: string, sectionType: string): Promise<LayoutSection[]> {
    const sections = await knexOrTrx('template_sections')
      .where({ template_id: templateId, section_type: sectionType });
    for (const section of sections) {
      section.layout = await knexOrTrx('layout_blocks')
        .where({ section_id: section.section_id });
    }
    return sections;
  }

  static async saveTemplate(knexOrTrx: Knex | Knex.Transaction, template: Omit<IInvoiceTemplate, 'tenant'>): Promise<IInvoiceTemplate> {
    const tenant = await getCurrentTenantId();
    
    // Ensure version is provided (default to 1 if not specified)
    const templateWithDefaults = {
      ...template,
      version: template.version || 1,
      tenant: tenant
    };
    
    // Log the template data to debug what's being inserted
    console.log('Template data being inserted in saveTemplate:', templateWithDefaults);
    
    // Explicitly specify all required fields to ensure they're included in the SQL query
    const [savedTemplate] = await knexOrTrx('invoice_templates')
      .insert(templateWithDefaults)
      .onConflict(['tenant', 'template_id'])
      .merge(['name', 'version', 'assemblyScriptSource', 'wasmBinary', 'is_default'])
      .returning('*');
    
    return savedTemplate;
  }

  static async getCustomFields(knexOrTrx: Knex | Knex.Transaction, _tenantId: string): Promise<ICustomField[]> {
    return knexOrTrx('custom_fields');
  }

  static async saveCustomField(knexOrTrx: Knex | Knex.Transaction, field: ICustomField): Promise<ICustomField> {
    const [savedField] = await knexOrTrx('custom_fields')
      .insert(field)
      .onConflict('field_id')
      .merge()
      .returning('*');
    return savedField;
  }

  static async getConditionalRules(knexOrTrx: Knex | Knex.Transaction, templateId: string): Promise<IConditionalRule[]> {
    return knexOrTrx('conditional_display_rules').where({ template_id: templateId });
  }

  static async saveConditionalRule(knexOrTrx: Knex | Knex.Transaction, rule: IConditionalRule): Promise<IConditionalRule> {
    const [savedRule] = await knexOrTrx('conditional_display_rules')
      .insert(rule)
      .onConflict('rule_id')
      .merge()
      .returning('*');
    return savedRule;
  }

  static async addAnnotation(knexOrTrx: Knex | Knex.Transaction, annotation: Omit<IInvoiceAnnotation, 'annotation_id'>): Promise<IInvoiceAnnotation> {
    const [savedAnnotation] = await knexOrTrx('invoice_annotations')
      .insert(annotation)
      .returning('*');
    return savedAnnotation;
  }

  static async getAnnotations(knexOrTrx: Knex | Knex.Transaction, invoiceId: string): Promise<IInvoiceAnnotation[]> {
    return knexOrTrx('invoice_annotations').where({ invoice_id: invoiceId });
  }

  static async getAll(knexOrTrx: Knex | Knex.Transaction): Promise<IInvoice[]> {
    const tenant = await getCurrentTenantId();
    
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
  }

  // Revert return type to InvoiceViewModel from interfaces
  static async getFullInvoiceById(knexOrTrx: Knex | Knex.Transaction, invoiceId: string): Promise<InvoiceViewModel> {
    console.log('Getting full invoice details for:', invoiceId);
    const tenant = await getCurrentTenantId();

    console.log('invoice details for invoiceId:', invoiceId, 'tenant:', tenant);

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
        tenant: tenant
      })
      .first();
    console.log('Found invoice:', {
      id: invoice?.invoice_id,
      number: invoice?.invoice_number,
      isManual: invoice?.is_manual,
      status: invoice?.status,
      total: invoice?.total_amount,
      rawSubtotal: invoice?.subtotal,
      rawTax: invoice?.tax,
      rawTotal: invoice?.total_amount,
      rawCreditApplied: invoice?.credit_applied,
      subtotalType: typeof invoice?.subtotal,
      taxType: typeof invoice?.tax,
      totalType: typeof invoice?.total_amount,
      creditType: typeof invoice?.credit_applied
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // --- Fetch Tenant's Default Client ---
    let tenantClientInfo: { name: any; address: any; logoUrl: string | null } | null = null;
    const tenantClientLink = await knexOrTrx('tenant_companies')
      .where({ tenant: tenant, is_default: true })
      .select('client_id')
      .first();

    if (tenantClientLink) {
      // Step 2: Modify query - remove 'logo_url' and fix address field
      // First try to get billing address, then fall back to default address
      const tenantClientDetails = await knexOrTrx('clients as c')
        .leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn(function() {
                this.on('cl.is_billing_address', '=', knexOrTrx.raw('true'))
                    .orOn('cl.is_default', '=', knexOrTrx.raw('true'));
              });
        })
        .where({ 'c.client_id': tenantClientLink.client_id })
        .select(
          'c.client_name',
          'cl.is_billing_address',
          'cl.is_default',
          knexOrTrx.raw(`CONCAT_WS(', ', 
            cl.address_line1, 
            cl.address_line2, 
            cl.city, 
            cl.state_province, 
            cl.postal_code, 
            cl.country_name
          ) as address`)
        )
        .orderByRaw('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST')
        .first();

      // Step 3: Fetch Logo URL using the utility function
      let logoUrl: string | null = null; // Initialize logoUrl
      if (tenantClientDetails) {
         logoUrl = await getClientLogoUrl(tenantClientLink.client_id, invoice.tenant); // Use invoice.tenant

        // Step 4: Update ViewModel Population
        tenantClientInfo = {
          name: tenantClientDetails.client_name,
          address: tenantClientDetails.address || '',
          logoUrl: logoUrl, // Use the fetched logoUrl
        };
        console.log('Found tenant default client:', tenantClientInfo);
      } else {
        console.warn(`Tenant default client details not found for client_id: ${tenantClientLink.client_id}`);
      }
    } else {
      console.warn(`No default client found for tenant: ${tenant}`);
    }
    // --- End Fetch Tenant's Default Client ---
  
    const invoice_charges = await this.getInvoiceCharges(knexOrTrx, invoiceId);
    console.log('Processing invoice items for view model:', {
      total: invoice_charges.length,
      manual: invoice_charges.filter(item => item.is_manual).length,
      automated: invoice_charges.filter(item => !item.is_manual).length,
      items: invoice_charges.map(item => ({
        id: item.item_id,
        isManual: item.is_manual,
        serviceId: item.service_id,
        description: item.description,
        unitPrice: item.unit_price
      }))
    });
    const client = await knexOrTrx('clients as c')
      .leftJoin('client_locations as cl', function() {
        this.on('c.client_id', '=', 'cl.client_id')
            .andOn('c.tenant', '=', 'cl.tenant')
            .andOn(function() {
              this.on('cl.is_billing_address', '=', knexOrTrx.raw('true'))
                  .orOn('cl.is_default', '=', knexOrTrx.raw('true'));
            });
      })
      .select(
        'c.*',
        knexOrTrx.raw(`CONCAT_WS(', ', 
          cl.address_line1, 
          cl.address_line2, 
          cl.city, 
          cl.state_province, 
          cl.postal_code, 
          cl.country_name
        ) as location_address`)
      )
      .where({ 'c.client_id': invoice.client_id })
      .orderByRaw('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST')
      .first();
// Add check for client existence
    if (!client) {
      console.error(`!!! Critical Error: Client details not found for client_id ${invoice.client_id} associated with invoice ${invoiceId} !!!`);
      throw new Error(`Customer client details not found for invoice ${invoiceId}. Cannot construct ViewModel.`);
    }
  
    // Ensure all monetary values are integers
    const subtotal = typeof invoice.subtotal === 'string' ? parseInt(invoice.subtotal, 10) : invoice.subtotal;
    const tax = typeof invoice.tax === 'string' ? parseInt(invoice.tax, 10) : invoice.tax;
    const totalAmount = typeof invoice.total_amount === 'string' ? parseInt(invoice.total_amount, 10) : invoice.total_amount;
    const creditApplied = typeof invoice.credit_applied === 'string' ? parseInt(invoice.credit_applied, 10) : (invoice.credit_applied || 0);

    console.log('Parsed monetary values:', {
      subtotal,
      tax,
      totalAmount,
      creditApplied,
      calculatedTotal: subtotal + tax,
      matches: subtotal + tax === totalAmount ? 'Yes' : 'No'
    });

    // Construct and return the original InvoiceViewModel (from interfaces)
    try {
      // Fetch contact details (assuming a primary contact exists)
      const contact = await knexOrTrx('contacts')
        .where({ client_id: invoice.client_id }) // Adjust if primary logic differs
        .first();

      const viewModel: InvoiceViewModel = {
        // Fields from the original InvoiceViewModel definition
        invoice_id: invoice.invoice_id,
        invoice_number: invoice.invoice_number,
        client_id: invoice.client_id,
        client: { // Populate client details
          name: client.client_name || '',
          address: client.location_address || '',
          // Check tenant before calling getClientLogoUrl
          logo: tenant ? (await getClientLogoUrl(invoice.client_id, tenant)) || '' : '',
        },
        contact: { // Populate contact details
          name: contact?.name || '',
          address: contact?.address || '', // Assuming contact has address
        },
        invoice_date: invoice.invoice_date, // Keep as DateValue
        due_date: invoice.due_date,         // Keep as DateValue
        status: invoice.status,
        currencyCode: invoice.currency_code || 'USD',
        subtotal: subtotal,
        tax: tax,
        total: totalAmount, // Use totalAmount which includes tax
        total_amount: totalAmount, // Keep for compatibility if needed, same as total
        invoice_charges: invoice_charges.map(item => ({ // Map to IInvoiceCharge structure
          ...item, // Spread existing item properties
          // Ensure types match IInvoiceCharge (they should already from getInvoiceCharges)
          unit_price: typeof item.unit_price === 'string' ? parseInt(item.unit_price, 10) : item.unit_price,
          total_price: typeof item.total_price === 'string' ? parseInt(item.total_price, 10) : item.total_price,
          tax_amount: typeof item.tax_amount === 'string' ? parseInt(item.tax_amount, 10) : item.tax_amount,
          net_amount: typeof item.net_amount === 'string' ? parseInt(item.net_amount, 10) : item.net_amount,
          quantity: typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : item.quantity,
          // Add any missing required fields from IInvoiceCharge with defaults if necessary
          tenant: tenant ?? undefined, // Map null tenant to undefined
          is_manual: item.is_manual || false,
          rate: typeof item.unit_price === 'string' ? parseInt(item.unit_price, 10) : item.unit_price, // Add rate if needed, using unit_price
        })),
        // custom_fields: undefined, // Add if needed
        finalized_at: invoice.finalized_at, // Keep as DateValue
        credit_applied: creditApplied,
        billing_cycle_id: invoice.billing_cycle_id,
        is_manual: invoice.is_manual,
      };

      console.log('Returning original invoice view model:', {
        number: viewModel.invoice_number,
        itemCount: viewModel.invoice_charges.length,
        total: viewModel.total,
      });

      return viewModel; // Return the original InvoiceViewModel
    } catch (error) {
      console.error("!!! Error constructing or returning InvoiceViewModel !!!", {
        invoiceId: invoiceId,
        tenant: tenant,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        invoiceData: invoice, // Log raw invoice data
        tenantClientInfo: tenantClientInfo, // Log tenant info
        itemsData: invoice_charges // Log items data
      });
      // Decide how to handle: re-throw, return null, or return specific error object
      throw new Error(`Failed to construct final InvoiceViewModel: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async generateInvoice(knexOrTrx: Knex | Knex.Transaction, invoiceId: string): Promise<IInvoice> {
    const tenant = await getCurrentTenantId();
    
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
  }
}
