'use server'

import { NumberingService } from 'server/src/lib/services/numberingService';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { applyCreditToInvoice } from 'server/src/lib/actions/creditActions';
import { Knex } from 'knex';
import { Session } from 'next-auth';
import {
  IInvoiceTemplate,
  ICustomField,
  IConditionalRule,
  IInvoiceAnnotation,
  InvoiceViewModel,
  IInvoiceItem,
  IInvoice,
  DiscountType,
  PreviewInvoiceResponse
} from 'server/src/interfaces/invoice.interfaces';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, BillingCycleType, ICompanyBillingCycle } from 'server/src/interfaces/billing.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import Invoice from 'server/src/lib/models/invoice';
import { parseInvoiceTemplate } from 'server/src/lib/invoice-dsl/templateLanguage';
import { createTenantKnex } from 'server/src/lib/db';
import { Temporal } from '@js-temporal/polyfill';
import { PDFGenerationService } from 'server/src/services/pdf-generation.service';
import { toPlainDate, toISODate, toISOTimestamp, formatDateOnly } from 'server/src/lib/utils/dateTimeUtils';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { ISO8601String } from 'server/src/types/types.d';
import { TaxService } from 'server/src/lib/services/taxService';
import { ITaxCalculationResult } from 'server/src/interfaces/tax.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { auditLog } from 'server/src/lib/logging/auditLog';
import * as invoiceService from 'server/src/lib/services/invoiceService';
import {getCompanyDetails, persistInvoiceItems, updateInvoiceTotalsAndRecordTransaction} from 'server/src/lib/services/invoiceService';

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
  is_taxable?: boolean;
  tax_region?: string;
}

interface ManualItemsUpdate {
  newItems: IInvoiceItem[];
  updatedItems: ManualInvoiceUpdate[];
  removedItemIds: string[];
  invoice_number?: string;
}

/**
 * Gets the tax rate for a given region and date.
 * Uses the business rule for date ranges where:
 * - start_date is inclusive (>=)
 * - end_date is exclusive (>)
 * This ensures that when one tax rate ends and another begins,
 * there is no overlap or gap in coverage.
 */
export async function getCompanyTaxRate(taxRegion: string, date: ISO8601String): Promise<number> {
  const { knex, tenant } = await createTenantKnex();
  const taxRates = await knex('tax_rates')
    .where({ 
      region: taxRegion,
      tenant 
    })
    .andWhere('start_date', '<=', date)
    .andWhere(function () {
      this.whereNull('end_date')
        .orWhere('end_date', '>', date);
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
  const { knex, tenant } = await createTenantKnex();
  const currentDate = toISODate(Temporal.Now.plainDateISO());
  console.log(`Current date: ${currentDate}`);

  try {
    // Get all billing cycles that don't have invoices
    console.log('Querying for available billing periods');
    const availablePeriods = await knex('company_billing_cycles as cbc')
      .join('companies as c', function() {
        this.on('c.company_id', '=', 'cbc.company_id')
            .andOn('c.tenant', '=', 'cbc.tenant');
      })
      .leftJoin('invoices as i', function() {
        this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id')
            .andOn('i.tenant', '=', 'cbc.tenant');
      })
      .where('cbc.tenant', tenant)
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
      try {
        console.log(`Processing period for company: ${period.company_name} (${period.company_id})`);
        console.log(`Period dates: ${period.period_start_date} to ${period.period_end_date}`);

        // Ensure we have valid dates before proceeding
        if (!period.period_start_date || !period.period_end_date) {
          console.error(`Invalid dates for company ${period.company_name}: start=${period.period_start_date}, end=${period.period_end_date}`);
          return {
            ...period,
            total_unbilled: 0,
            can_generate: false,
            is_early: false
          };
        }

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
        
        // Convert dates using our utility functions with error handling
        let periodEndDate;
        try {
          periodEndDate = toPlainDate(period.period_end_date);
        } catch (error) {
          console.error(`Error converting period_end_date for company ${period.company_name}:`, error);
          return {
            ...period,
            total_unbilled: 0,
            can_generate: false,
            is_early: false
          };
        }

        const currentPlainDate = toPlainDate(currentDate);
        const is_early = Temporal.PlainDate.compare(periodEndDate, currentPlainDate) > 0;

        return {
          ...period,
          total_unbilled,
          can_generate,
          is_early
        };
      } catch (error) {
        console.error(`Error processing period for company ${period.company_name}:`, error);
        return {
          ...period,
          total_unbilled: 0,
          can_generate: false,
          is_early: false
        };
      }
    }));

    console.log(`Successfully processed ${periodsWithTotals.length} billing periods`);
    return periodsWithTotals;

  } catch (_error) {
    console.error('Error in getAvailableBillingPeriods:', _error);
    throw _error;
  }
}

