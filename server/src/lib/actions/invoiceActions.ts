'use server'

import { BillingEngine } from '@/lib/billing/billingEngine';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { IInvoiceTemplate, ICustomField, IConditionalRule, IInvoiceAnnotation, InvoiceViewModel, IInvoiceItem } from '@/interfaces/invoice.interfaces';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge } from '@/interfaces/billing.interfaces';
import { IInvoice } from '@/interfaces/invoice.interfaces';
import { ICompany } from '@/interfaces/company.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "@/app/api/auth/[...nextauth]/options";
import Invoice from '@/lib/models/invoice';
import { parseInvoiceTemplate } from '@/lib/invoice-dsl/templateLanguage';
import { createTenantKnex } from '@/lib/db';
import { addDays, format } from 'date-fns';
import { ISO8601String } from '@/types/types.d';
import { parseISO, isBefore } from 'date-fns';
import { TaxService } from '@/lib/services/taxService';
import { ITaxCalculationResult } from '@/interfaces/tax.interfaces';
import { v4 as uuidv4 } from 'uuid';

export async function getCompanyTaxRate(taxRegion: string, date: ISO8601String): Promise<number> {
  const { knex } = await createTenantKnex();
  const taxRates = await knex('tax_rates')
    .where('region', taxRegion)
    .andWhere('start_date', '<=', date)
    .andWhere(function () {
      this.whereNull('end_date')
        .orWhere('end_date', '>=', date);
    })
    .select('tax_percentage');

  const totalTaxRate = taxRates.reduce((sum, rate) => sum + parseFloat(rate.tax_percentage), 0);
  return totalTaxRate;
}

function isFixedPriceCharge(charge: IBillingCharge): charge is IFixedPriceCharge {
  return charge.type === 'fixed';
}

function isTimeBasedCharge(charge: IBillingCharge): charge is ITimeBasedCharge {
  return charge.type === 'time';
}

function isUsageBasedCharge(charge: IBillingCharge): charge is IUsageBasedCharge {
  return charge.type === 'usage';
}

function isBucketCharge(charge: IBillingCharge): charge is IBucketCharge {
  return charge.type === 'bucket';
}

export async function generateInvoice(companyId: string, startDate: ISO8601String, endDate: ISO8601String): Promise<InvoiceViewModel> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const parsedStartDate = parseISO(startDate);
  const parsedEndDate = parseISO(endDate);

  if (!isBefore(parsedStartDate, parsedEndDate)) {
    throw new Error('Invalid billing period: start date must be before end date');
  }

  const billingEngine = new BillingEngine();
  const billingResult = await billingEngine.calculateBilling(companyId, startDate, endDate);

  if (billingResult.charges.length === 0) {
    throw new Error('No active billing plans for this period');
  }

  for (const charge of billingResult.charges) {
    if (charge.rate === undefined || charge.rate === null) {
      throw new Error(`Service "${charge.serviceName}" has an undefined rate`);
    }
  }

  const createdInvoice = await createInvoice(billingResult, companyId, startDate, endDate);
  const fullInvoice = await Invoice.getFullInvoiceById(createdInvoice.invoice_id);

  const nextBillingStartDate = await getNextBillingDate(companyId, endDate);
  await billingEngine.rolloverUnapprovedTime(companyId, endDate, nextBillingStartDate);

  return fullInvoice;
}

function getChargeQuantity(charge: IBillingCharge): number {
  if (isBucketCharge(charge)) return charge.overageHours;
  if (isFixedPriceCharge(charge) || isUsageBasedCharge(charge)) return charge.quantity;
  if (isTimeBasedCharge(charge)) return charge.duration;
  return 1;
}

function getChargeUnitPrice(charge: IBillingCharge): number {
  if (isBucketCharge(charge)) return charge.overageRate;
  return charge.rate;
}

