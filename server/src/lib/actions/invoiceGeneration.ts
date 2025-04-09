'use server'

import { NumberingService } from 'server/src/lib/services/numberingService';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { Knex } from 'knex';
import { Session } from 'next-auth';
import {
  InvoiceViewModel,
  IInvoiceItem,
  IInvoice,
  PreviewInvoiceResponse
} from 'server/src/interfaces/invoice.interfaces';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import Invoice from 'server/src/lib/models/invoice';
import { createTenantKnex } from 'server/src/lib/db';
import { Temporal } from '@js-temporal/polyfill';
import { PDFGenerationService } from 'server/src/services/pdf-generation.service';
import { toPlainDate, toISODate, toISOTimestamp } from 'server/src/lib/utils/dateTimeUtils';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { ISO8601String } from 'server/src/types/types.d';
import { TaxService } from 'server/src/lib/services/taxService';
import { ITaxCalculationResult } from 'server/src/interfaces/tax.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { auditLog } from 'server/src/lib/logging/auditLog';
import { getCompanyDetails, persistInvoiceItems, updateInvoiceTotalsAndRecordTransaction } from 'server/src/lib/services/invoiceService';
// TODO: Import these from billingAndTax.ts once created
import { getNextBillingDate, getDueDate } from './billingAndTax'; // Updated import
// TODO: Move these type guards to billingAndTax.ts or a shared utility file
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

// TODO: Move to billingAndTax.ts or a shared utility file
// Uses local type guards now
function getChargeQuantity(charge: IBillingCharge): number {
  if (isBucketCharge(charge)) return charge.overageHours;
  if (isFixedPriceCharge(charge) || isUsageBasedCharge(charge)) return charge.quantity;
  if (isTimeBasedCharge(charge)) return charge.duration;
  return 1;
}

// TODO: Move to billingAndTax.ts or a shared utility file
// Uses local type guards now
function getChargeUnitPrice(charge: IBillingCharge): number {
  if (isBucketCharge(charge)) return charge.overageRate;
  return charge.rate;
}

// TODO: Move to billingAndTax.ts
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

// TODO: Move to billingAndTax.ts
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

// TODO: Move to billingAndTax.ts
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
  const cycleEnd = await getNextBillingDate(company_id, effective_date); // Uses temporary import

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
    const due_date = await getDueDate(company_id, cycleEnd); // Uses temporary import

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
        quantity: getChargeQuantity(charge), // Uses local helper
        unit_price: getChargeUnitPrice(charge), // Uses local helper
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
          quantity: getChargeQuantity(charge), // Uses local helper
          unit_price: getChargeUnitPrice(charge), // Uses local helper
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
      invoice_date: toISODate(Temporal.Now.plainDateISO()), // Keep as ISO string
      due_date: due_date, // Keep as ISO string (already fetched as ISO)
      status: 'draft',
      subtotal: billingResult.totalAmount,
      tax: await calculatePreviewTax(billingResult.charges, company_id, cycleEnd, company?.tax_region || ''), // Uses local helper
      total: billingResult.totalAmount + await calculatePreviewTax(billingResult.charges, company_id, cycleEnd, company?.tax_region || ''), // Uses local helper
      total_amount: billingResult.totalAmount + await calculatePreviewTax(billingResult.charges, company_id, cycleEnd, company?.tax_region || ''), // Uses local helper
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
    cycleEnd = await getNextBillingDate(company_id, effectiveDateUTC); // Uses temporary import
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

    const createdInvoice = await createInvoiceFromBillingResult( // Uses local function
      billingResult,
      company_id,
      cycleStart,
      cycleEnd,
      billing_cycle_id,
      session.user.id
    );

    if (settings.zero_dollar_invoice_handling === 'finalized') {
      // TODO: Import finalizeInvoiceWithKnex from invoiceModification.ts once created
      // await finalizeInvoiceWithKnex(createdInvoice.invoice_id, knex, tenant, session.user.id);
      console.warn('finalizeInvoiceWithKnex needs to be imported and called here for zero-dollar finalized invoices.');
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

  const createdInvoice = await createInvoiceFromBillingResult( // Uses local function
    billingResult,
    company_id,
    cycleStart,
    cycleEnd,
    billing_cycle_id,
    session.user.id
  );

  // Get the next billing date as a PlainDate string (YYYY-MM-DD)
  const nextBillingDateStr = await getNextBillingDate(company_id, cycleEnd); // Uses temporary import
  
  // Convert the PlainDate string to a proper ISO 8601 timestamp for rolloverUnapprovedTime
  const nextBillingDate = toPlainDate(nextBillingDateStr);
  const nextBillingTimestamp = toISOTimestamp(nextBillingDate);
  
  // Pass the ISO timestamp to rolloverUnapprovedTime
  await billingEngine.rolloverUnapprovedTime(company_id, cycleEnd, nextBillingTimestamp);

  return await Invoice.getFullInvoiceById(createdInvoice.invoice_id);
}