export async function previewInvoice(billing_cycle_id: string): Promise<PreviewInvoiceResponse> {
  const { knex, tenant } = await createTenantKnex();
  
  // Get billing cycle details
  const billingCycle = await knex('company_billing_cycles')
    .where({ 
      billing_cycle_id,
      tenant 
    })
    .first();

  if (!billingCycle) {
    return {
      success: false,
      error: 'Invalid billing cycle'
    };
  }

  const { company_id, effective_date } = billingCycle;

  // Calculate cycle dates
  const cycleStart = toISODate(toPlainDate(effective_date));
  const cycleEnd = await getNextBillingDate(company_id, effective_date);

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
    const company = await knex('companies')
      .where({ 
        company_id,
        tenant 
      })
      .first();
    const due_date = await getDueDate(company_id, cycleEnd);

    // Group charges by bundle if they have bundle information
    const chargesByBundle: { [key: string]: IBillingCharge[] } = {};
    const nonBundleCharges: IBillingCharge[] = [];

    for (const charge of billingResult.charges) {
      if (charge.company_bundle_id && charge.bundle_name) {
        const bundleKey = `${charge.company_bundle_id}-${charge.bundle_name}`;
        if (!chargesByBundle[bundleKey]) {
          chargesByBundle[bundleKey] = [];
        }
        chargesByBundle[bundleKey].push(charge);
      } else {
        nonBundleCharges.push(charge);
      }
    }

    // Prepare invoice items
    const invoiceItems: IInvoiceItem[] = [];

    // Add non-bundle charges
    nonBundleCharges.forEach(charge => {
      invoiceItems.push({
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
        is_manual: false,
        rate: charge.rate,
      });
    });

    // Add bundle charges
    for (const [bundleKey, charges] of Object.entries(chargesByBundle)) {
      // Extract bundle information from the first charge
      const bundleInfo = bundleKey.split('-');
      const companyBundleId = bundleInfo[0];
      const bundleName = bundleInfo.slice(1).join('-');
      
      // Create a group header for the bundle
      const bundleHeaderId = 'preview-' + uuidv4();
      invoiceItems.push({
        item_id: bundleHeaderId,
        invoice_id: 'preview-' + billing_cycle_id,
        description: `Bundle: ${bundleName}`,
        quantity: 1,
        unit_price: 0, // This is just a header, not a charged item
        total_price: 0,
        net_amount: 0,
        tax_amount: 0,
        tax_rate: 0,
        is_manual: false,
        is_bundle_header: true,
        company_bundle_id: companyBundleId,
        bundle_name: bundleName,
        rate: 0
      });
      
      // Add each charge in the bundle as a child item
      charges.forEach(charge => {
        invoiceItems.push({
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
          is_manual: false,
          company_bundle_id: companyBundleId,
          bundle_name: bundleName,
          parent_item_id: bundleHeaderId,
          rate: charge.rate,
        });
      });
    }

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
      invoice_date: toPlainDate(toISODate(Temporal.Now.plainDateISO())),
      due_date: toPlainDate(due_date),
      status: 'draft',
      subtotal: billingResult.totalAmount,
      tax: await calculatePreviewTax(billingResult.charges, company_id, cycleEnd, company?.tax_region || ''),
      total: billingResult.totalAmount + await calculatePreviewTax(billingResult.charges, company_id, cycleEnd, company?.tax_region || ''),
      total_amount: billingResult.totalAmount + await calculatePreviewTax(billingResult.charges, company_id, cycleEnd, company?.tax_region || ''),
      credit_applied: 0,
      billing_cycle_id,
      is_manual: false,
      invoice_items: invoiceItems
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

export async function generateInvoice(billing_cycle_id: string): Promise<InvoiceViewModel | null> {
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
    .where({
      billing_cycle_id,
      tenant
    })
    .first();

  if (!billingCycle) {
    throw new Error('Billing cycle not found');
  }

  let cycleStart: ISO8601String;
  let cycleEnd: ISO8601String;
  const { company_id, period_start_date, period_end_date, effective_date } = billingCycle;

  if (period_start_date && period_end_date) {
    // Use the billing cycle's period dates if provided, ensuring UTC format
    cycleStart = toISOTimestamp(toPlainDate(period_start_date));
    cycleEnd = toISOTimestamp(toPlainDate(period_end_date));
  } else if (effective_date) {
    // Calculate period dates from effective_date
    // Format effective_date as UTC ISO8601
    const effectiveDateUTC = toISOTimestamp(toPlainDate(effective_date));
    cycleStart = effectiveDateUTC;
    cycleEnd = await getNextBillingDate(company_id, effectiveDateUTC);
  } else {
    throw new Error('Invalid billing cycle dates');
  }

  // Check if an invoice already exists for this billing cycle
  const existingInvoice = await knex('invoices')
    .where({ 
      billing_cycle_id,
      tenant 
    })
    .first();

  if (existingInvoice) {
    throw new Error('No active billing plans for this period');
  }

  const billingEngine = new BillingEngine();
  const billingResult = await billingEngine.calculateBilling(company_id, cycleStart, cycleEnd, billing_cycle_id);

  if (billingResult.error) {
    throw new Error(billingResult.error);
  }

  // Get zero-dollar invoice settings
  const companySettings = await knex('company_billing_settings')
    .where({ company_id: company_id, tenant })
    .first();
  
  const defaultSettings = await knex('default_billing_settings')
    .where({ tenant: tenant })
    .first();
  
  const settings = companySettings || defaultSettings;
  
  if (!settings) {
    throw new Error('No billing settings found');
  }

  // Handle zero-dollar invoices
  if (billingResult.charges.length === 0 && billingResult.finalAmount === 0) {
    if (settings.zero_dollar_invoice_handling === 'suppress') {
      return null;
    }
    
    const createdInvoice = await createInvoiceFromBillingResult(
      billingResult,
      company_id,
      cycleStart,
      cycleEnd,
      billing_cycle_id,
      session.user.id
    );
    
    if (settings.zero_dollar_invoice_handling === 'finalized') {
      await finalizeInvoiceWithKnex(createdInvoice.invoice_id, knex, tenant, session.user.id);
    }
    
    return await Invoice.getFullInvoiceById(createdInvoice.invoice_id);
  }

  if (billingResult.charges.length === 0) {
    throw new Error('Nothing to bill');
  }

  for (const charge of billingResult.charges) {
    if (charge.rate === undefined || charge.rate === null) {
      throw new Error(`Service "${charge.serviceName}" has an undefined rate`);
    }
  }

  const createdInvoice = await createInvoiceFromBillingResult(
    billingResult,
    company_id,
    cycleStart,
    cycleEnd,
    billing_cycle_id,
    session.user.id
  );

  const nextBillingStartDate = await getNextBillingDate(company_id, cycleEnd);
  await billingEngine.rolloverUnapprovedTime(company_id, cycleEnd, nextBillingStartDate);

  return await Invoice.getFullInvoiceById(createdInvoice.invoice_id);
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

async function calculatePreviewTax(
  charges: IBillingCharge[],
  companyId: string,
  cycleEnd: ISO8601String,
  defaultTaxRegion: string
): Promise<number> {
  const taxService = new TaxService();
  let totalTax = 0;

  // Calculate tax only on positive taxable amounts before discounts
  for (const charge of charges) {
    if (charge.is_taxable && charge.total > 0) {
      const taxResult = await taxService.calculateTax(
        companyId,
        charge.total,
        cycleEnd,
        charge.tax_region || defaultTaxRegion,
        true
      );
      totalTax += taxResult.taxAmount;
    }
  }

  return totalTax;
}

async function createInvoice(billingResult: IBillingResult, companyId: string, startDate: ISO8601String, endDate: ISO8601String, billing_cycle_id: string): Promise<IInvoice> {
  const { knex, tenant } = await createTenantKnex();
  const company = await knex('companies')
    .where({ 
      company_id: companyId,
      tenant
    })
    .first() as ICompany;
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

  // Create invoice object
  const invoiceData: Omit<IInvoice, 'invoice_id'> = {
    company_id: companyId,
    invoice_date: toISODate(Temporal.Now.plainDateISO()),
    due_date,
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    status: 'draft',
    invoice_number: '', // Will be set within transaction
    credit_applied: 0,
    billing_cycle_id: billing_cycle_id,
    tenant: tenant,
    is_manual: false
  };

  let newInvoice: IInvoice | null = null;
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      // Generate invoice number
      const invoiceNumber = await generateInvoiceNumber();
      invoiceData.invoice_number = invoiceNumber;

      // Try to insert the invoice
      const [insertedInvoice] = await knex('invoices').insert(invoiceData).returning('*');
      newInvoice = insertedInvoice;
      break;
    } catch (error: unknown) {
      if (error instanceof Error &&
          'code' in error &&
          typeof error.code === 'string' &&
          error.code === '23505' &&
          'constraint' in error &&
          typeof error.constraint === 'string' &&
          error.constraint === 'unique_invoice_number_per_tenant') {
        // Handle uniqueness constraint violation
        retryCount++;
        
        // Get current max invoice number by extracting numeric portion
        const maxInvoiceNumber = await knex('invoices')
          .where({ tenant: invoiceData.tenant })
          .select(knex.raw(`MAX(CAST(SUBSTRING(invoice_number FROM '\\d+$') AS INTEGER)) as max_number`))
          .first();
        
        if (maxInvoiceNumber?.max_number) {
          // Update last_number to be max + 1
          await knex('next_number')
            .where({
              tenant: invoiceData.tenant,
              entity_type: 'INVOICE'
            })
            .update({ last_number: maxInvoiceNumber.max_number });
        }
        
        if (retryCount >= maxRetries) {
          throw new Error('Failed to generate unique invoice number after multiple attempts');
        }
      } else {
        throw error;
      }
    }
  }

  if (!newInvoice) {
    throw new Error('Failed to create invoice');
  }

  await knex.transaction(async (trx) => {
    if (!company.tax_region) {
      throw new Error(`Company ${companyId} must have a tax region configured`);
    }    

    // Get current balance
    const currentBalance = await trx('transactions')
      .where({
        company_id: companyId,
        tenant
      })
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
      description: `Generated invoice ${invoiceData.invoice_number}`,
      created_at: toISODate(Temporal.Now.plainDateISO()),
      balance_after: currentBalance + newInvoice.total_amount,
      tenant: tenant
    });

    // Process each charge and create invoice items
    for (const charge of billingResult.charges) {
      const { netAmount, taxCalculationResult } = await calculateChargeDetails(charge, companyId, endDate, taxService, company.tax_region);

      const invoiceItem = {
        item_id: uuidv4(),
        invoice_id: newInvoice.invoice_id,
        service_id: charge.serviceId,
        description: isBucketCharge(charge) ? `${charge.serviceName} (Overage)` : charge.serviceName,
        quantity: getChargeQuantity(charge),
        unit_price: getChargeUnitPrice(charge),
        net_amount: netAmount,
        tax_amount: taxCalculationResult.taxAmount,
        tax_region: charge.tax_region || company.tax_region,
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
      const taxCalculationResult = await taxService.calculateTax(
        companyId, 
        netAmount, 
        endDate
      );

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
        created_at: toISODate(Temporal.Now.plainDateISO()),
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
        description: `Applied credit to invoice ${invoiceData.invoice_number}`,
        balance_after: currentBalance - creditToApply
      }, trx);

      await CompanyBillingPlan.updateCompanyCredit(companyId, -creditToApply);
    }

    return newInvoice;
  });

  // Get the final invoice with updated totals
  const updatedInvoice = await knex('invoices')
    .where({ invoice_id: newInvoice.invoice_id })
    .first();

  // Create view model with consistent tax calculation
  const viewModel: InvoiceViewModel = {
    invoice_id: newInvoice.invoice_id,
    invoice_number: newInvoice.invoice_number,
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
    invoice_date: toPlainDate(newInvoice.invoice_date),
    due_date: toPlainDate(newInvoice.due_date),
    status: newInvoice.status,
    subtotal: updatedInvoice.subtotal,
    tax: updatedInvoice.tax,
    total: updatedInvoice.total_amount,
    total_amount: updatedInvoice.total_amount,
    invoice_items: await knex('invoice_items')
      .where({
        invoice_id: newInvoice.invoice_id,
        tenant
      }),
    credit_applied: updatedInvoice.credit_applied,
    billing_cycle_id: billing_cycle_id,
    is_manual: false
  };

  return viewModel;
}

  async function calculateChargeDetails(
    charge: IBillingCharge,
    companyId: string,
    endDate: ISO8601String,
    taxService: TaxService,
    defaultTaxRegion: string
  ): Promise<{ netAmount: number; taxCalculationResult: ITaxCalculationResult }> {
    let netAmount: number;

    if ('overageHours' in charge && 'overageRate' in charge) {
      const bucketCharge = charge as IBucketCharge;
      netAmount = bucketCharge.overageHours > 0 ? Math.ceil(bucketCharge.total) : 0;
    } else {
      netAmount = Math.ceil(charge.total);
    }

    // Calculate tax only for taxable items with positive amounts
    const taxCalculationResult = charge.is_taxable !== false && netAmount > 0
      ? await taxService.calculateTax(
          companyId,
          netAmount,
          endDate,
          charge.tax_region || defaultTaxRegion
        )
      : { taxAmount: 0, taxRate: 0 };

    return { netAmount, taxCalculationResult };
  }