async function createInvoice(billingResult: IBillingResult, companyId: string, startDate: ISO8601String, endDate: ISO8601String): Promise<IInvoice> {
  const { knex, tenant } = await createTenantKnex();
  const company = await knex('companies').where({ company_id: companyId }).first() as ICompany;
  if (!company) {
    throw new Error(`Company with ID ${companyId} not found`);
  }

  if (!tenant) {
    throw new Error('No tenant found');
  }

  const taxService = new TaxService();
  let subtotal = 0;
  let totalTax = 0;
  const due_date = await getDueDate(companyId, endDate);

  const invoice: Omit<IInvoice, 'invoice_id'> = {
    tenant,
    company_id: companyId,
    invoice_date: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss'Z'"),
    due_date,
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    status: 'draft',
    invoice_number: await generateInvoiceNumber(),
    billing_period_start: startDate,
    billing_period_end: endDate,
    credit_applied: 0 // Will be calculated after taxes
  };

  const createdInvoice = await knex.transaction(async (trx) => {
    const [newInvoice] = await trx('invoices').insert(invoice).returning('*');

    // Get current balance
    const currentBalance = await trx('transactions')
      .where({ company_id: companyId })
      .orderBy('created_at', 'desc')
      .first()
      .then(lastTx => lastTx?.balance_after || 0);

    // Record invoice generation transaction
    await trx('transactions').insert({
      transaction_id: uuidv4(),
      company_id: companyId,
      invoice_id: newInvoice.invoice_id,
      amount: newInvoice.total_amount,
      type: 'invoice_generated',
      status: 'completed',
      description: `Generated invoice ${newInvoice.invoice_number}`,
      created_at: new Date().toISOString(),
      tenant,
      balance_after: currentBalance + newInvoice.total_amount
    });

    // If discounts were applied, record those transactions
    for (const discount of billingResult.discounts) {
      const currentBalance = await trx('transactions')
        .where({ company_id: companyId })
        .orderBy('created_at', 'desc')
        .first()
        .then(lastTx => lastTx?.balance_after || 0);

      await trx('transactions').insert({
        transaction_id: uuidv4(),
        company_id: companyId,
        invoice_id: newInvoice.invoice_id,
        amount: -(discount.amount || 0),
        type: 'price_adjustment',
        status: 'completed',
        description: `Applied discount: ${discount.discount_name}`,
        created_at: new Date().toISOString(),
        tenant,
        metadata: { discount_id: discount.discount_id },
        balance_after: currentBalance - (discount.amount || 0)
      });
    }

    return newInvoice;
  });

  for (const charge of billingResult.charges) {
    const { netAmount, taxCalculationResult } = await calculateChargeDetails(charge, companyId, endDate, taxService);

    const invoiceItem = {
      item_id: uuidv4(),
      service_id: charge.serviceId,
      description: isBucketCharge(charge) ? `${charge.serviceName} (Overage)` : charge.serviceName,
      quantity: getChargeQuantity(charge),
      unit_price: getChargeUnitPrice(charge),
      net_amount: netAmount,
      tax_amount: taxCalculationResult.taxAmount,
      tax_region: charge.tax_region,
      tax_rate: taxCalculationResult.taxRate,
      total_price: netAmount + taxCalculationResult.taxAmount,
    };

    await createInvoiceItem(createdInvoice.invoice_id, invoiceItem);

    subtotal += netAmount;
    totalTax += taxCalculationResult.taxAmount;
  }

  // Handle discounts
  for (const discount of billingResult.discounts) {
    const netAmount = -Math.ceil(discount.amount || 0);
    const taxCalculationResult = await taxService.calculateTax(companyId, netAmount, endDate);

    const discountInvoiceItem = {
      item_id: uuidv4(),
      description: discount.discount_name,
      quantity: 1,
      unit_price: netAmount,
      net_amount: netAmount,
      tax_amount: taxCalculationResult.taxAmount,
      tax_rate: taxCalculationResult.taxRate,
      total_price: netAmount + taxCalculationResult.taxAmount,
    };
    await createInvoiceItem(createdInvoice.invoice_id, discountInvoiceItem);

    subtotal += netAmount;
    totalTax += taxCalculationResult.taxAmount;
  }

  const totalAmount = subtotal + totalTax;
  
  // Get available credit and calculate how much to apply
  const availableCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
  const creditToApply = Math.min(availableCredit, Math.ceil(totalAmount));
  const finalTotalAmount = Math.max(0, Math.ceil(totalAmount) - creditToApply);

  await knex('invoices')
    .where({ invoice_id: createdInvoice.invoice_id })
    .update({
      subtotal: Math.ceil(subtotal),
      tax: Math.ceil(totalTax),
      total_amount: Math.ceil(finalTotalAmount),
      credit_applied: Math.ceil(creditToApply)
    });

  // If credit was applied, create a transaction and update company credit balance
  if (creditToApply > 0) {
    const currentBalance = await knex('transactions')
      .where({ company_id: companyId })
      .orderBy('created_at', 'desc')
      .first()
      .then(lastTx => lastTx?.balance_after || 0);

    await CompanyBillingPlan.createTransaction({
      company_id: companyId,
      invoice_id: createdInvoice.invoice_id,
      amount: -creditToApply,
      type: 'credit_application',
      description: `Applied credit to invoice ${invoice.invoice_number}`,
      balance_after: currentBalance - creditToApply
    });

    await CompanyBillingPlan.updateCompanyCredit(companyId, -creditToApply);
  }

  return { 
    ...createdInvoice, 
    subtotal: Math.ceil(subtotal), 
    tax: Math.ceil(totalTax), 
    total_amount: finalTotalAmount,
    credit_applied: invoice.credit_applied
  };
}

