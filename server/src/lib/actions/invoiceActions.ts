'use server'

import { BillingEngine } from '@/lib/billing/billingEngine';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { IInvoiceTemplate, ICustomField, IConditionalRule, IInvoiceAnnotation, InvoiceViewModel, IInvoiceItem } from '@/interfaces/invoice.interfaces';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, BillingCycleType, ICompanyBillingCycle } from '@/interfaces/billing.interfaces';
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

export async function getAvailableBillingPeriods(): Promise<(ICompanyBillingCycle & {
  company_name: string;
  total_unbilled: number;
  period_start_date: ISO8601String;
  period_end_date: ISO8601String;
  can_generate: boolean;
})[]> {
  console.log('Starting getAvailableBillingPeriods');
  const { knex } = await createTenantKnex();
  const currentDate = new Date().toISOString();
  console.log(`Current date: ${currentDate}`);

  try {
    // Get all billing cycles that don't have invoices
    console.log('Querying for available billing periods');
    const availablePeriods = await knex('company_billing_cycles as cbc')
      .join('companies as c', 'c.company_id', 'cbc.company_id')
      .leftJoin('invoices as i', 'i.billing_cycle_id', 'cbc.billing_cycle_id')
      .whereNotNull('cbc.period_end_date')
      .whereNull('i.invoice_id')
      .select(
        'cbc.company_id',
        'c.company_name',
        'cbc.billing_cycle_id',
        'cbc.billing_cycle',
        'cbc.period_start_date',
        'cbc.period_end_date',
        'cbc.effective_date',
        'cbc.tenant'
      );

    console.log(`Found ${availablePeriods.length} available billing periods`);

    const currentDate = new Date().toISOString();

    // For each period, calculate the total unbilled amount
    console.log('Calculating unbilled amounts for each period');
    const periodsWithTotals = await Promise.all(availablePeriods.map(async (period): Promise<ICompanyBillingCycle & {
      company_name: string;
      total_unbilled: number;
      period_start_date: ISO8601String;
      period_end_date: ISO8601String;
      can_generate: boolean;
    }> => {
      console.log(`Processing period for company: ${period.company_name} (${period.company_id})`);
      console.log(`Period dates: ${period.period_start_date} to ${period.period_end_date}`);

      const billingEngine = new BillingEngine();
      let total_unbilled = 0;
      try {
        const billingResult = await billingEngine.calculateBilling(
          period.company_id,
          period.period_start_date,
          period.period_end_date,
          period.billing_cycle_id
        );
        total_unbilled = billingResult.charges.reduce((sum, charge) => sum + charge.total, 0);
      } catch (error) {
        console.log(`No billable charges for company ${period.company_name} (${period.company_id})`);
      }
      console.log(`Total unbilled amount for ${period.company_name}: ${total_unbilled}`);

      // A period can be generated if its end date is in the past
      const can_generate = new Date(period.period_end_date) <= new Date(currentDate);

      return {
        ...period,
        total_unbilled,
        can_generate
      };
    }));

    console.log(`Successfully processed ${periodsWithTotals.length} billing periods`);
    return periodsWithTotals;

  } catch (error) {
    console.error('Error in getAvailableBillingPeriods:', error);
    throw error;
  }
}

export async function generateInvoice(billing_cycle_id: string): Promise<InvoiceViewModel> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Get billing cycle details
  const { knex } = await createTenantKnex();
  const billingCycle = await knex('company_billing_cycles')
    .where({ billing_cycle_id })
    .first();

  if (!billingCycle) {
    throw new Error('Invalid billing cycle');
  }

  const { company_id, effective_date } = billingCycle;

  // Calculate cycle dates based on effective_date and billing cycle
  const cycleStart = new Date(effective_date).toISOString().replace('.000', '');
  const cycleEnd = (await getNextBillingDate(company_id, effective_date)).replace('.000', '');

  const billingEngine = new BillingEngine();
  const billingResult = await billingEngine.calculateBilling(company_id, cycleStart, cycleEnd, billing_cycle_id);

  if (billingResult.charges.length === 0) {
    throw new Error('No active billing plans for this period');
  }

  for (const charge of billingResult.charges) {
    if (charge.rate === undefined || charge.rate === null) {
      throw new Error(`Service "${charge.serviceName}" has an undefined rate`);
    }
  }

  const createdInvoice = await createInvoice(billingResult, company_id, cycleStart, cycleEnd, billing_cycle_id);
  const fullInvoice = await Invoice.getFullInvoiceById(createdInvoice.invoice_id);

  const nextBillingStartDate = await getNextBillingDate(company_id, cycleEnd);
  await billingEngine.rolloverUnapprovedTime(company_id, cycleEnd, nextBillingStartDate);

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

