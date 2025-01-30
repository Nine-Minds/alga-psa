'use server'

import { BillingEngine } from '@/lib/billing/billingEngine';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { Knex } from 'knex';
import {
  IInvoiceTemplate,
  ICustomField,
  IConditionalRule,
  IInvoiceAnnotation,
  InvoiceViewModel,
  IManualInvoiceItem,
  IInvoiceItem,
  IInvoice,
  DiscountType,
  InvoiceStatus,
  PreviewInvoiceResponse
} from '@/interfaces/invoice.interfaces';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, BillingCycleType, ICompanyBillingCycle } from '@/interfaces/billing.interfaces';
import { ICompany } from '@/interfaces/company.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "@/app/api/auth/[...nextauth]/options";
import Invoice from '@/lib/models/invoice';
import { parseInvoiceTemplate } from '@/lib/invoice-dsl/templateLanguage';
import { createTenantKnex } from '@/lib/db';
import { addDays, format, parseISO } from 'date-fns';
import { PDFGenerationService } from '@/services/pdf-generation.service';
import { StorageService } from '@/lib/storage/StorageService';
import { ISO8601String } from '@/types/types.d';
import { TaxService } from '@/lib/services/taxService';
import { ITaxCalculationResult } from '@/interfaces/tax.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Tent } from 'lucide-react';
import { auditLog } from '@/lib/logging/auditLog';
import { getAdminConnection } from '../db/admin';
interface ManualInvoiceUpdate {
  service_id?: string;
  description?: string;
  quantity?: number;
  rate?: number;
  item_id: string;
  is_discount?: boolean;
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
}

interface ManualItemsUpdate {
  newItems: IManualInvoiceItem[];
  updatedItems: ManualInvoiceUpdate[];
  removedItemIds: string[];
}

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
  is_early: boolean;
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
      is_early: boolean;
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
      } catch (_error) {
        console.log(`No billable charges for company ${period.company_name} (${period.company_id})`);
      }
      console.log(`Total unbilled amount for ${period.company_name}: ${total_unbilled}`);

      // Allow generation of invoices even if period hasn't ended
      const can_generate = true;
      const is_early = new Date(period.period_end_date) > new Date(currentDate);

      return {
        ...period,
        total_unbilled,
        can_generate,
        is_early
      };
    }));

    console.log(`Successfully processed ${periodsWithTotals.length} billing periods`);
    return periodsWithTotals;

  } catch (_error) {
    console.error('Error in getAvailableBillingPeriods:', _error);
    throw _error;
  }
}

export async function previewInvoice(billing_cycle_id: string): Promise<PreviewInvoiceResponse> {
  const { knex } = await createTenantKnex();
  
  // Get billing cycle details
  const billingCycle = await knex('company_billing_cycles')
    .where({ billing_cycle_id })
    .first();

  if (!billingCycle) {
    return {
      success: false,
      error: 'Invalid billing cycle'
    };
  }

  const { company_id, effective_date } = billingCycle;

  // Calculate cycle dates
  const cycleStart = new Date(effective_date).toISOString().replace('.000', '');
  const cycleEnd = (await getNextBillingDate(company_id, effective_date)).replace('.000', '');

  const billingEngine = new BillingEngine();
  try {
    const billingResult = await billingEngine.calculateBilling(company_id, cycleStart, cycleEnd, billing_cycle_id);

    if (billingResult.charges.length === 0) {
      return {
        success: false,
        error: 'Nothing to bill'
      };
    }

    // Create invoice view model without persisting
    const company = await knex('companies').where({ company_id }).first();
    const due_date = await getDueDate(company_id, cycleEnd);

    const previewInvoice: InvoiceViewModel = {
      invoice_id: 'preview-' + billing_cycle_id,
      invoice_number: 'PREVIEW',
      company_id,
      company: {
        name: company?.company_name || '',
        logo: '',
        address: company?.address || ''
      },
      contact: {
        name: '',
        address: ''
      },
      invoice_date: new Date(),
      due_date: new Date(due_date),
      status: 'draft',
      subtotal: billingResult.totalAmount,
      tax: 0, // Will be calculated in UI
      total: billingResult.finalAmount,
      total_amount: billingResult.finalAmount,
      credit_applied: 0,
      billing_cycle_id,
      is_manual: false,
      invoice_items: billingResult.charges.map(charge => ({
        item_id: 'preview-' + uuidv4(),
        invoice_id: 'preview-' + billing_cycle_id,
        service_id: charge.serviceId,
        description: charge.serviceName,
        quantity: getChargeQuantity(charge),
        unit_price: getChargeUnitPrice(charge),
        total_price: charge.total,
        tax_amount: charge.tax_amount || 0,
        tax_rate: charge.tax_rate || 0,
        tax_region: charge.tax_region || '',
        net_amount: charge.total - (charge.tax_amount || 0),
        is_manual: false
      }))
    };

    return {
      success: true,
      data: previewInvoice
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'An error occurred while previewing the invoice'
    };
  }
}