export async function generateInvoiceNumber(_trx?: Knex.Transaction): Promise<string> {
  const numberingService = new NumberingService();
  return numberingService.getNextNumber('INVOICE');
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

export async function getDueDate(companyId: string, billingEndDate: ISO8601String): Promise<ISO8601String> {
  const { knex, tenant } = await createTenantKnex();
  const company = await knex('companies')
    .where({ 
      company_id: companyId,
      tenant
    })
    .select('payment_terms')
    .first();

  const paymentTerms = company?.payment_terms || 'net_30';
  const days = getPaymentTermDays(paymentTerms);
  console.log('paymentTerms', paymentTerms, 'days', days);

  // Convert billingEndDate string to a Temporal.PlainDate before adding days
  const plainEndDate = toPlainDate(billingEndDate);
  const dueDate = plainEndDate.add({ days });
  return toISODate(dueDate);
}


/**
 * Gets the next billing date based on the current billing cycle.
 * The returned date serves as both:
 * 1. The exclusive end date for the current period (< this date)
 * 2. The inclusive start date for the next period (>= this date)
 * This ensures continuous coverage with no gaps or overlaps between billing periods.
 */
export async function getNextBillingDate(companyId: string, currentEndDate: ISO8601String): Promise<ISO8601String> {
  const { knex, tenant } = await createTenantKnex();
  const company = await knex('company_billing_cycles')
    .where({ 
      company_id: companyId,
      tenant
    })
    .select('billing_cycle')
    .first();

  const billingCycle = (company?.billing_cycle || 'monthly') as BillingCycleType;
  const currentDate = toPlainDate(currentEndDate);
  let nextDate;

  switch (billingCycle) {
    case 'weekly':
      nextDate = currentDate.add({ days: 7 });
      break;
    case 'bi-weekly':
      nextDate = currentDate.add({ days: 14 });
      break;
    case 'monthly':
      nextDate = currentDate.add({ months: 1 });
      break;
    case 'quarterly':
      nextDate = currentDate.add({ months: 3 });
      break;
    case 'semi-annually':
      nextDate = currentDate.add({ months: 6 });
      break;
    case 'annually':
      nextDate = currentDate.add({ years: 1 });
      break;
    default:
      nextDate = currentDate.add({ months: 1 });
  }

  return nextDate.toString();
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
    invoice_date: typeof invoice.invoice_date === 'string' ? toPlainDate(invoice.invoice_date) : invoice.invoice_date,
    due_date: typeof invoice.due_date === 'string' ? toPlainDate(invoice.due_date) : invoice.due_date,
    status: invoice.status,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total_amount,
    total_amount: invoice.total_amount,
    credit_applied: (invoice.credit_applied || 0),
    is_manual: invoice.is_manual,
    finalized_at: invoice.finalized_at ? (typeof invoice.finalized_at === 'string' ? toPlainDate(invoice.finalized_at) : invoice.finalized_at) : undefined,
    invoice_items: [] // Empty array initially
  };
}

