// server/src/lib/models/invoice.ts

import { createTenantKnex } from '../db';
import { IInvoice, IInvoiceItem, IInvoiceTemplate, LayoutSection, ICustomField, IConditionalRule, IInvoiceAnnotation, InvoiceViewModel } from '../../interfaces/invoice.interfaces';
import { format } from 'date-fns';

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
    const { knex } = await createTenantKnex();
    const query = knex('invoices').where({ invoice_id: invoiceId }).first();
    console.log('SQL Query:', query.toSQL().sql);
    const invoice = await query;
    if (invoice) {
      invoice.invoice_items = await this.getInvoiceItems(invoiceId);
      invoice.due_date = format(invoice.due_date, 'yyyy-MM-dd')+"T00:00:00Z";
      if (invoice.finalized_at) {
        invoice.finalized_at = format(invoice.finalized_at, 'yyyy-MM-dd')+"T00:00:00Z";
      }
    }
    return invoice || null;
  }

  static async update(invoiceId: string, updateData: Partial<IInvoice>): Promise<IInvoice> {
    const { knex } = await createTenantKnex();
    const [updatedInvoice] = await knex('invoices')
      .where({ invoice_id: invoiceId })
      .update(updateData)
      .returning('*');
    return updatedInvoice;
  }

  static async delete(invoiceId: string): Promise<boolean> {
    const { knex } = await createTenantKnex();
    const deleted = await knex('invoices').where({ invoice_id: invoiceId }).del();
    return deleted > 0;
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
    console.log('Getting invoice items for invoice:', invoiceId);
    console.log('Getting invoice items for invoice:', invoiceId);
    const { knex } = await createTenantKnex();
    const query = knex('invoice_items')
      .select(
        'item_id',
        'invoice_id',
        'service_id',
        'description as name',
        'description',
        knex.raw('CAST(quantity AS INTEGER) as quantity'),
        knex.raw('CAST(unit_price AS INTEGER) as unit_price'),
        knex.raw('CAST(total_price AS INTEGER) as total_price'),
        knex.raw('CAST(tax_amount AS INTEGER) as tax_amount'),
        knex.raw('CAST(net_amount AS INTEGER) as net_amount'),
        'is_manual')
      .where({ invoice_id: invoiceId });

    // Log the raw SQL query
    const { sql, bindings } = query.toSQL();
    console.log('Invoice items query:', { sql, bindings });

    const items = await query;
    console.log('Raw invoice items from DB:', items.map(item => ({
      id: item.item_id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: {
        value: item.unit_price,
        type: typeof item.unit_price
      },
      totalPrice: {
        value: item.total_price,
        type: typeof item.total_price
      },
      taxAmount: {
        value: item.tax_amount,
        type: typeof item.tax_amount
      },
      netAmount: {
        value: item.net_amount,
        type: typeof item.net_amount
      },
      calculatedTotal: item.quantity * item.unit_price,
      matchesTotal: (item.quantity * item.unit_price) === item.total_price ? 'Yes' : 'No'
    })));

    // Log the processed items
    console.log('Found invoice items:', {
      total: items.length,
      manual: items.filter(item => item.is_manual).length,
      automated: items.filter(item => !item.is_manual).length,
      items: items.map(item => ({
        id: item.item_id,
        isManual: item.is_manual,
        serviceId: item.service_id,
        description: item.description,
        unitPrice: item.unit_price
      }))
    });

    return items;
  }

  static async updateInvoiceItem(itemId: string, updateData: Partial<IInvoiceItem>): Promise<IInvoiceItem> {
    const { knex } = await createTenantKnex();
    const [updatedItem] = await knex('invoice_items')
      .where({ item_id: itemId })
      .update(updateData)
      .returning('*');
    return updatedItem;
  }

  static async deleteInvoiceItem(itemId: string): Promise<boolean> {
    const { knex } = await createTenantKnex();
    const deleted = await knex('invoice_items').where({ item_id: itemId }).del();
    return deleted > 0;
  }

  static async getTemplates(): Promise<IInvoiceTemplate[]> {
    const { knex, tenant } = await createTenantKnex();
    return knex('invoice_templates').where({ tenant }).select('*');
  }

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
    const { knex } = await createTenantKnex();
    return knex('invoices').select('*');
  }

  static async getFullInvoiceById(invoiceId: string): Promise<InvoiceViewModel> {
    console.log('Getting full invoice details for:', invoiceId);
    const { knex } = await createTenantKnex();
    const invoice = await knex('invoices')
      .select(
        '*',
        knex.raw('CAST(subtotal AS INTEGER) as subtotal'),
        knex.raw('CAST(tax AS INTEGER) as tax'),
        knex.raw('CAST(total_amount AS INTEGER) as total_amount'),
        knex.raw('CAST(credit_applied AS INTEGER) as credit_applied')
      )
      .where({ invoice_id: invoiceId })
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
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
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
          total_price: item.total_price,
          tax_amount: item.tax_amount,
          net_amount: item.net_amount,
          item_id: item.item_id || '',
          invoice_id: item.invoice_id || '',
          service_id: item.service_id,
          is_manual: item.is_manual || false,
          tenant: item.tenant
        };

        return mappedItem;
      }),
      custom_fields: invoice.custom_fields,
      finalized_at: invoice.finalized_at,
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

  static async finalizeInvoice(invoiceId: string): Promise<IInvoice> {
    const { knex } = await createTenantKnex();
    const [updatedInvoice] = await knex('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        status: 'sent',
        finalized_at: knex.fn.now()
      })
      .returning('*');
    
    if (!updatedInvoice) {
      throw new Error('Invoice not found');
    }

    return updatedInvoice;
  }
}