async function createInvoice(billingResult: IBillingResult, companyId: string, startDate: ISO8601String, endDate: ISO8601String, billing_cycle_id: string): Promise<IInvoice> {
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
    credit_applied: 0,
    billing_cycle_id: billing_cycle_id
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

    // Process each charge and create invoice items
    for (const charge of billingResult.charges) {
      const { netAmount, taxCalculationResult } = await calculateChargeDetails(charge, companyId, endDate, taxService);

      const invoiceItem = {
        item_id: uuidv4(),
        invoice_id: newInvoice.invoice_id,
        service_id: charge.serviceId,
        description: isBucketCharge(charge) ? `${charge.serviceName} (Overage)` : charge.serviceName,
        quantity: getChargeQuantity(charge),
        unit_price: getChargeUnitPrice(charge),
        net_amount: netAmount,
        tax_amount: taxCalculationResult.taxAmount,
        tax_region: charge.tax_region,
        tax_rate: taxCalculationResult.taxRate,
        total_price: netAmount + taxCalculationResult.taxAmount,
        tenant
      };

      await trx('invoice_items').insert(invoiceItem);

      // Link time entries with the invoice and mark as invoiced
      if (isTimeBasedCharge(charge)) {
        await trx('invoice_time_entries').insert({
          invoice_time_entry_id: uuidv4(),
          invoice_id: newInvoice.invoice_id,
          entry_id: charge.entryId,
          tenant
        });

        await trx('time_entries')
          .where({ entry_id: charge.entryId })
          .update({ invoiced: true });
      }

      // Link usage records with the invoice and mark as invoiced
      if (isUsageBasedCharge(charge)) {
        await trx('invoice_usage_records').insert({
          invoice_usage_record_id: uuidv4(),
          invoice_id: newInvoice.invoice_id,
          usage_id: charge.usageId,
          tenant
        });

        await trx('usage_tracking')
          .where({ usage_id: charge.usageId })
          .update({ invoiced: true });
      }

      subtotal += netAmount;
      totalTax += taxCalculationResult.taxAmount;
    }

    // Handle discounts
    for (const discount of billingResult.discounts) {
      const netAmount = Math.round(-(discount.amount || 0));
      const taxCalculationResult = await taxService.calculateTax(companyId, netAmount, endDate);

      const discountInvoiceItem = {
        item_id: uuidv4(),
        invoice_id: newInvoice.invoice_id,
        description: discount.discount_name,
        quantity: 1,
        unit_price: netAmount,
        net_amount: netAmount,
        tax_amount: taxCalculationResult.taxAmount,
        tax_rate: taxCalculationResult.taxRate,
        total_price: netAmount + taxCalculationResult.taxAmount,
        tenant
      };
      await trx('invoice_items').insert(discountInvoiceItem);

      subtotal += netAmount;
      totalTax += taxCalculationResult.taxAmount;

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

    const totalAmount = subtotal + totalTax;

    // Get available credit and calculate how much to apply
    const availableCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    const creditToApply = Math.min(availableCredit, Math.ceil(totalAmount));
    const finalTotalAmount = Math.max(0, Math.ceil(totalAmount) - creditToApply);

    await trx('invoices')
      .where({ invoice_id: newInvoice.invoice_id })
      .update({
        subtotal: Math.ceil(subtotal),
        tax: Math.ceil(totalTax),
        total_amount: Math.ceil(finalTotalAmount),
        credit_applied: Math.ceil(creditToApply)
      });

    // If credit was applied, create a transaction and update company credit balance
    if (creditToApply > 0) {
      const currentBalance = await trx('transactions')
        .where({ company_id: companyId })
        .orderBy('created_at', 'desc')
        .first()
        .then(lastTx => lastTx?.balance_after || 0);

      await CompanyBillingPlan.createTransaction({
        company_id: companyId,
        invoice_id: newInvoice.invoice_id,
        amount: -creditToApply,
        type: 'credit_application',
        description: `Applied credit to invoice ${invoice.invoice_number}`,
        balance_after: currentBalance - creditToApply
      }, trx);

      await CompanyBillingPlan.updateCompanyCredit(companyId, -creditToApply);
    }

    return newInvoice;
  });

  const viewModel: InvoiceViewModel = {
    invoice_id: createdInvoice.invoice_id,
    invoice_number: createdInvoice.invoice_number,
    company_id: companyId,
    company: {
      name: company.company_name,
      logo: '',
      address: company.address || ''
    },
    contact: {
      name: '',  // TODO: Add contact info
      address: ''
    },
    invoice_date: createdInvoice.invoice_date,
    due_date: createdInvoice.due_date,
    status: createdInvoice.status,
    subtotal: Math.ceil(subtotal),
    tax: Math.ceil(totalTax),
    total: createdInvoice.total_amount,
    total_amount: createdInvoice.total_amount,
    invoice_items: await knex('invoice_items').where({ invoice_id: createdInvoice.invoice_id }),
    credit_applied: invoice.credit_applied,
  };

  return viewModel;
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

