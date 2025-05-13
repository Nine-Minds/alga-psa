// server/src/lib/models/invoice.ts
import { createTenantKnex } from '../db';
// Restore InvoiceViewModel import from interfaces
import { IInvoice, IInvoiceItem, IInvoiceTemplate, LayoutSection, ICustomField, IConditionalRule, IInvoiceAnnotation, InvoiceViewModel } from '../../interfaces/invoice.interfaces';
// Remove direct import from renderer types
import { Temporal } from '@js-temporal/polyfill';
import { getAdminConnection } from '../db/admin';
import { getCompanyLogoUrl } from '../utils/avatarUtils'; // Added Import

export default class Invoice {
  static async create(invoice: Omit<IInvoice, 'invoice_id' | 'tenant'>): Promise<IInvoice> {
    const { knex, tenant } = await createTenantKnex();

    if (!Number.isInteger(invoice.total_amount)) {
      throw new Error('Total amount must be an integer');
    }

    const [createdInvoice] = await knex('invoices').insert({...invoice, tenant}).returning('*');
    return createdInvoice;
  }

  static async getById(invoiceId: string): Promise<IInvoice | null> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting invoice');
    }

    try {
      const invoice = await knex('invoices')
        .where({
          invoice_id: invoiceId,
          tenant
        })
        .first();

      if (invoice) {
        invoice.invoice_items = await this.getInvoiceItems(invoiceId);
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

  static async update(invoiceId: string, updateData: Partial<IInvoice>): Promise<IInvoice> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating invoice');
    }

    try {
      const [updatedInvoice] = await knex('invoices')
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

  static async delete(invoiceId: string): Promise<boolean> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deleting invoice');
    }

    try {
      const deleted = await knex('invoices')
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

  static async addInvoiceItem(invoiceItem: Omit<IInvoiceItem, 'item_id' | 'tenant'>): Promise<IInvoiceItem> {
    const { knex, tenant } = await createTenantKnex();

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

    const [createdItem] = await knex('invoice_items').insert(itemToInsert).returning('*');
    return createdItem;
  }

  static async getInvoiceItems(invoiceId: string): Promise<IInvoiceItem[]> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting invoice items');
    }

    try {
      console.log(`Getting invoice items for invoice ${invoiceId} in tenant ${tenant}`);
      
      const query = knex('invoice_items')
        .select(
          'item_id',
          'invoice_id',
          'service_id',
          'description as name',
          'description',
          'is_discount',
          knex.raw('CAST(quantity AS INTEGER) as quantity'),
          knex.raw('CAST(unit_price AS BIGINT) as unit_price'),
          knex.raw('CAST(total_price AS BIGINT) as total_price'),
          knex.raw('CAST(tax_amount AS BIGINT) as tax_amount'),
          knex.raw('CAST(net_amount AS BIGINT) as net_amount'),
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

  static async updateInvoiceItem(itemId: string, updateData: Partial<IInvoiceItem>): Promise<IInvoiceItem> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating invoice item');
    }

    try {
      const [updatedItem] = await knex('invoice_items')
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

  static async deleteInvoiceItem(itemId: string): Promise<boolean> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deleting invoice item');
    }

    try {
      const deleted = await knex('invoice_items')
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

  static async getTemplates(): Promise<IInvoiceTemplate[]> {
    const { knex, tenant } = await createTenantKnex();
    return knex('invoice_templates').where({ tenant }).select('*');
  }

  /**
   * Get standard invoice templates. This is intentionally tenant-less as these are system-wide templates
   * that are available to all tenants. This is a valid exception to the tenant filtering requirement.
   */
  static async getStandardTemplates(): Promise<IInvoiceTemplate[]> {
    const { knex } = await createTenantKnex();
    // Select necessary fields including AS/Wasm related ones
    return knex('standard_invoice_templates')
      .select(
        'template_id',
        'name',
        'version',
        'assemblyScriptSource', // Add assemblyScriptSource
        'sha' // Add sha
        // wasmBinary is intentionally excluded from the list view/clone source
      )
      .orderBy('name');
  }

  static async getAllTemplates(): Promise<IInvoiceTemplate[]> {
    const { knex, tenant } = await createTenantKnex();
    const [tenantTemplates, standardTemplates] = await Promise.all([
      // Explicitly select necessary fields for tenant templates
      knex('invoice_templates')
        .where({ tenant })
        .select(
            'template_id',
            'name',
            'version',
            'is_default',
            'assemblyScriptSource', // Add AS source
            // 'wasmBinary', // Exclude wasmBinary from list view
            // Add any other necessary fields from IInvoiceTemplate that aren't covered by '*' implicitly
            'created_at',
            'updated_at'
            // Note: 'dsl' might not exist on tenant templates table, adjust if needed
        ),
      this.getStandardTemplates()
    ]);

    return [
      ...standardTemplates.map((t): IInvoiceTemplate => ({ ...t, isStandard: true })),
      ...tenantTemplates.map((t): IInvoiceTemplate => ({ ...t, isStandard: false }))
    ];
  }

  private static async getTemplateSection(templateId: string, sectionType: string): Promise<LayoutSection> {
    const { knex } = await createTenantKnex();
    const section = await knex('template_sections')
      .where({ template_id: templateId, section_type: sectionType })
      .first();
    if (section) {
      section.layout = await knex('layout_blocks')
        .where({ section_id: section.section_id });
    }
    return section;
  }

  private static async getTemplateSections(templateId: string, sectionType: string): Promise<LayoutSection[]> {
    const { knex } = await createTenantKnex();
    const sections = await knex('template_sections')
      .where({ template_id: templateId, section_type: sectionType });
    for (const section of sections) {
      section.layout = await knex('layout_blocks')
        .where({ section_id: section.section_id });
    }
    return sections;
  }

  static async saveTemplate(template: Omit<IInvoiceTemplate, 'tenant'>): Promise<IInvoiceTemplate> {
    const { knex, tenant } = await createTenantKnex();
    
    // Ensure version is provided (default to 1 if not specified)
    const templateWithDefaults = {
      ...template,
      version: template.version || 1,
      tenant: tenant
    };
    
    // Log the template data to debug what's being inserted
    console.log('Template data being inserted in saveTemplate:', templateWithDefaults);
    
    // Explicitly specify all required fields to ensure they're included in the SQL query
    const [savedTemplate] = await knex('invoice_templates')
      .insert(templateWithDefaults)
      .onConflict(['tenant', 'template_id'])
      .merge(['name', 'version', 'assemblyScriptSource', 'wasmBinary', 'is_default'])
      .returning('*');
    
    return savedTemplate;
  }

  static async getCustomFields(_tenantId: string): Promise<ICustomField[]> {
    const { knex } = await createTenantKnex();
    return knex('custom_fields');
  }

  static async saveCustomField(field: ICustomField): Promise<ICustomField> {
    const { knex } = await createTenantKnex();
    const [savedField] = await knex('custom_fields')
      .insert(field)
      .onConflict('field_id')
      .merge()
      .returning('*');
    return savedField;
  }

  static async getConditionalRules(templateId: string): Promise<IConditionalRule[]> {
    const { knex } = await createTenantKnex();
    return knex('conditional_display_rules').where({ template_id: templateId });
  }

  static async saveConditionalRule(rule: IConditionalRule): Promise<IConditionalRule> {
    const { knex } = await createTenantKnex();
    const [savedRule] = await knex('conditional_display_rules')
      .insert(rule)
      .onConflict('rule_id')
      .merge()
      .returning('*');
    return savedRule;
  }

  static async addAnnotation(annotation: Omit<IInvoiceAnnotation, 'annotation_id'>): Promise<IInvoiceAnnotation> {
    const { knex } = await createTenantKnex();
    const [savedAnnotation] = await knex('invoice_annotations')
      .insert(annotation)
      .returning('*');
    return savedAnnotation;
  }

  static async getAnnotations(invoiceId: string): Promise<IInvoiceAnnotation[]> {
    const { knex } = await createTenantKnex();
    return knex('invoice_annotations').where({ invoice_id: invoiceId });
  }

  static async getAll(): Promise<IInvoice[]> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for listing invoices');
    }

    try {
      const invoices = await knex('invoices')
        .where({ tenant })
        .select('*');
      return invoices;
    } catch (error) {
      console.error(`Error getting all invoices in tenant ${tenant}:`, error);
      throw new Error(`Failed to get invoices: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Revert return type to InvoiceViewModel from interfaces
  static async getFullInvoiceById(invoiceId: string): Promise<InvoiceViewModel> {
    console.log('Getting full invoice details for:', invoiceId);
    const {knex, tenant} = await createTenantKnex();

    console.log('invoice details for invoiceId:', invoiceId, 'tenant:', tenant);

    const invoice = await knex('invoices')
      .select(
        '*',
        knex.raw('CAST(subtotal AS BIGINT) as subtotal'),
        knex.raw('CAST(tax AS BIGINT) as tax'),
        knex.raw('CAST(total_amount AS BIGINT) as total_amount'),
        knex.raw('CAST(credit_applied AS BIGINT) as credit_applied')
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

    // --- Fetch Tenant's Default Company ---
    let tenantCompanyInfo = null;
    const tenantCompanyLink = await knex('tenant_companies')
      .where({ tenant: tenant, is_default: true })
      .select('company_id')
      .first();

    if (tenantCompanyLink) {
      // Step 2: Modify query - remove 'logo_url'
      const tenantCompanyDetails = await knex('companies')
        .where({ company_id: tenantCompanyLink.company_id })
        .select('company_name', 'address') // Removed 'logo_url'
        .first();

      // Step 3: Fetch Logo URL using the utility function
      let logoUrl: string | null = null; // Initialize logoUrl
      if (tenantCompanyDetails) {
         logoUrl = await getCompanyLogoUrl(tenantCompanyLink.company_id, invoice.tenant); // Use invoice.tenant

        // Step 4: Update ViewModel Population
        tenantCompanyInfo = {
          name: tenantCompanyDetails.company_name,
          address: tenantCompanyDetails.address,
          logoUrl: logoUrl, // Use the fetched logoUrl
        };
        console.log('Found tenant default company:', tenantCompanyInfo);
      } else {
        console.warn(`Tenant default company details not found for company_id: ${tenantCompanyLink.company_id}`);
      }
    } else {
      console.warn(`No default company found for tenant: ${tenant}`);
    }
    // --- End Fetch Tenant's Default Company ---
  
    const invoice_items = await this.getInvoiceItems(invoiceId);
    console.log('Processing invoice items for view model:', {
      total: invoice_items.length,
      manual: invoice_items.filter(item => item.is_manual).length,
      automated: invoice_items.filter(item => !item.is_manual).length,
      items: invoice_items.map(item => ({
        id: item.item_id,
        isManual: item.is_manual,
        serviceId: item.service_id,
        description: item.description,
        unitPrice: item.unit_price
      }))
    });
    const company = await knex('companies').where({ company_id: invoice.company_id }).first();
// Add check for company existence
    if (!company) {
      console.error(`!!! Critical Error: Company details not found for company_id ${invoice.company_id} associated with invoice ${invoiceId} !!!`);
      throw new Error(`Customer company details not found for invoice ${invoiceId}. Cannot construct ViewModel.`);
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
      const contact = await knex('contacts')
        .where({ company_id: invoice.company_id }) // Adjust if primary logic differs
        .first();

      const viewModel: InvoiceViewModel = {
        // Fields from the original InvoiceViewModel definition
        invoice_id: invoice.invoice_id,
        invoice_number: invoice.invoice_number,
        company_id: invoice.company_id,
        company: { // Populate company details
          name: company.company_name || '',
          address: company.address || '',
          // Check tenant before calling getCompanyLogoUrl
          logo: tenant ? (await getCompanyLogoUrl(invoice.company_id, tenant)) || '' : '',
        },
        contact: { // Populate contact details
          name: contact?.name || '',
          address: contact?.address || '', // Assuming contact has address
        },
        invoice_date: invoice.invoice_date, // Keep as DateValue
        due_date: invoice.due_date,         // Keep as DateValue
        status: invoice.status,
        subtotal: subtotal,
        tax: tax,
        total: totalAmount, // Use totalAmount which includes tax
        total_amount: totalAmount, // Keep for compatibility if needed, same as total
        invoice_items: invoice_items.map(item => ({ // Map to IInvoiceItem structure
          ...item, // Spread existing item properties
          // Ensure types match IInvoiceItem (they should already from getInvoiceItems)
          unit_price: typeof item.unit_price === 'string' ? parseInt(item.unit_price, 10) : item.unit_price,
          total_price: typeof item.total_price === 'string' ? parseInt(item.total_price, 10) : item.total_price,
          tax_amount: typeof item.tax_amount === 'string' ? parseInt(item.tax_amount, 10) : item.tax_amount,
          net_amount: typeof item.net_amount === 'string' ? parseInt(item.net_amount, 10) : item.net_amount,
          quantity: typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : item.quantity,
          // Add any missing required fields from IInvoiceItem with defaults if necessary
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
        itemCount: viewModel.invoice_items.length,
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
        tenantCompanyInfo: tenantCompanyInfo, // Log tenant info
        itemsData: invoice_items // Log items data
      });
      // Decide how to handle: re-throw, return null, or return specific error object
      throw new Error(`Failed to construct final InvoiceViewModel: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async generateInvoice(invoiceId: string): Promise<IInvoice> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for generating invoice');
    }

    try {
      const [updatedInvoice] = await knex('invoices')
        .where({ 
          invoice_id: invoiceId,
          tenant 
        })
        .update({
          status: 'sent',
          finalized_at: knex.fn.now()
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