export async function generateInvoiceNumber(_trx?: Knex.Transaction): Promise<string> {
  const numberingService = new NumberingService();
  return numberingService.getNextNumber('INVOICE');
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
  const due_date = await getDueDate(companyId, cycleEnd); // Uses temporary import
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
      const invoiceNumber = await generateInvoiceNumber(); // Uses local function
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
      const { netAmount, taxCalculationResult } = await calculateChargeDetails( // Uses local helper
        charge,
        companyId,
        cycleEnd,
        taxService,
        company.tax_region
      );

      const invoiceItem: any = { // Use 'any' temporarily to allow conditional property
        item_id: uuidv4(),
        invoice_id: newInvoice!.invoice_id,
        service_id: charge.serviceId,
        description: charge.serviceName,
        quantity: getChargeQuantity(charge), // Uses local helper
        unit_price: getChargeUnitPrice(charge), // Uses local helper
        net_amount: netAmount,
        tax_amount: taxCalculationResult.taxAmount,
        tax_region: charge.tax_region || company.tax_region,
        tax_rate: taxCalculationResult.taxRate,
        total_price: netAmount + taxCalculationResult.taxAmount,
        is_manual: false,
        is_taxable: charge.is_taxable !== false,
        tenant,
        created_by: userId,
      };
      // Add company_billing_plan_id if it exists on the charge
      if (charge.company_billing_plan_id) {
        invoiceItem.company_billing_plan_id = charge.company_billing_plan_id;
      }

      await trx('invoice_items').insert(invoiceItem);
      subtotal += netAmount;
    }

    // Process bundle charges
    for (const [bundleKey, charges] of Object.entries(chargesByBundle)) {
      // Extract bundle information from the first charge
      const bundleInfo = bundleKey.split('-');
      const companyBundleId = bundleInfo[0];
      const bundleName = bundleInfo.slice(1).join('-');

      // REMOVED: Bundle header insertion - these columns don't exist
      // The grouping logic should happen during invoice rendering/retrieval
      // based on the company_billing_plan_id relationship.

      // Add each charge in the bundle as a child item
      for (const charge of charges) {
        const { netAmount, taxCalculationResult } = await calculateChargeDetails( // Uses local helper
          charge,
          companyId,
          cycleEnd,
          taxService,
          company.tax_region
        );

        const invoiceItem: any = { // Use 'any' temporarily to allow conditional property
          item_id: uuidv4(),
          invoice_id: newInvoice!.invoice_id,
          service_id: charge.serviceId,
          description: charge.serviceName,
          quantity: getChargeQuantity(charge), // Uses local helper
          unit_price: getChargeUnitPrice(charge), // Uses local helper
          net_amount: netAmount,
          tax_amount: taxCalculationResult.taxAmount,
          tax_region: charge.tax_region || company.tax_region,
          tax_rate: taxCalculationResult.taxRate,
          total_price: netAmount + taxCalculationResult.taxAmount,
          is_manual: false,
          is_taxable: charge.is_taxable !== false,
          // REMOVED: company_bundle_id: companyBundleId, // Column does not exist
          // REMOVED: bundle_name: bundleName, // Column does not exist
          // REMOVED: parent_item_id: bundleHeaderId, // Header row removed
          tenant,
          created_by: userId,
        };
        // Add company_billing_plan_id if it exists on the charge
        if (charge.company_billing_plan_id) {
          invoiceItem.company_billing_plan_id = charge.company_billing_plan_id;
        }

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