export async function generateInvoice(billing_cycle_id: string): Promise<InvoiceViewModel> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Get billing cycle details
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

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
    throw new Error('Nothing to bill');
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
    throw new Error('Tenant not found');
  }

  const taxService = new TaxService();
  let subtotal = 0;
  let totalTax = 0;
  const due_date = await getDueDate(companyId, endDate);

  const invoice: Omit<IInvoice, 'invoice_id'> = {
    company_id: companyId,
    invoice_date: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss'Z'"),
    due_date,
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    status: 'draft',
    invoice_number: await generateInvoiceNumber(),
    credit_applied: 0,
    billing_cycle_id: billing_cycle_id,
    tenant: tenant,
    is_manual: false
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
      balance_after: currentBalance + newInvoice.total_amount,
      tenant: tenant
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
        is_manual: false,
        tenant: tenant
      };

      await trx('invoice_items').insert(invoiceItem);

      // Link time entries with the invoice and mark as invoiced
      if (isTimeBasedCharge(charge)) {
        await trx('invoice_time_entries').insert({
          invoice_time_entry_id: uuidv4(),
          invoice_id: newInvoice.invoice_id,
          entry_id: charge.entryId,
          tenant: tenant
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
          tenant: tenant,
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
        total_price: netAmount + taxCalculationResult.taxAmount
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
    billing_cycle_id: billing_cycle_id,
    is_manual: false
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


export async function getNextBillingDate(companyId: string, currentEndDate: ISO8601String): Promise<ISO8601String> {
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

// Helper function to create basic invoice view model
async function getBasicInvoiceViewModel(invoice: IInvoice, company: any): Promise<InvoiceViewModel> {
  return {
    invoice_id: invoice.invoice_id,
    invoice_number: invoice.invoice_number,
    company_id: invoice.company_id,
    company: {
      name: company.company_name,
      logo: company.logo || '',
      address: company.address || ''
    },
    contact: {
      name: '',  // Contact info not stored in invoice
      address: ''
    },
    invoice_date: parseISO(typeof invoice.invoice_date === 'string' ? invoice.invoice_date : invoice.invoice_date.toISOString()),
    due_date: parseISO(typeof invoice.due_date === 'string' ? invoice.due_date : invoice.due_date.toISOString()),
    status: invoice.status,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total_amount,
    total_amount: invoice.total_amount,
    credit_applied: (invoice.credit_applied || 0),
    is_manual: invoice.is_manual,
    finalized_at: invoice.finalized_at ? parseISO(typeof invoice.finalized_at === 'string' ? invoice.finalized_at : invoice.finalized_at.toISOString()) : undefined,
    invoice_items: [] // Empty array initially
  };
}

export async function fetchAllInvoices(): Promise<InvoiceViewModel[]> {
  try {
    console.log('Fetching basic invoice info');
    const { knex } = await createTenantKnex();
    
    // Get invoices with company info in a single query
    const invoices = await knex('invoices')
      .join('companies', 'invoices.company_id', 'companies.company_id')
      .select(
        'invoices.invoice_id',
        'invoices.company_id',
        'invoices.invoice_number',
        'invoices.invoice_date',
        'invoices.due_date',
        'invoices.status',
        'invoices.is_manual',
        'invoices.finalized_at',
        'invoices.billing_cycle_id',
        knex.raw('CAST(invoices.subtotal AS INTEGER) as subtotal'),
        knex.raw('CAST(invoices.tax AS INTEGER) as tax'),
        knex.raw('CAST(invoices.total_amount AS INTEGER) as total_amount'),
        knex.raw('CAST(invoices.credit_applied AS INTEGER) as credit_applied'),
        'companies.company_name',
        'companies.address',
        'companies.properties'
      );

    console.log(`Got ${invoices.length} invoices`);

    // Map to view models without line items
    return Promise.all(invoices.map(invoice => {
      const companyProperties = invoice.properties as { logo?: string } || {};
      return getBasicInvoiceViewModel(invoice, {
        company_name: invoice.company_name,
        logo: companyProperties.logo || '',
        address: invoice.address || ''
      });
    }));
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw new Error('Error fetching invoices');
  }
}

export async function getInvoiceForRendering(invoiceId: string): Promise<InvoiceViewModel> {
  try {
    console.log('Fetching full invoice details for rendering:', invoiceId);
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return Invoice.getFullInvoiceById(invoiceId);
  } catch (error) {
    console.error('Error fetching invoice for rendering:', error);
    throw new Error('Error fetching invoice for rendering');
  }
}

// New function to get invoice items on demand
export async function getInvoiceLineItems(invoiceId: string): Promise<IInvoiceItem[]> {
  try {
    console.log('Fetching line items for invoice:', invoiceId);
    const items = await Invoice.getInvoiceItems(invoiceId);
    console.log(`Got ${items.length} line items`);
    return items;
  } catch (error) {
    console.error('Error fetching invoice items:', error);
    throw new Error('Error fetching invoice items');
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

export async function finalizeInvoice(invoiceId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const session = await getServerSession(options);
  
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!tenant) {
    throw new Error('No tenant found');
  }

  await finalizeInvoiceWithKnex(invoiceId, knex, tenant, session.user.id);
}

export async function finalizeInvoiceWithKnex(
  invoiceId: string,
  knex: Knex,
  tenant: string,
  userId: string
): Promise<void> {
  await knex.transaction(async (trx) => {
    // Check if invoice exists and is not already finalized
    const invoice = await trx('invoices')
      .where({ invoice_id: invoiceId })
      .first();

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.finalized_at) {
      throw new Error('Invoice is already finalized');
    }

    await trx('invoices')
      .where({ invoice_id: invoiceId, tenant: tenant })
      .update({
        finalized_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    // Record audit log
    await auditLog(
      trx,
      {
        userId: userId,
        operation: 'invoice_finalized',
        tableName: 'invoices',
        recordId: invoiceId,
        changedData: { finalized_at: new Date().toISOString() },
        details: {
          action: 'Invoice finalized',
          invoiceNumber: invoice.invoice_number
        }
      }
    );
  });
}

export async function unfinalizeInvoice(invoiceId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const session = await getServerSession(options);
  
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!tenant) {
    throw new Error('No tenant found');
  }

  await knex.transaction(async (trx) => {
    // Check if invoice exists and is finalized
    const invoice = await trx('invoices')
      .where({ invoice_id: invoiceId })
      .first();

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (!invoice.finalized_at) {
      throw new Error('Invoice is not finalized');
    }

    await trx('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        finalized_at: null,
        updated_at: new Date().toISOString()
      });

    // Record audit log
    await auditLog(
      trx,
      {
        userId: session.user.id,
        operation: 'invoice_unfinalized',
        tableName: 'invoices',
        recordId: invoiceId,
        changedData: { finalized_at: null },
        details: {
          action: 'Invoice unfinalized',
          invoiceNumber: invoice.invoice_number
        }
      }
    );
  });
}

export async function generateInvoicePDF(invoiceId: string): Promise<{ file_id: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  const storageService = new StorageService();
  const pdfGenerationService = new PDFGenerationService(
    storageService,
    {
      pdfCacheDir: process.env.PDF_CACHE_DIR,
      tenant
    }
  );
  
  const fileRecord = await pdfGenerationService.generateAndStore({
    invoiceId
  });
  
  return { file_id: fileRecord.file_id };
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
  } : template;

  // Parse the DSL to validate it before saving
  if (templateToSave.dsl) {
    // This will throw if the DSL is invalid
    parseInvoiceTemplate(templateToSave.dsl);
  }

  // Remove the temporary flags and parsed field before saving
  const { isClone, isStandard, parsed, ...templateToSaveWithoutFlags } = templateToSave;
  
  const savedTemplate = await Invoice.saveTemplate(templateToSaveWithoutFlags);

  // Add the parsed result to the returned object
  return {
    ...savedTemplate,
    parsed: savedTemplate.dsl ? parseInvoiceTemplate(savedTemplate.dsl) : null,
    isStandard: false // Ensure standard flag is false for saved templates
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

interface ManualInvoiceUpdate {
  service_id?: string;
  description?: string;
  quantity?: number;
  rate?: number;
  item_id: string;
  is_discount?: boolean;
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
}

interface ManualItemsUpdate {
  newItems: IManualInvoiceItem[];
  updatedItems: ManualInvoiceUpdate[];
  removedItemIds: string[];
}

export async function updateInvoiceManualItems(
  invoiceId: string,
  changes: ManualItemsUpdate
): Promise<InvoiceViewModel> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  const session = await getServerSession(options);
  const billingEngine = new BillingEngine();

  console.log('[updateInvoiceManualItems] session:', session);

  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Load and validate invoice
  const invoice = await knex('invoices')
    .where({ invoice_id: invoiceId })
    .first();

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new Error('Cannot modify a paid or cancelled invoice');
  }

  const company = await knex('companies')
    .where({ company_id: invoice.company_id })
    .first();

  if (!company) {
    throw new Error('Company not found');
  }

  const currentDate = new Date().toISOString();

  await knex.transaction(async (trx) => {
    // Delete all existing manual items
    await trx('invoice_items')
      .where({
        invoice_id: invoiceId,
        is_manual: true
      })
      .delete();

    // Process new items
    for (const item of changes.newItems) {
      const unitPriceInCents = Math.round(item.rate);
      const netAmount = Math.round(item.quantity * unitPriceInCents);
      
      let taxRegion = company.tax_region;
      if (item.service_id) {
        const service = await trx('service_catalog')
          .where({ service_id: item.service_id })
          .first();
        taxRegion = service?.tax_region || taxRegion;
      }

      // For percentage discounts, store the percentage in discount_percentage
      // and calculate the initial monetary value for unit_price
      let finalUnitPrice = unitPriceInCents;
      let discountPercentage = null;

      if (item.is_discount && item.discount_type === 'percentage') {
        discountPercentage = item.discount_percentage;
        // Set unit_price to 0 initially, will be calculated in recalculateInvoice
        finalUnitPrice = 0;
      } else if (item.is_discount) {
        // For fixed discounts, ensure the amount is negative
        finalUnitPrice = -Math.abs(unitPriceInCents);
      }

      const invoiceItem = {
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: item.service_id || null,
        description: item.description,
        quantity: item.quantity,
        unit_price: finalUnitPrice,
        net_amount: item.is_discount ? -Math.abs(netAmount) : netAmount,
        tax_amount: 0, // Will be calculated by recalculateInvoice
        tax_rate: 0, // Will be calculated by recalculateInvoice
        tax_region: taxRegion,
        total_price: item.is_discount ? -Math.abs(netAmount) : netAmount, // Will be updated by recalculateInvoice
        is_manual: true,
        is_discount: item.is_discount || false,
        discount_type: item.discount_type,
        discount_percentage: discountPercentage,
        applies_to_item_id: item.applies_to_item_id,
        created_by: session.user.id,
        created_at: currentDate,
        tenant
      };

      await trx('invoice_items').insert(invoiceItem);
    }

    // Process updated items that weren't removed
    for (const item of changes.updatedItems.filter(item => !changes.removedItemIds.includes(item.item_id))) {
      // Only include rate and quantity if they were provided
      const unitPriceInCents = item.rate !== undefined ? Math.round(item.rate) : 0;
      const quantity = item.quantity !== undefined ? item.quantity : 0;
      const netAmount = Math.round(quantity * unitPriceInCents);
      
      let taxRegion = company.tax_region;
      if (item.service_id) {
        const service = await trx('service_catalog')
          .where({ service_id: item.service_id })
          .first();
        taxRegion = service?.tax_region || taxRegion;
      }

      // Get the existing item to check if it's a discount
      const existingItem = await trx('invoice_items')
        .where({ item_id: item.item_id })
        .first();

      // For percentage discounts, preserve the percentage and calculate the initial monetary value
      let finalUnitPrice = unitPriceInCents;
      let discountPercentage = existingItem?.discount_percentage;
      const isDiscount = existingItem?.is_discount || false;

      if (isDiscount && item.discount_type === 'percentage') {
        // Use the new discount_percentage if provided, otherwise keep existing
        discountPercentage = item.discount_percentage !== undefined ? item.discount_percentage : discountPercentage;
        // Set unit_price to 0 initially, will be calculated in recalculateInvoice
        finalUnitPrice = 0;
      } else if (isDiscount) {
        // For fixed discounts, ensure the amount is negative
        finalUnitPrice = -Math.abs(unitPriceInCents);
      }

      const invoiceItem = {
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: item.service_id || null,
        description: item.description,
        quantity: item.quantity,
        unit_price: finalUnitPrice,
        net_amount: isDiscount ? -Math.abs(netAmount) : netAmount,
        tax_amount: 0, // Will be calculated by recalculateInvoice
        tax_rate: 0, // Will be calculated by recalculateInvoice
        tax_region: taxRegion,
        total_price: isDiscount ? -Math.abs(netAmount) : netAmount, // Will be updated by recalculateInvoice
        is_manual: true,
        is_discount: isDiscount,
        discount_type: existingItem?.discount_type,
        discount_percentage: discountPercentage,
        applies_to_item_id: existingItem?.applies_to_item_id,
        created_by: session.user.id,
        created_at: currentDate,
        tenant
      };

      await trx('invoice_items').insert(invoiceItem);
    }

    // Update invoice timestamp
    await trx('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        updated_at: currentDate
      });
  });

  // Recalculate the entire invoice
  await billingEngine.recalculateInvoice(invoiceId);

  return Invoice.getFullInvoiceById(invoiceId);
}

export async function addManualItemsToInvoice(
  invoiceId: string,
  items: IManualInvoiceItem[]
): Promise<InvoiceViewModel> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }
  const session = await getServerSession(options);

  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Load and validate invoice
  const invoice = await knex('invoices')
    .where({ invoice_id: invoiceId })
    .first();

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new Error('Cannot modify a paid or cancelled invoice');
  }

  const company = await knex('companies')
    .where({ company_id: invoice.company_id })
    .first();

  if (!company) {
    throw new Error('Company not found');
  }

  const taxService = new TaxService();
  const currentDate = new Date().toISOString();

  // Calculate current totals
  const oldTotal = invoice.total_amount;
  let newSubtotal = invoice.subtotal;
  let newTotalTax = invoice.tax;

  await knex.transaction(async (trx) => {
    // Process each new manual item
    for (const item of items) {
      const unitPriceInCents = Math.round(item.rate);
      const netAmount = Math.round(item.quantity * unitPriceInCents);

      // console log the items
      console.log('Processing item:', {
        id: item.item_id,
        serviceId: item.service_id,
        description: item.description,
        quantity: item.quantity,
        unitPriceInCents,
        discountPercentage: item.discount_percentage,
        netAmount
      });

      // Get tax info from service if provided, otherwise company default
      let taxRegion = item.tax_region;
      if (!taxRegion && item.service_id) {
        const service = await trx('service_catalog')
          .where({ service_id: item.service_id })
          .first();
        taxRegion = service?.tax_region;
      }
      if (!taxRegion) {
        taxRegion = company.tax_region;
      }

      const taxCalculation = await taxService.calculateTax(
        invoice.company_id,
        netAmount,
        currentDate
      );

      // Create invoice item
      const invoiceItem = {
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: item.service_id || null,
        description: item.description,
        quantity: item.quantity,
        unit_price: unitPriceInCents,
        net_amount: netAmount,
        tax_amount: taxCalculation.taxAmount,
        tax_region: taxRegion,
        tax_rate: taxCalculation.taxRate,
        total_price: netAmount + taxCalculation.taxAmount,
        is_manual: true,
        created_by: session.user.id,
        created_at: currentDate,
        discount_percentage: item.discount_percentage,
        tenant
      };

      await trx('invoice_items').insert(invoiceItem);

      newSubtotal += netAmount;
      newTotalTax += taxCalculation.taxAmount;
    }

    const newTotal = newSubtotal + newTotalTax;
    const difference = newTotal - oldTotal;

    // Update invoice totals
    await trx('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        subtotal: newSubtotal,
        tax: newTotalTax,
        total_amount: newTotal,
        updated_at: currentDate
      });

    // Record adjustment transaction
    if (difference !== 0) {
      const lastTx = await trx('transactions')
        .where({ company_id: invoice.company_id })
        .orderBy('created_at', 'desc')
        .first();

      const currentBalance = lastTx?.balance_after ?? 0;

      await trx('transactions').insert({
        transaction_id: uuidv4(),
        company_id: invoice.company_id,
        invoice_id: invoiceId,
        amount: difference,
        type: 'invoice_adjustment',
        status: 'completed',
        description: `Added manual items to invoice ${invoice.invoice_number}`,
        created_at: currentDate,
        tenant,
        balance_after: currentBalance + difference
      });
    }

    // Handle credit if needed
    if (invoice.credit_applied > 0) {
      const remainingCredit = invoice.credit_applied;
      const additionalDue = Math.max(0, newTotal - oldTotal - remainingCredit);

      if (additionalDue > 0) {
        await trx('invoices')
          .where({ invoice_id: invoiceId })
          .update({
            credit_applied: remainingCredit
          });
      }
    }
  });

  // Return updated invoice view
  return Invoice.getFullInvoiceById(invoiceId);
}

