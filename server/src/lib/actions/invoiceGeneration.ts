'use server'

import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { NumberingService } from 'server/src/lib/services/numberingService';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { Session } from 'next-auth';
import {
  IInvoiceItem,
  IInvoice,
  PreviewInvoiceResponse,
  InvoiceViewModel
} from 'server/src/interfaces/invoice.interfaces';
import { WasmInvoiceViewModel } from '../invoice-renderer/types';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import Invoice from 'server/src/lib/models/invoice';
import { createTenantKnex } from 'server/src/lib/db';
import { Temporal } from '@js-temporal/polyfill';
import { PDFGenerationService, createPDFGenerationService } from 'server/src/services/pdf-generation.service';
import { toPlainDate, toISODate, toISOTimestamp } from 'server/src/lib/utils/dateTimeUtils';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { ISO8601String } from 'server/src/types/types.d';
import { TaxService } from 'server/src/lib/services/taxService';
import { ITaxCalculationResult } from 'server/src/interfaces/tax.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { auditLog } from 'server/src/lib/logging/auditLog';
import { getCompanyLogoUrl } from '../utils/avatarUtils';
import { getCompanyDetails, persistInvoiceItems, updateInvoiceTotalsAndRecordTransaction } from 'server/src/lib/services/invoiceService';
// TODO: Import these from billingAndTax.ts once created
import { getNextBillingDate, getDueDate } from './billingAndTax'; // Updated import
import { getCompanyDefaultTaxRegionCode } from './company-actions/companyTaxRateActions';
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
  // Sum the pre-calculated tax amounts from the BillingEngine charges
  // BillingEngine already handles multi-region tax allocation for fixed fees
  // and calculates tax for other charge types.
  let totalTax = 0;
  for (const charge of charges) {
    // Add the tax_amount if it exists and is greater than 0
    if (charge.tax_amount && charge.tax_amount > 0) {
      totalTax += charge.tax_amount;
    }
  }
  console.log(`[calculatePreviewTax] Summed pre-calculated tax: ${totalTax}`);

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

  let taxCalculationResult: ITaxCalculationResult;

  // Check if it's a fixed price charge with pre-calculated tax
  if (isFixedPriceCharge(charge) && charge.tax_amount !== undefined && charge.tax_rate !== undefined) {
    // Use the pre-calculated tax from BillingEngine for fixed fee charges
    taxCalculationResult = {
      taxAmount: charge.tax_amount,
      taxRate: charge.tax_rate,
    };
  } else {
    // Otherwise, calculate tax (for time, usage, etc., or if fixed fee somehow missed pre-calc)
    taxCalculationResult = charge.is_taxable !== false && netAmount > 0
      ? await taxService.calculateTax(
        companyId,
        netAmount,
        endDate,
        charge.tax_region || defaultTaxRegion
      )
      : { taxAmount: 0, taxRate: 0 };
  }
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

// Adapter function to convert data to WasmInvoiceViewModel
async function adaptToWasmViewModel(
  billingResult: IBillingResult,
  company: ICompany | null,
  invoiceItems: IInvoiceItem[],
  dueDate: string,
  previewTax: number,
  tenant: string | null // Added tenant for fetching tenant company info
): Promise<WasmInvoiceViewModel> {
  // Fetch Tenant Company Info (similar logic to getFullInvoiceById)
  let tenantCompanyInfo = null;
  if (tenant) {
    const { knex } = await createTenantKnex(); // Get knex instance again if needed
    const tenantCompanyLink = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('tenant_companies')
        .where({ tenant: tenant, is_default: true })
        .select('company_id')
        .first();
    });

    if (tenantCompanyLink) {
      const tenantCompanyDetails = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('companies')
          .where({ company_id: tenantCompanyLink.company_id })
          .select('company_name', 'address')
          .first();
      });

      if (tenantCompanyDetails) {
        // Assuming getCompanyLogoUrl is accessible or import it
        // import { getCompanyLogoUrl } from '../utils/avatarUtils';
        const logoUrl = await getCompanyLogoUrl(tenantCompanyLink.company_id, tenant);
        tenantCompanyInfo = {
          name: tenantCompanyDetails.company_name,
          address: tenantCompanyDetails.address,
          logoUrl: logoUrl || null, // Use null if logoUrl is empty/null
        };
      }
    }
  }


  const previewViewModelItems = invoiceItems.map(item => ({
    id: item.item_id,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    total: item.total_price
  }));

  return {
    invoiceNumber: 'PREVIEW',
    issueDate: toISODate(Temporal.Now.plainDateISO()),
    dueDate: dueDate,
    customer: {
      name: company?.company_name || 'N/A',
      address: company?.address || 'N/A',
    },
    tenantCompany: tenantCompanyInfo, // Use fetched tenant company info
    items: previewViewModelItems,
    subtotal: billingResult.totalAmount,
    tax: previewTax,
    total: billingResult.totalAmount + previewTax,
    // notes: undefined, // Add if needed
  };
}