export async function generateInvoiceNumber(): Promise<string> {
  const { knex } = await createTenantKnex();
  const result = await knex('invoices')
    .max('invoice_number as lastInvoiceNumber')
    .first();

  const lastNumber = result?.lastInvoiceNumber ? parseInt(result.lastInvoiceNumber.toString().split('-')[1]) : 0;
  const newNumber = lastNumber + 1;
  return `INV-${newNumber.toString().padStart(6, '0')}`;
}

function getPaymentTermDays(paymentTerms: string): number {
  switch (paymentTerms) {
    case 'net_30':
      return 30;
    case 'net_15':
      return 15;
    case 'due_on_receipt':
      return 0;
    default:
      return 30; // Default to 30 days if unknown payment term
  }
}

async function getDueDate(companyId: string, billingEndDate: ISO8601String): Promise<ISO8601String> {
  const { knex } = await createTenantKnex();
  const company = await knex('companies')
    .where({ company_id: companyId })
    .select('payment_terms')
    .first();

  const paymentTerms = company?.payment_terms || 'net_30';
  const days = getPaymentTermDays(paymentTerms);
  console.log('paymentTerms', paymentTerms, 'days', days);
  const dueDate = addDays(billingEndDate, days);
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

  const billingCycle = (company?.billing_cycle || 'monthly') as BillingCycleType;
  const currentUTC = new Date(currentEndDate);
  currentUTC.setUTCHours(0, 0, 0, 0);
  const nextDate = new Date(currentUTC);

  switch (billingCycle) {
    case 'weekly':
      nextDate.setUTCDate(nextDate.getUTCDate() + 7);
      break;
    case 'bi-weekly':
      nextDate.setUTCDate(nextDate.getUTCDate() + 14);
      break;
    case 'monthly':
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
      break;
    case 'quarterly':
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 3);
      break;
    case 'semi-annually':
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 6);
      break;
    case 'annually':
      nextDate.setUTCFullYear(nextDate.getUTCFullYear() + 1);
      break;
    default:
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
  }

  return nextDate.toISOString();
}

export async function fetchAllInvoices(): Promise<InvoiceViewModel[]> {
  try {
    const invoices = await Invoice.getAll();
    const fullInvoices = await Promise.all(invoices.map(async (invoice): Promise<InvoiceViewModel> => {
      return await Invoice.getFullInvoiceById(invoice.invoice_id);
    }));
    return fullInvoices;
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw new Error('Error fetching invoices');
  }
}

export async function getInvoiceTemplate(_templateId: string): Promise<IInvoiceTemplate | null> {
  const { knex } = await createTenantKnex();
  const template = await knex<IInvoiceTemplate>('invoice_templates')
    .where({ template_id: _templateId })
    .first();

  if (template) {
    template.dsl = template.dsl || '';
    template.parsed = template.dsl ? parseInvoiceTemplate(template.dsl) : null;
  }

  return template || null;
}

export async function getInvoiceTemplates(): Promise<IInvoiceTemplate[]> {
  const templates = await Invoice.getAllTemplates();
  return templates.map((template): IInvoiceTemplate => ({
    ...template,
    parsed: template.dsl ? parseInvoiceTemplate(template.dsl) : null
  }));
}

export async function saveInvoiceTemplate(template: Omit<IInvoiceTemplate, 'tenant'>): Promise<IInvoiceTemplate> {
  if (template.isStandard) {
    throw new Error('Cannot modify standard templates');
  }

  // When cloning, create a new template object with a new template_id
  const templateToSave = template.isClone ? {
    ...template,                // Keep all existing fields
    template_id: uuidv4(),      // Generate new ID for clone
    isStandard: false,         // Reset standard flag
    isClone: false             // Reset clone flag
  } : template;
  
  const savedTemplate = await Invoice.saveTemplate(templateToSave);
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

export async function getInvoiceAnnotations(_invoiceId: string): Promise<IInvoiceAnnotation[]> {
  // Implementation to fetch annotations for an invoice
  return [];
}