export async function fetchAllInvoices(): Promise<InvoiceViewModel[]> {
  try {
    console.log('Fetching basic invoice info');
    const { knex, tenant } = await createTenantKnex();
    
    // Get invoices with company info in a single query
    const invoices = await knex('invoices')
      .join('companies', function() {
        this.on('invoices.company_id', '=', 'companies.company_id')
            .andOn('invoices.tenant', '=', 'companies.tenant');
      })
      .where('invoices.tenant', tenant)
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
  const { knex, tenant } = await createTenantKnex();
  const template = await knex('invoice_templates')
    .where({ 
      template_id: _templateId,
      tenant
    })
    .first() as IInvoiceTemplate | undefined;

  if (template) {
    template.dsl = template.dsl || '';
    template.parsed = template.dsl ? parseInvoiceTemplate(template.dsl) : null;
  }

  return template || null;
}

export async function getInvoiceTemplates(): Promise<IInvoiceTemplate[]> {
  const templates = await Invoice.getAllTemplates();
  
  return templates.map(template => ({
    ...template,
    parsed: template.dsl ? parseInvoiceTemplate(template.dsl) : null
  }));
}

export async function setDefaultTemplate(templateId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  
  await knex.transaction(async (trx) => {
    // First, unset any existing default template
    await trx('invoice_templates')
      .where({ 
        is_default: true,
        tenant
      })
      .update({ is_default: false });

    // Then set the new default template
    await trx('invoice_templates')
      .where({ 
        template_id: templateId,
        tenant
      })
      .update({ is_default: true });
  });
}

export async function getDefaultTemplate(): Promise<IInvoiceTemplate | null> {
  const { knex, tenant } = await createTenantKnex();
  const template = await knex('invoice_templates')
    .where({ 
      is_default: true,
      tenant
    })
    .first();
  
  if (template) {
    template.parsed = template.dsl ? parseInvoiceTemplate(template.dsl) : null;
  }
  
  return template;
}

export async function setCompanyTemplate(companyId: string, templateId: string | null): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  await knex('companies')
    .where({ 
      company_id: companyId,
      tenant
    })
    .update({ invoice_template_id: templateId });
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
  let invoice: any;
  
  // First transaction to update invoice status
  await knex.transaction(async (trx) => {
    // Check if invoice exists and is not already finalized
    invoice = await trx('invoices')
      .where({ 
        invoice_id: invoiceId,
        tenant
      })
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
        status: 'sent',
        finalized_at: toISODate(Temporal.Now.plainDateISO()),
        updated_at: toISODate(Temporal.Now.plainDateISO())
      });

    // Record audit log
    await auditLog(
      trx,
      {
        userId: userId,
        operation: 'invoice_finalized',
        tableName: 'invoices',
        recordId: invoiceId,
        changedData: { finalized_at: toISODate(Temporal.Now.plainDateISO()) },
        details: {
          action: 'Invoice finalized',
          invoiceNumber: invoice.invoice_number
        }
      }
    );
  });
  
  // Check if this is a prepayment invoice (no billing_cycle_id)
  if (invoice && !invoice.billing_cycle_id) {
    // For prepayment invoices, update the company's credit balance
    await CompanyBillingPlan.updateCompanyCredit(invoice.company_id, invoice.subtotal);
    
    // Log the credit update
    console.log(`Updated credit balance for company ${invoice.company_id} by ${invoice.subtotal} from prepayment invoice ${invoiceId}`);
  }
  // Handle regular invoices with negative totals
  else if (invoice && invoice.total_amount < 0) {
    // Get absolute value of negative total
    const creditAmount = Math.abs(invoice.total_amount);
    
    // Update company credit balance and record transaction in a single transaction
    // We handle this directly without using CompanyBillingPlan.updateCompanyCredit to avoid validation issues
    await knex.transaction(async (trx) => {
      // Get current credit balance
      const company = await trx('companies')
        .where({ company_id: invoice.company_id, tenant })
        .select('credit_balance')
        .first();
      
      if (!company) {
        throw new Error(`Company ${invoice.company_id} not found`);
      }
      
      // Get company's credit expiration settings or default settings
      const companySettings = await trx('company_billing_settings')
        .where({
          company_id: invoice.company_id,
          tenant
        })
        .first();
      
      const defaultSettings = await trx('default_billing_settings')
        .where({ tenant })
        .first();
      
      // Determine expiration days - use company setting if available, otherwise use default
      let expirationDays: number | undefined;
      if (companySettings?.credit_expiration_days !== undefined) {
        expirationDays = companySettings.credit_expiration_days;
      } else if (defaultSettings?.credit_expiration_days !== undefined) {
        expirationDays = defaultSettings.credit_expiration_days;
      }
      
      // Calculate expiration date if applicable
      let expirationDate: string | undefined;
      if (expirationDays && expirationDays > 0) {
        const today = new Date();
        const expDate = new Date(today);
        expDate.setDate(today.getDate() + expirationDays);
        expirationDate = expDate.toISOString();
      }
      
      // Calculate new balance
      const newBalance = (company.credit_balance || 0) + creditAmount;
      
      // Update company credit balance within the transaction
      await trx('companies')
        .where({ company_id: invoice.company_id, tenant })
        .update({
          credit_balance: newBalance,
          updated_at: new Date().toISOString()
        });
      
      // Record transaction with the correct balance and expiration date
      // Skip validation for negative invoices since we're creating credit
      const transactionId = uuidv4();
      await trx('transactions').insert({
        transaction_id: transactionId,
        company_id: invoice.company_id,
        invoice_id: invoiceId,
        amount: creditAmount,
        type: 'credit_issuance_from_negative_invoice',
        status: 'completed',
        description: `Credit issued from negative invoice ${invoice.invoice_number}`,
        created_at: new Date().toISOString(),
        balance_after: newBalance,
        tenant,
        expiration_date: expirationDate
      });
      
      // Create credit tracking entry
      await trx('credit_tracking').insert({
        credit_id: uuidv4(),
        tenant,
        company_id: invoice.company_id,
        transaction_id: transactionId,
        amount: creditAmount,
        remaining_amount: creditAmount, // Initially, remaining amount equals the full amount
        created_at: new Date().toISOString(),
        expiration_date: expirationDate,
        is_expired: false,
        updated_at: new Date().toISOString()
      });
      
      // Log audit
      await auditLog(
        trx,
        {
          userId: userId,
          operation: 'credit_issuance_from_negative_invoice',
          tableName: 'companies',
          recordId: invoice.company_id,
          changedData: {
            credit_balance: newBalance,
            expiration_date: expirationDate
          },
          details: {
            action: 'Credit issued from negative invoice',
            invoiceId: invoiceId,
            amount: creditAmount,
            expiration_date: expirationDate
          }
        }
      );
    });
    
    // Log the credit update
    console.log(`Created credit of ${creditAmount} from negative invoice ${invoiceId} (${invoice.invoice_number})`);
  }
  // For regular invoices, check if there's available credit to apply
  else if (invoice && invoice.company_id) {
    const availableCredit = await CompanyBillingPlan.getCompanyCredit(invoice.company_id);
    
    if (availableCredit > 0) {
      // Get the current invoice with updated totals
      const updatedInvoice = await knex('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .first();
      
      if (updatedInvoice && updatedInvoice.total_amount > 0) {
        // Calculate how much credit to apply
        const creditToApply = Math.min(availableCredit, updatedInvoice.total_amount);
        
        if (creditToApply > 0) {
          // Apply credit to the invoice
          await applyCreditToInvoice(invoice.company_id, invoiceId, creditToApply);
        }
      }
    }
  }
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
      .where({ 
        invoice_id: invoiceId,
        tenant
      })
      .update({
        finalized_at: null,
        updated_at: toISODate(Temporal.Now.plainDateISO())
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
  newItems: IInvoiceItem[];
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

  const currentDate = Temporal.Now.plainDateISO().toString();

  await updateManualInvoiceItems(invoiceId, changes, session, tenant);
  return await Invoice.getFullInvoiceById(invoiceId);
}

export async function addManualItemsToInvoice(
  invoiceId: string,
  items: IInvoiceItem[]
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
    .where({
      invoice_id: invoiceId,
      tenant
    })
    .first();

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new Error('Cannot modify a paid or cancelled invoice');
  }

  const company = await knex('companies')
    .where({
      company_id: invoice.company_id,
      tenant
    })
    .first();

  if (!company) {
    throw new Error('Company not found');
  }

  await addManualInvoiceItems(invoiceId, items, session, tenant);
  return await Invoice.getFullInvoiceById(invoiceId);
}

export async function createInvoiceFromBillingResult(
  billingResult: IBillingResult,
  companyId: string,
  cycleStart: ISO8601String,
  cycleEnd: ISO8601String,
  billing_cycle_id: string,
  userId: string
): Promise<IInvoice> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  const company = await getCompanyDetails(knex, tenant, companyId);
  const currentDate = Temporal.Now.plainDateISO().toString();
  const due_date = await getDueDate(companyId, cycleEnd);
  const taxService = new TaxService();
  let subtotal = 0;

  // Create base invoice object
  const invoiceData = {
    company_id: companyId,
    invoice_date: toISODate(Temporal.PlainDate.from(currentDate)),
    due_date,
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    status: 'draft',
    invoice_number: '',
    credit_applied: 0,
    billing_cycle_id,
    tenant,
    is_manual: false
  };

  let newInvoice: IInvoice | null = null;
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const invoiceNumber = await generateInvoiceNumber();
      invoiceData.invoice_number = invoiceNumber;
      const [insertedInvoice] = await knex('invoices').insert(invoiceData).returning('*');
      newInvoice = insertedInvoice;
      break;
    } catch (error: unknown) {
      if (error instanceof Error &&
          'code' in error &&
          error.code === '23505' &&
          'constraint' in error &&
          error.constraint === 'unique_invoice_number_per_tenant') {
        retryCount++;
        if (retryCount >= maxRetries) {
          throw new Error('Failed to generate unique invoice number after multiple attempts');
        }
      } else {
        throw error;
      }
    }
  }

  if (!newInvoice) {
    throw new Error('Failed to create invoice');
  }

  await knex.transaction(async (trx) => {
    // Group charges by bundle if they have bundle information
    const chargesByBundle: { [key: string]: IBillingCharge[] } = {};
    const nonBundleCharges: IBillingCharge[] = [];

    for (const charge of billingResult.charges) {
      if (charge.company_bundle_id && charge.bundle_name) {
        const bundleKey = `${charge.company_bundle_id}-${charge.bundle_name}`;
        if (!chargesByBundle[bundleKey]) {
          chargesByBundle[bundleKey] = [];
        }
        chargesByBundle[bundleKey].push(charge);
      } else {
        nonBundleCharges.push(charge);
      }
    }

    // Process non-bundle charges
    for (const charge of nonBundleCharges) {
      const { netAmount, taxCalculationResult } = await calculateChargeDetails(
        charge,
        companyId,
        cycleEnd,
        taxService,
        company.tax_region
      );

      const invoiceItem = {
        item_id: uuidv4(),
        invoice_id: newInvoice!.invoice_id,
        service_id: charge.serviceId,
        description: charge.serviceName,
        quantity: getChargeQuantity(charge),
        unit_price: getChargeUnitPrice(charge),
        net_amount: netAmount,
        tax_amount: taxCalculationResult.taxAmount,
        tax_region: charge.tax_region || company.tax_region,
        tax_rate: taxCalculationResult.taxRate,
        total_price: netAmount + taxCalculationResult.taxAmount,
        is_manual: false,
        is_taxable: charge.is_taxable !== false,
        tenant,
        created_by: userId
      };

      await trx('invoice_items').insert(invoiceItem);
      subtotal += netAmount;
    }

    // Process bundle charges
    for (const [bundleKey, charges] of Object.entries(chargesByBundle)) {
      // Extract bundle information from the first charge
      const bundleInfo = bundleKey.split('-');
      const companyBundleId = bundleInfo[0];
      const bundleName = bundleInfo.slice(1).join('-');
      
      // Create a group header for the bundle
      const bundleHeaderId = uuidv4();
      const bundleHeader = {
        item_id: bundleHeaderId,
        invoice_id: newInvoice!.invoice_id,
        description: `Bundle: ${bundleName}`,
        quantity: 1,
        unit_price: 0, // This is just a header, not a charged item
        net_amount: 0,
        tax_amount: 0,
        tax_rate: 0,
        total_price: 0,
        is_manual: false,
        is_bundle_header: true,
        company_bundle_id: companyBundleId,
        bundle_name: bundleName,
        tenant,
        created_by: userId
      };
      
      await trx('invoice_items').insert(bundleHeader);
      
      // Add each charge in the bundle as a child item
      for (const charge of charges) {
        const { netAmount, taxCalculationResult } = await calculateChargeDetails(
          charge,
          companyId,
          cycleEnd,
          taxService,
          company.tax_region
        );

        const invoiceItem = {
          item_id: uuidv4(),
          invoice_id: newInvoice!.invoice_id,
          service_id: charge.serviceId,
          description: charge.serviceName,
          quantity: getChargeQuantity(charge),
          unit_price: getChargeUnitPrice(charge),
          net_amount: netAmount,
          tax_amount: taxCalculationResult.taxAmount,
          tax_region: charge.tax_region || company.tax_region,
          tax_rate: taxCalculationResult.taxRate,
          total_price: netAmount + taxCalculationResult.taxAmount,
          is_manual: false,
          is_taxable: charge.is_taxable !== false,
          company_bundle_id: companyBundleId,
          bundle_name: bundleName,
          parent_item_id: bundleHeaderId,
          tenant,
          created_by: userId
        };

        await trx('invoice_items').insert(invoiceItem);
        subtotal += netAmount;
      }
    }

    // Process discounts
    for (const discount of billingResult.discounts) {
      // Discounts are always non-taxable
      const netAmount = Math.round(-(discount.amount || 0));
      const discountItem = {
        item_id: uuidv4(),
        invoice_id: newInvoice!.invoice_id,
        description: discount.discount_name,
        quantity: 1,
        unit_price: netAmount,
        net_amount: netAmount,
        tax_amount: 0,
        tax_rate: 0,
        total_price: netAmount,
        is_taxable: false,  // Discounts are not taxable
        is_discount: true,  // Flag as a discount item
        is_manual: false,
        tenant,
        created_by: userId
      };

      await trx('invoice_items').insert(discountItem);
      subtotal += netAmount;
    }

    // Calculate tax based on positive taxable amounts before discounts
    let totalTax = 0;
    
    // Get all invoice items
    const items = await trx('invoice_items')
      .where({
        invoice_id: newInvoice!.invoice_id,
        tenant
      })
      .orderBy('net_amount', 'desc');

    // Get positive taxable items
    const positiveTaxableItems = items.filter(item =>
      item.is_taxable && parseInt(item.net_amount) > 0
    );

    // Calculate tax for each item based on its region, ignoring discounts
    if (positiveTaxableItems.length > 0) {
      // Group items by tax region
      const regionTotals = new Map<string, number>();
      for (const item of positiveTaxableItems) {
        const region = item.tax_region || company.tax_region;
        const amount = parseInt(item.net_amount);
        regionTotals.set(region, (regionTotals.get(region) || 0) + amount);
      }

      // Calculate tax for each region on full amounts (no discount factor)
      for (const [region, amount] of regionTotals) {
        const rawTaxResult = await taxService.calculateTax(
          companyId,
          amount,
          cycleEnd,
          region,
          true
        );
        totalTax += rawTaxResult.taxAmount;
      }

      // Distribute tax proportionally among items within each region

      // Group items by region
      const itemsByRegion = new Map<string, typeof positiveTaxableItems>();
      for (const item of positiveTaxableItems) {
        const region = item.tax_region || company.tax_region;
        if (!itemsByRegion.has(region)) {
          itemsByRegion.set(region, []);
        }
        itemsByRegion.get(region)!.push(item);
      }

      // For each region, distribute the calculated tax among items
      for (const [region, items] of itemsByRegion) {
        // Calculate regional total from positive taxable items
        const regionalTotal = items.reduce((sum, item) => sum + parseInt(item.net_amount), 0);
        
        // Get tax rate and amount for this region
        const regionalTaxResult = await taxService.calculateTax(
          companyId,
          regionalTotal,  // Use full amount before discounts
          cycleEnd,
          region,
          true
        );

        // Distribute full tax amount proportionally
        let remainingRegionalTax = regionalTaxResult.taxAmount;  // Use full tax amount
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const isLastItem = i === items.length - 1;
          const itemTax = isLastItem
            ? remainingRegionalTax
            : Math.floor((parseInt(item.net_amount) / regionalTotal) * regionalTaxResult.taxAmount);

          remainingRegionalTax -= itemTax;

          await trx('invoice_items')
            .where({ item_id: item.item_id })
            .update({
              tax_amount: itemTax,
              tax_rate: regionalTaxResult.taxRate,
              total_price: parseInt(item.net_amount) + itemTax
            });
        }
      }

      // Ensure all other items have zero tax
      await trx('invoice_items')
        .where({ invoice_id: newInvoice!.invoice_id, tenant })
        .whereNotIn('item_id', positiveTaxableItems.map(item => item.item_id))
        .update({
          tax_amount: 0,
          tax_rate: 0,
          total_price: trx.raw('net_amount')
        });
    }

    // Calculate final amounts
    const totalAmount = subtotal + totalTax;
    const availableCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    const creditToApply = Math.min(availableCredit, Math.ceil(totalAmount));

    // Update invoice with final totals, ensuring tax is properly stored
    const finalTax = Math.ceil(totalTax);
    const finalSubtotal = Math.ceil(subtotal);
    
    // Update the invoice with subtotal, tax, and total amount
    await trx('invoices')
      .where({ invoice_id: newInvoice!.invoice_id })
      .update({
        subtotal: finalSubtotal,
        tax: finalTax,
        total_amount: Math.ceil(finalSubtotal + finalTax),
        credit_applied: 0
      });

    await updateInvoiceTotalsAndRecordTransaction(
      trx,
      newInvoice!.invoice_id,
      company,
      finalSubtotal,
      finalTax,
      tenant,
      invoiceData.invoice_number
    );
  });

  return newInvoice;
}