export async function previewInvoice(billing_cycle_id: string): Promise<PreviewInvoiceResponse> {
  const { knex, tenant } = await createTenantKnex();

  // Get billing cycle details
  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('company_billing_cycles')
      .where({
        billing_cycle_id,
        tenant
      })
      .first();
  });

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

    // Add this check first: If the billing engine returned a specific error, return it.
    if (billingResult.error) {
      return { success: false, error: billingResult.error };
    }

    // Then, check if there are no charges (and no specific error).
    if (billingResult.charges.length === 0) {
      return {
        success: false,
        error: 'Nothing to bill'
      };
    }

    // Create invoice view model without persisting
    const company = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('companies')
        .where({
          company_id,
          tenant
        })
        .first();
    });
    const due_date = await getDueDate(company_id, cycleEnd); // Uses temporary import

    // Group charges by bundle if they have bundle information
    const chargesByBundle: { [key: string]: IBillingCharge[] } = {};
    const nonBundleCharges: IBillingCharge[] = [];

    for (const charge of billingResult.charges) {
      if (charge.company_bundle_id && charge.bundle_name) {
        // Use only the bundle_name as the key to avoid including the ID in the description
        const bundleKey = charge.bundle_name;
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
      // Get the bundle name and company_bundle_id from the first charge
      const bundleName = bundleKey; // Now bundleKey is just the bundle_name
      const companyBundleId = charges[0].company_bundle_id; // Get company_bundle_id from the first charge

      // Create a group header for the bundle
      const bundleHeaderId = 'preview-' + uuidv4();
      invoiceItems.push({
        item_id: bundleHeaderId,
        invoice_id: 'preview-' + billing_cycle_id,
        description: `Bundle: ${bundleName}`, // Use only the bundle name, not the ID
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

    // Calculate tax and total for the preview
    const previewTax = await calculatePreviewTax(billingResult.charges, company_id, cycleEnd, company?.tax_region || '');
    const previewTotal = billingResult.totalAmount + previewTax;

    // Map IInvoiceItem[] to the structure expected by InvoiceViewModel.items
    const previewViewModelItems = invoiceItems.map(item => ({
      id: item.item_id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unit_price, // Assuming unit_price is correct here
      total: item.total_price // Assuming total_price is correct here (net + tax?) - might need adjustment based on ViewModel definition
    }));

    // Use the adapter function to create the WasmInvoiceViewModel
    const previewData = await adaptToWasmViewModel(
      billingResult,
      company,
      invoiceItems,
      due_date,
      previewTax,
      tenant // Pass tenant to adapter
    );

    return {
      success: true,
      data: previewData
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'An error occurred while previewing the invoice'
    };
  }
}

// Update return type to the interface InvoiceViewModel
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

  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('company_billing_cycles')
      .where({
        billing_cycle_id,
        tenant
      })
      .first();
  });

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
  const existingInvoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('invoices')
      .where({
        billing_cycle_id,
        tenant
      })
      .first();
  });

  if (existingInvoice) {
    throw new Error('No active billing plans for this period');
  }

  const billingEngine = new BillingEngine();
  const billingResult = await billingEngine.calculateBilling(company_id, cycleStart, cycleEnd, billing_cycle_id);

  if (billingResult.error) {
    throw new Error(billingResult.error);
  }

  // Get zero-dollar invoice settings
  const companySettings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('company_billing_settings')
      .where({ company_id: company_id, tenant })
      .first();
  });

  const defaultSettings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('default_billing_settings')
      .where({ tenant: tenant })
      .first();
  });

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