async function calculateChargeDetails(
  charge: IBillingCharge,
  companyId: string,
  endDate: ISO8601String,
  taxService: TaxService
): Promise<{ netAmount: number; taxCalculationResult: ITaxCalculationResult }> {
  let netAmount: number;

  if ('overageHours' in charge && 'overageRate' in charge) {
    const bucketCharge = charge as IBucketCharge;
    netAmount = bucketCharge.overageHours > 0 ? Math.ceil(bucketCharge.total) : 0;
  } else {
    netAmount = Math.ceil(charge.total);
  }

  const taxCalculationResult = await taxService.calculateTax(companyId, netAmount, endDate);
  return { netAmount, taxCalculationResult };
}

async function createInvoiceItem(invoiceId: string, item: Omit<IInvoiceItem, 'invoice_id' | 'tenant'>): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  await knex('invoice_items').insert({
    ...item,
    invoice_id: invoiceId,
    tenant,
    net_amount: Math.ceil(item.net_amount),
    tax_amount: Math.ceil(item.tax_amount),
    total_price: Math.ceil(item.total_price),
    unit_price: Math.ceil(item.unit_price)
  });
}

export async function generateInvoiceNumber(): Promise<string> {
  const { knex } = await createTenantKnex();
  const result = await knex('invoices')
    .max('invoice_number as lastInvoiceNumber')
    .first();

  const lastNumber = result?.lastInvoiceNumber ? parseInt(result.lastInvoiceNumber.toString().split('-')[1]) : 0;
  const newNumber = lastNumber + 1;
  return `INV-${newNumber.toString().padStart(6, '0')}`;
}

async function getDueDate(companyId: string, billingEndDate: ISO8601String): Promise<ISO8601String> {
  const { knex } = await createTenantKnex();
  const company = await knex('companies')
    .where({ company_id: companyId })
    .select('payment_terms')
    .first();

  const paymentTerms = company?.payment_terms || 30;
  const dueDate = addDays(billingEndDate, paymentTerms);
  return dueDate.toISOString();
}

