// server/src/lib/models/invoice.ts
import { createTenantKnex } from '../db';
import { IInvoice, IInvoiceItem, IInvoiceTemplate, LayoutSection, ICustomField, IConditionalRule, IInvoiceAnnotation, InvoiceViewModel } from '../../interfaces/invoice.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import { getAdminConnection } from '../db/admin';

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
    return knex('standard_invoice_templates')
      .select('template_id', 'name', 'version', 'dsl')
      .orderBy('name');
  }

  static async getAllTemplates(): Promise<IInvoiceTemplate[]> {
    const { knex, tenant } = await createTenantKnex();
    const [tenantTemplates, standardTemplates] = await Promise.all([
      knex('invoice_templates').where({ tenant }).select('*'),
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
    const [savedTemplate] = await knex('invoice_templates')
      .insert({ ...template, tenant: tenant })
      .onConflict(['tenant', 'template_id'])
      .merge()
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

    // Construct and return the InvoiceViewModel
    const viewModel = {
      invoice_number: invoice.invoice_number,
      company_id: invoice.company_id,
      company: {
        name: company.company_name,
        logo: company.logo || '',
        address: company.address || '',
      },
      contact: {
        name: invoice.contact_name || '',
        address: invoice.contact_address || '',
      },
      invoice_date: Temporal.PlainDate.from(invoice.invoice_date.toISOString().replace('Z', '')),
      due_date: Temporal.PlainDate.from(invoice.due_date.toISOString().replace('Z', '')),
      status: invoice.status,
      subtotal: subtotal,
      tax: tax,
      total: totalAmount,
      total_amount: totalAmount,
      invoice_id: invoice.invoice_id,
      invoice_items: invoice_items.map((item): IInvoiceItem => {
        console.log('Processing invoice item:', {
          id: item.item_id,
          isManual: item.is_manual,
          serviceId: item.service_id,
          description: item.description,
          unitPrice: item.unit_price
        });

        const mappedItem: IInvoiceItem = {
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price - item.tax_amount,
          tax_amount: item.tax_amount,
          net_amount: item.net_amount,
          item_id: item.item_id || '',
          invoice_id: item.invoice_id || '',
          service_id: item.service_id,
          is_manual: item.is_manual || false,
          tenant: item.tenant,
          rate: item.rate
        };

        return mappedItem;
      }),
      custom_fields: invoice.custom_fields,
      finalized_at: invoice.finalized_at ? Temporal.PlainDate.from(invoice.finalized_at) : undefined,
      credit_applied: creditApplied,
      is_manual: invoice.is_manual,
    };

    console.log('Returning invoice view model:', {
      id: viewModel.invoice_id,
      number: viewModel.invoice_number,
      isManual: viewModel.is_manual,
      itemCount: viewModel.invoice_items.length,
      manualItems: viewModel.invoice_items.filter(item => item.is_manual).length,
      automatedItems: viewModel.invoice_items.filter(item => !item.is_manual).length,
      items: viewModel.invoice_items.map(item => ({
        id: item.item_id,
        isManual: item.is_manual,
        serviceId: item.service_id,
        description: item.description
      }))
    });

    return viewModel;
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