export async function hardDeleteInvoice(invoiceId: string) {
  const { knex } = await createTenantKnex();
  
  await knex.transaction(async (trx) => {
    // 1. Get invoice details
    const invoice = await trx('invoices')
      .where({ invoice_id: invoiceId })
      .first();
      
    // 2. Handle payments
    const payments = await trx('transactions')
      .where({ invoice_id: invoiceId, type: 'payment' });
      
    if (payments.length > 0) {
      // Insert reversal transactions
      await trx('transactions').insert(
        payments.map((p): {
          transaction_id: string;
          type: string;
          amount: number;
          description: string;
        } => ({
          ...p,
          transaction_id: uuidv4(),
          type: 'payment_reversal',
          amount: -p.amount,
          description: `Reversal of payment ${p.transaction_id}`
        }))
      );
    }
    
    // 3. Handle credit
    if (invoice.credit_applied > 0) {
      await trx('transactions').insert({
        transaction_id: uuidv4(),
        type: 'credit_issuance',
        amount: invoice.credit_applied,
        description: `Credit reissued from deleted invoice ${invoiceId}`
      });
      
      await CompanyBillingPlan.updateCompanyCredit(
        invoice.company_id,
        invoice.credit_applied
      );
    }
    
    // 4. Unmark time entries
    await trx('time_entries')
      .whereIn('entry_id', 
        trx('invoice_time_entries')
          .select('entry_id')
          .where({ invoice_id: invoiceId })
      )
      .update({ invoiced: false });
      
    // 5. Unmark usage records
    await trx('usage_tracking')
      .whereIn('usage_id',
        trx('invoice_usage_records')
          .select('usage_id')
          .where({ invoice_id: invoiceId })
      )
      .update({ invoiced: false });
      
    // 6. Delete transactions
    await trx('transactions')
      .where({ invoice_id: invoiceId })
      .delete();

    // 7. Delete join records
    await trx('invoice_time_entries')
      .where({ invoice_id: invoiceId })
      .delete();
      
    await trx('invoice_usage_records')
      .where({ invoice_id: invoiceId })
      .delete();
      
    // 8. Delete invoice items
    await trx('invoice_items')
      .where({ invoice_id: invoiceId })
      .delete();
      
    // 9. Delete invoice record
    await trx('invoices')
      .where({ invoice_id: invoiceId })
      .delete();
  });
}