export async function finalizeInvoice(invoiceId: string): Promise<IInvoice> {
  const updatedInvoice = await Invoice.finalizeInvoice(invoiceId);
  return updatedInvoice;
}

async function getNextBillingDate(companyId: string, currentEndDate: ISO8601String): Promise<ISO8601String> {
  const { knex } = await createTenantKnex();
  const company = await knex('company_billing_cycles')
    .where({ company_id: companyId })
    .select('billing_cycle')
    .first();

  const billingCycle = company?.billing_cycle || 'monthly';
  const nextDate = new Date(currentEndDate);

  switch (billingCycle) {
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case 'bi-weekly':
      nextDate.setDate(nextDate.getDate() + 14);
      break;
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    case 'quarterly':
      nextDate.setMonth(nextDate.getMonth() + 3);
      break;
    case 'semi-annually':
      nextDate.setMonth(nextDate.getMonth() + 6);
      break;
    case 'annually':
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      break;
    default:
      nextDate.setMonth(nextDate.getMonth() + 1);
  }

  return nextDate.toISOString();
}

export async function fetchAllInvoices(): Promise<InvoiceViewModel[]> {
  try {
    const invoices = await Invoice.getAll();
    const fullInvoices = await Promise.all(invoices.map(async (invoice):Promise<InvoiceViewModel> => {
      return await Invoice.getFullInvoiceById(invoice.invoice_id);
    }));
    return fullInvoices;
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw new Error('Error fetching invoices');
  }
}

async function getCompanyById(companyId: string): Promise<ICompany> {
  const { knex } = await createTenantKnex();
  const company = await knex('companies').where({ company_id: companyId }).first();
  if (!company) {
    throw new Error(`Company with ID ${companyId} not found`);
  }
  return company as ICompany;
}

export async function getInvoiceTemplate(templateId: string): Promise<IInvoiceTemplate | null> {
  const { knex } = await createTenantKnex();
  const template = await knex<IInvoiceTemplate>('invoice_templates')
    .where({ template_id: templateId })
    .first();

  if (template) {
    template.dsl = template.dsl || '';
    template.parsed = template.dsl ? parseInvoiceTemplate(template.dsl) : null;
  }

  return template || null;
}

export async function getInvoiceTemplates(): Promise<IInvoiceTemplate[]> {
  const templates = await Invoice.getTemplates();
  return templates.map((template):IInvoiceTemplate => ({
    ...template,
    parsed: template.dsl ? parseInvoiceTemplate(template.dsl) : null
  }));
}

export async function saveInvoiceTemplate(template: Omit<IInvoiceTemplate, 'tenant'>): Promise<IInvoiceTemplate> {
  const savedTemplate = await Invoice.saveTemplate({
    ...template
  });
  return {
    ...savedTemplate,
    parsed: savedTemplate.dsl ? parseInvoiceTemplate(savedTemplate.dsl) : null
  };
}

export async function getCustomFields(): Promise<ICustomField[]> {
  // Implementation to fetch custom fields
  return [];
}

export async function saveCustomField(field: ICustomField): Promise<ICustomField> {
  // Implementation to save or update a custom field
  return field;
}

export async function getConditionalRules(templateId: string): Promise<IConditionalRule[]> {
  // Implementation to fetch conditional rules for a template
  return [];
}

export async function saveConditionalRule(rule: IConditionalRule): Promise<IConditionalRule> {
  // Implementation to save or update a conditional rule
  return rule;
}

export async function addInvoiceAnnotation(annotation: Omit<IInvoiceAnnotation, 'annotation_id'>): Promise<IInvoiceAnnotation> {
  // Implementation to add an invoice annotation
  return {
    annotation_id: 'generated_id',
    ...annotation,
  };
}

export async function getInvoiceAnnotations(invoiceId: string): Promise<IInvoiceAnnotation[]> {
  // Implementation to fetch annotations for an invoice
  return [];
}