export async function updateManualInvoiceItems(
  invoiceId: string,
  changes: ManualItemsUpdate,
  session: Session,
  tenant: string
): Promise<void> {
  const { knex } = await createTenantKnex();
  const billingEngine = new BillingEngine();
  const currentDate = Temporal.Now.plainDateISO().toString();

  const invoice = await knex('invoices')
    .where({ invoice_id: invoiceId, tenant })
    .first();

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new Error('Cannot modify a paid or cancelled invoice');
  }

  const company = await knex('companies')
    .where({ company_id: invoice.company_id, tenant })
    .first();

  if (!company) {
    throw new Error('Company not found');
  }

  await knex.transaction(async (trx) => {
    await trx('invoice_items')
      .where({
        invoice_id: invoiceId,
        is_manual: true,
        tenant
      })
      .delete();

    for (const item of changes.newItems) {
      // Persist manual items with proper tax handling
      await persistInvoiceItems(
        trx,
        invoiceId,
        [{
          ...item,
          service_id: item.service_id || '',
          is_taxable: item.is_taxable !== false, // Default to taxable unless explicitly false
          tax_region: item.tax_region || company.tax_region // Use company tax region as fallback
        }],
        company,
        session,
        tenant,
        true
      );
    }

    try {
      await trx('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .update({
          invoice_number: changes.invoice_number || invoice.invoice_number,
          updated_at: currentDate
        });
    } catch (error: unknown) {
      if (error instanceof Error &&
          'code' in error &&
          error.code === '23505' &&
          'constraint' in error &&
          error.constraint === 'unique_invoice_number_per_tenant') {
        throw new Error('Invoice number must be unique');
      }
      throw error;
    }
  });

  await billingEngine.recalculateInvoice(invoiceId);
}