console.log(`[generateInvoice] Zero-dollar invoice created (${createdInvoice.invoice_id}). Fetching full ViewModel before returning.`);
    return await Invoice.getFullInvoiceById(knex, createdInvoice.invoice_id);
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

console.log(`[generateInvoice] Regular invoice created (${createdInvoice.invoice_id}). Fetching full ViewModel before returning.`);
  return await Invoice.getFullInvoiceById(knex, createdInvoice.invoice_id);
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

  // Get the current user session
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Use the factory function to create the PDF generation service
  const pdfGenerationService = createPDFGenerationService(tenant);

  const fileRecord = await pdfGenerationService.generateAndStore({
    invoiceId,
    userId: session.user.id
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
  let region_code = await getCompanyDefaultTaxRegionCode(companyId);
  
  // --- Add Check for Company Default Tax Region ---
  if (!region_code) {
    console.error(`[createInvoiceFromBillingResult] Cannot create invoice for company ${companyId} (${company.company_name}) because it lacks a default tax region (region_code).`);
    throw new Error(`Company '${company.company_name}' does not have a default tax region configured. Please set one before generating invoices.`);
  }
  // --- End Check ---
  const currentDate = Temporal.Now.plainDateISO().toString();
  const due_date = await getDueDate(companyId, cycleEnd); // Uses temporary import
  const taxService = new TaxService();
  // let subtotal = 0; // Subtotal will be calculated by persistInvoiceItems

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
    is_manual: false,
    // Add billing period dates to ensure validation works correctly
    billing_period_start: toPlainDate(cycleStart),
    billing_period_end: toPlainDate(cycleEnd)
  };

  let newInvoice: IInvoice | null = null;
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const invoiceNumber = await generateInvoiceNumber(); // Uses local function
      invoiceData.invoice_number = invoiceNumber;
      const [insertedInvoice] = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('invoices').insert(invoiceData).returning('*');
      });
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

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get session within transaction context if needed by persistInvoiceItems
    const session = await getServerSession(options);
    if (!session?.user?.id) {
      throw new Error('Unauthorized within transaction');
    }

    // Persist all items (including fixed details) using the dedicated service function
    const calculatedSubtotal = await persistInvoiceItems(
      trx,
      newInvoice!.invoice_id,
      billingResult.charges,
      company,
      session, // Pass session
      tenant
    );

    // Process discounts (if any) - This might need adjustment if persistInvoiceItems handles them
    // For now, assume discounts are separate and need processing here.
    let discountSubtotalAdjustment = 0;
    for (const discount of billingResult.discounts) {
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
        is_taxable: false,
        is_discount: true,
        is_manual: false,
        tenant,
        created_by: userId
      };
      await trx('invoice_items').insert(discountItem);
      discountSubtotalAdjustment += netAmount; // Add negative amount
    }

    // Use the subtotal returned by persistInvoiceItems + discount adjustment
    const subtotal = calculatedSubtotal + discountSubtotalAdjustment;

    // Calculate tax, respecting pre-calculated fixed fee tax
    let totalTax = 0;
    let precalculatedFixedFeeTax = 0;

    // Get all invoice items
    const items = await trx('invoice_items')
      .where({
        invoice_id: newInvoice!.invoice_id,
        tenant
      })
      .orderBy('net_amount', 'desc');

    // Separate the consolidated fixed fee item (no service_id) if it exists and has tax
    const consolidatedFixedFeeItem = items.find((item: IInvoiceItem) =>
      item.service_id === null && // Consolidated fixed fee charges have null service_id
      item.is_taxable &&
      item.tax_amount > 0 // Check if it has pre-calculated tax
    );

    if (consolidatedFixedFeeItem) {
      precalculatedFixedFeeTax = parseInt(consolidatedFixedFeeItem.tax_amount);
      console.log(`Found pre-calculated fixed fee tax: ${precalculatedFixedFeeTax}`);
    }

    // Get other positive taxable items (excluding the consolidated fixed fee one)
    const otherPositiveTaxableItems = items.filter((item: IInvoiceItem) =>
      item.item_id !== consolidatedFixedFeeItem?.item_id && // Exclude the fixed fee item
      item.is_taxable &&
      item.net_amount > 0
    );

    // Calculate tax for each item based on its region, ignoring discounts
    // Calculate tax for other items if any exist
    let recalculatedTaxForOtherItems = 0;
    if (otherPositiveTaxableItems.length > 0) {
      // Group items by tax region
      const regionTotals = new Map<string, number>();
      // Group OTHER items by tax region
      for (const item of otherPositiveTaxableItems) {
        const region = item.tax_region || company.tax_region; // Use item's region or company default
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
        recalculatedTaxForOtherItems += rawTaxResult.taxAmount; // Accumulate tax for non-fixed items
      }

      // Distribute tax proportionally among items within each region

      // Group items by region
      // Group OTHER items by region for distribution
      const itemsByRegion = new Map<string, typeof otherPositiveTaxableItems>();
      for (const item of otherPositiveTaxableItems) {
        const region = item.tax_region || company.tax_region;
        if (!itemsByRegion.has(region)) {
          itemsByRegion.set(region, []);
        }
        itemsByRegion.get(region)!.push(item);
      }

      // For each region, distribute the calculated tax among items
      for (const [region, items] of itemsByRegion) {
        // Calculate regional total from positive taxable items
        // Calculate regional total from OTHER positive taxable items
        const regionalTotal = items.reduce((sum: number, item: IInvoiceItem) => sum + item.net_amount, 0);

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
      // Ensure all other items (non-taxable or discounts), EXCLUDING the fixed fee item, have zero tax
      const itemsToZeroOut = items.filter((item: IInvoiceItem) =>
        item.item_id !== consolidatedFixedFeeItem?.item_id && // Exclude fixed fee
        !otherPositiveTaxableItems.find((taxable: IInvoiceItem) => taxable.item_id === item.item_id) // Exclude already processed taxable items
      ).map((item: IInvoiceItem) => item.item_id);

      if (itemsToZeroOut.length > 0) {
        await trx('invoice_items')
          .where({ invoice_id: newInvoice!.invoice_id, tenant })
          .whereIn('item_id', itemsToZeroOut)
          .update({
            tax_amount: 0,
            tax_rate: 0,
            total_price: trx.raw('net_amount')
          });
      }
    }

    // Calculate final amounts
    // Final total tax is the sum of pre-calculated and recalculated tax
    totalTax = precalculatedFixedFeeTax + recalculatedTaxForOtherItems;
    console.log(`Final total tax: ${totalTax} (Precalculated: ${precalculatedFixedFeeTax}, Recalculated: ${recalculatedTaxForOtherItems})`);

    // Final total tax is the sum of pre-calculated and recalculated tax
    totalTax = precalculatedFixedFeeTax + recalculatedTaxForOtherItems;
    console.log(`[createInvoiceFromBillingResult] Final total tax: ${totalTax} (Precalculated: ${precalculatedFixedFeeTax}, Recalculated: ${recalculatedTaxForOtherItems})`);

    // Use the subtotal calculated above
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

    // Corrected call signature: removed finalSubtotal and finalTax as they are recalculated internally
    await updateInvoiceTotalsAndRecordTransaction(
      trx,
      newInvoice!.invoice_id,
      company,
      tenant,
      invoiceData.invoice_number
      // expirationDate is optional and not needed here
    );
  });

  return newInvoice;
}