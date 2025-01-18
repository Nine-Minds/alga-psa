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
    const { knex } = await createTenantKnex();
    const query = knex('invoice_items')
      .select(
        'invoice_id',
        'description as name',
        'description',
        'quantity',
        'unit_price',
        'total_price',
        'tax_amount',
        'net_amount')
      .where({ invoice_id: invoiceId });
    console.log(query.toSQL().sql);
    return query;
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
    const { knex } = await createTenantKnex();
    const invoice = await knex('invoices').where({ invoice_id: invoiceId }).first();
    if (!invoice) {
      throw new Error('Invoice not found');
    }
  
    const invoice_items = await this.getInvoiceItems(invoiceId);
    const company = await knex('companies').where({ company_id: invoice.company_id }).first();
  
    const totalAmount = typeof invoice.total_amount === 'string' ? parseFloat(invoice.total_amount) : invoice.total_amount;
    // Construct and return the InvoiceViewModel
    return {
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
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: totalAmount,
      total_amount: totalAmount,
      invoice_id: invoice.invoice_id,
      invoice_items: invoice_items.map((item): IInvoiceItem => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        tax_amount: item.tax_amount,
        net_amount: item.net_amount,
        item_id: '',
        invoice_id: '',
        tenant: item.tenant,
      })),
      custom_fields: invoice.custom_fields,
      finalized_at: invoice.finalized_at,
      credit_applied: invoice.credit_applied || 0
    };
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