export async function addManualInvoiceItems(
  invoiceId: string,
  items: IInvoiceItem[],
  session: Session,
  tenant: string
): Promise<void> {
  const { knex } = await createTenantKnex();
  
  const invoice = await knex('invoices')
    .where({ invoice_id: invoiceId, tenant })
    .first();

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new Error('Cannot modify a paid or cancelled invoice');
  }

  const company = await knex('companies')
    .where({ company_id: invoice.company_id, tenant })
    .first();

  if (!company) {
    throw new Error('Company not found');
  }

  await knex.transaction(async (trx) => {
    // Persist manual items with proper tax handling
    await persistInvoiceItems(
      trx,
      invoiceId,
      items.map(item => ({
        ...item,
        service_id: item.service_id || '',
        is_taxable: item.is_taxable !== false,  // Default to taxable unless explicitly false
        tax_region: item.tax_region || company.tax_region  // Use company tax region as fallback
      })),
      company,
      session,
      tenant,
      true
    );
  });

  const billingEngine = new BillingEngine();
  await billingEngine.recalculateInvoice(invoiceId);
}

export async function hardDeleteInvoice(invoiceId: string) {
  const { knex, tenant } = await createTenantKnex();
  
  await knex.transaction(async (trx) => {
    // 1. Get invoice details
    const invoice = await trx('invoices')
      .where({ 
        invoice_id: invoiceId,
        tenant
      })
      .first();
      
    // 2. Handle payments
    const payments = await trx('transactions')
      .where({ 
        invoice_id: invoiceId, 
        type: 'payment',
        tenant
      });
      
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
        description: `Credit reissued from deleted invoice ${invoiceId}`,
        tenant
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
          .where({ 
            invoice_id: invoiceId,
            tenant
          })
      )
      .update({ invoiced: false });
      
    // 5. Unmark usage records
    await trx('usage_tracking')
      .whereIn('usage_id',
        trx('invoice_usage_records')
          .select('usage_id')
          .where({ 
        invoice_id: invoiceId,
        tenant
      })
      )
      .update({ invoiced: false });
      
    // 6. Delete transactions
    await trx('transactions')
      .where({ 
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    // 7. Delete join records
    await trx('invoice_time_entries')
      .where({ 
        invoice_id: invoiceId,
        tenant
      })
      .delete();
      
    await trx('invoice_usage_records')
      .where({ 
        invoice_id: invoiceId,
        tenant
      })
      .delete();
      
    // 8. Delete invoice items
    await trx('invoice_items')
      .where({ 
        invoice_id: invoiceId,
        tenant
      })
      .delete();
      
    // 9. Delete invoice record
    await trx('invoices')
      .where({ 
        invoice_id: invoiceId,
        tenant
      })
      .delete();
  });
}
