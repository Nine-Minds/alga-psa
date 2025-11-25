'use server'

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { NumberingService } from 'server/src/lib/services/numberingService';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import ClientContractLine from 'server/src/lib/models/clientContractLine';
import { Session } from 'next-auth';
import {
  IInvoiceCharge,
  IInvoice,
  PreviewInvoiceResponse,
  InvoiceViewModel
} from 'server/src/interfaces/invoice.interfaces';
import { WasmInvoiceViewModel } from '../invoice-renderer/types';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import { IClient, IClientWithLocation } from 'server/src/interfaces/client.interfaces';
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
import { getClientLogoUrl } from '../utils/avatarUtils';
import { calculateAndDistributeTax, getClientDetails, persistInvoiceCharges, updateInvoiceTotalsAndRecordTransaction } from 'server/src/lib/services/invoiceService';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { analytics } from '../analytics/posthog';
import { AnalyticsEvents } from '../analytics/events';
// TODO: Import these from billingAndTax.ts once created
import { getNextBillingDate, getDueDate } from './billingAndTax'; // Updated import
import { getClientDefaultTaxRegionCode } from './client-actions/clientTaxRateActions';
import { applyCreditToInvoice } from 'server/src/lib/actions/creditActions';
import { getInitialInvoiceTaxSource, shouldUseTaxDelegation } from 'server/src/lib/actions/taxSourceActions';
// TODO: Move these type guards to billingAndTax.ts or a shared utility file
const POSTGRES_UNDEFINED_TABLE = '42P01';

function isMissingRelationError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === POSTGRES_UNDEFINED_TABLE
  );
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
  clientId: string,
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
  clientId: string,
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
        clientId,
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
  client: IClientWithLocation | null,
  invoiceItems: IInvoiceCharge[],
  dueDate: string,
  previewTax: number,
  tenant: string | null // Added tenant for fetching tenant client info
): Promise<WasmInvoiceViewModel> {
  // Fetch Tenant Client Info (similar logic to getFullInvoiceById)
  let tenantClientInfo: { name: any; address: any; logoUrl: string | null } | null = null;
  if (tenant) {
    const { knex } = await createTenantKnex(); // Get knex instance again if needed
    const tenantClientLink = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('tenant_companies')
        .where({ tenant: tenant, is_default: true })
        .select('client_id')
        .first();
    });

    if (tenantClientLink) {
      const tenantClientDetails = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('clients as c')
          .leftJoin('client_locations as cl', function() {
            this.on('c.client_id', '=', 'cl.client_id')
                .andOn('c.tenant', '=', 'cl.tenant')
                .andOn('cl.is_default', '=', trx.raw('true'));
          })
          .select(
            'c.client_name',
            'cl.address_line1 as address'
          )
          .where({
            'c.client_id': tenantClientLink.client_id,
            'c.tenant': tenant
          })
          .first();
      });

      if (tenantClientDetails) {
        // Assuming getClientLogoUrl is accessible or import it
        // import { getClientLogoUrl } from '../utils/avatarUtils';
        const logoUrl = await getClientLogoUrl(tenantClientLink.client_id, tenant);
        tenantClientInfo = {
          name: tenantClientDetails.client_name,
          address: tenantClientDetails.address || 'N/A',
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
      name: client?.client_name || 'N/A',
      address: client?.location_address || 'N/A',
    },
    tenantClient: tenantClientInfo, // Use fetched tenant client info
    items: previewViewModelItems,
    subtotal: billingResult.totalAmount,
    tax: previewTax,
    total: billingResult.totalAmount + previewTax,
    // notes: undefined, // Add if needed
  };
}


export async function previewInvoice(billing_cycle_id: string): Promise<PreviewInvoiceResponse> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return {
      success: false,
      error: 'Unauthorized: No authenticated user found'
    };
  }

  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    return {
      success: false,
      error: 'No tenant found'
    };
  }

  try {
    // Get billing cycle details
    const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Check permissions within transaction
      if (!await hasPermission(currentUser, 'invoice', 'create', trx) && !await hasPermission(currentUser, 'invoice', 'generate', trx)) {
        throw new Error('Permission denied: Cannot preview invoices');
      }

      return await trx('client_billing_cycles')
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

    const { client_id, effective_date } = billingCycle;

    // Calculate cycle dates
    const cycleStart = toISODate(toPlainDate(effective_date));
    const cycleEnd = await getNextBillingDate(client_id, effective_date); // Uses temporary import

    const billingEngine = new BillingEngine();
    const billingResult = await billingEngine.calculateBilling(client_id, cycleStart, cycleEnd, billing_cycle_id);

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
    const client = await getClientDetails(knex, tenant, client_id);
    const due_date = await getDueDate(client_id, cycleEnd); // Uses temporary import

    // Group charges by contract association if they have contract association information
    const chargesByContractGroup: { [key: string]: IBillingCharge[] } = {};
    const nonContractAssociatedCharges: IBillingCharge[] = [];

    for (const charge of billingResult.charges) {
      if (charge.client_contract_id && charge.contract_name) {
        // Use only the contract_name as the key to avoid including the ID in the description
        const contractKey = charge.contract_name;
        if (!chargesByContractGroup[contractKey]) {
          chargesByContractGroup[contractKey] = [];
        }
        chargesByContractGroup[contractKey].push(charge);
      } else {
        nonContractAssociatedCharges.push(charge);
      }
    }

    // Prepare invoice items
    const invoiceItems: IInvoiceCharge[] = [];

    // Add non-contract-associated charges
    nonContractAssociatedCharges.forEach(charge => {
      invoiceItems.push({
        item_id: 'preview-' + uuidv4(),
        invoice_id: 'preview-' + billing_cycle_id,
        service_id: charge.serviceId,
        description: charge.serviceName || 'Charge',
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

    // Add contract-associated charges
    for (const [contractKey, charges] of Object.entries(chargesByContractGroup)) {
      // Determine the contract grouping label and client_contract_id from the first charge
      const contractGroupName = contractKey; // Now contractKey is just the contract_name
      const clientContractGroupId = charges[0].client_contract_id; // Get client_contract_id from the first charge

      // Create a group header for the contract grouping
      const contractGroupHeaderId = 'preview-' + uuidv4();
      invoiceItems.push({
        item_id: contractGroupHeaderId,
        invoice_id: 'preview-' + billing_cycle_id,
        description: `Contract: ${contractGroupName}`, // Use only the contract name, not the ID
        quantity: 1,
        unit_price: 0, // This is just a header, not a charged item
        total_price: 0,
        net_amount: 0,
        tax_amount: 0,
        tax_rate: 0,
        is_manual: false,
        is_bundle_header: true,
        client_contract_id: clientContractGroupId,
        contract_name: contractGroupName,
        rate: 0
      });

      // Add each charge in the contract group as a child item
      charges.forEach(charge => {
        // Enhanced description for bucket charges
        let description = charge.serviceName;
        if (isBucketCharge(charge)) {
          const hoursIncluded = charge.hoursUsed - charge.overageHours;
          if (charge.overageHours > 0) {
            description = `${charge.serviceName} - ${charge.hoursUsed.toFixed(2)} hrs used (${hoursIncluded.toFixed(2)} hrs included + ${charge.overageHours.toFixed(2)} hrs overage @ $${(charge.overageRate / 100).toFixed(2)}/hr)`;
          } else {
            description = `${charge.serviceName} - ${charge.hoursUsed.toFixed(2)} hrs used (within ${hoursIncluded.toFixed(2)} hrs included)`;
          }
        }

        invoiceItems.push({
          item_id: 'preview-' + uuidv4(),
          invoice_id: 'preview-' + billing_cycle_id,
          service_id: charge.serviceId,
          description: description,
          quantity: getChargeQuantity(charge), // Uses local helper
          unit_price: getChargeUnitPrice(charge), // Uses local helper
          total_price: charge.total,
          tax_amount: charge.tax_amount || 0,
          tax_rate: charge.tax_rate || 0,
          tax_region: charge.tax_region || '',
          net_amount: charge.total - (charge.tax_amount || 0),
          is_manual: false,
          client_contract_id: clientContractGroupId,
          contract_name: contractGroupName,
          parent_item_id: contractGroupHeaderId,
          rate: charge.rate,
        });
      });
    }

    // Calculate tax and total for the preview
    const previewTax = await calculatePreviewTax(billingResult.charges, client_id, cycleEnd, client?.tax_region || '');
    const previewTotal = billingResult.totalAmount + previewTax;

    // Map IInvoiceCharge[] to the structure expected by InvoiceViewModel.items
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
      client,
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
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized: No authenticated user found');
  }

  // Get billing cycle details
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('No tenant found');
  }

  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check permissions within transaction
    if (!await hasPermission(currentUser, 'invoice', 'create', trx) && !await hasPermission(currentUser, 'invoice', 'generate', trx)) {
      throw new Error('Permission denied: Cannot generate invoices');
    }

    return await trx('client_billing_cycles')
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
  const { client_id, period_start_date, period_end_date, effective_date } = billingCycle;

  if (period_start_date && period_end_date) {
    // Use the billing cycle's period dates if provided, ensuring UTC format
    cycleStart = toISOTimestamp(toPlainDate(period_start_date));
    cycleEnd = toISOTimestamp(toPlainDate(period_end_date));
  } else if (effective_date) {
    // Calculate period dates from effective_date
    // Format effective_date as UTC ISO8601
    const effectiveDateUTC = toISOTimestamp(toPlainDate(effective_date));
    cycleStart = effectiveDateUTC;
    cycleEnd = await getNextBillingDate(client_id, effectiveDateUTC); // Uses temporary import
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
    throw new Error('No active contract lines for this period');
  }

  // Check for Purchase Order requirements
  let clientContracts: Array<{ po_required?: boolean; po_number?: string }> = [];
  try {
    clientContracts = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('client_plan_bundles')
        .where({
          client_id,
          tenant,
          is_active: true
        })
        .where(function() {
          this.where('start_date', '<=', cycleEnd)
            .where(function() {
              this.whereNull('end_date')
                .orWhere('end_date', '>=', cycleStart);
            });
        });
    });
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }

  // Validate PO requirements for active contracts
  for (const contract of clientContracts) {
    if (contract.po_required && !contract.po_number) {
      throw new Error(`Purchase Order is required for this contract but has not been provided. Please add a PO number to the contract before generating invoices.`);
    }
  }

  const billingEngine = new BillingEngine();
  const billingResult = await billingEngine.calculateBilling(client_id, cycleStart, cycleEnd, billing_cycle_id);

  if (billingResult.error) {
    throw new Error(billingResult.error);
  }

  // Get zero-dollar invoice settings
  const clientSettings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_billing_settings')
      .where({ client_id: client_id, tenant })
      .first();
  });

  const defaultSettings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('default_billing_settings')
      .where({ tenant: tenant })
      .first();
  });

  const settings = clientSettings || defaultSettings;

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
      client_id,
      cycleStart,
      cycleEnd,
      billing_cycle_id,
      currentUser.user_id
    );

    if (settings.zero_dollar_invoice_handling === 'finalized') {
      // TODO: Import finalizeInvoiceWithKnex from invoiceModification.ts once created
      // await finalizeInvoiceWithKnex(createdInvoice.invoice_id, knex, tenant, currentUser.user_id);
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
    client_id,
    cycleStart,
    cycleEnd,
    billing_cycle_id,
    currentUser.user_id
  );

  // Get the next billing date as a PlainDate string (YYYY-MM-DD)
  const nextBillingDateStr = await getNextBillingDate(client_id, cycleEnd); // Uses temporary import

  // Convert the PlainDate string to a proper ISO 8601 timestamp for rolloverUnapprovedTime
  const nextBillingDate = toPlainDate(nextBillingDateStr);
  const nextBillingTimestamp = toISOTimestamp(nextBillingDate);

  // Pass the ISO timestamp to rolloverUnapprovedTime
  await billingEngine.rolloverUnapprovedTime(client_id, cycleEnd, nextBillingTimestamp);

console.log(`[generateInvoice] Regular invoice created (${createdInvoice.invoice_id}). Fetching full ViewModel before returning.`);
  let invoiceView = await Invoice.getFullInvoiceById(knex, createdInvoice.invoice_id);

  return invoiceView;
}

export async function generateInvoiceNumber(_trx?: Knex.Transaction): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized: No authenticated user found');
  }

  // If transaction is provided, check permissions within it
  if (_trx) {
    if (!await hasPermission(currentUser, 'invoice', 'create', _trx) && !await hasPermission(currentUser, 'invoice', 'generate', _trx)) {
      throw new Error('Permission denied: Cannot generate invoice numbers');
    }
  } else {
    // If no transaction provided, create a temporary one for permission check
    const { knex } = await createTenantKnex();
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'invoice', 'create', trx) && !await hasPermission(currentUser, 'invoice', 'generate', trx)) {
        throw new Error('Permission denied: Cannot generate invoice numbers');
      }
    });
  }

  const numberingService = new NumberingService();
  return numberingService.getNextNumber('INVOICE');
}

export async function generateInvoicePDF(invoiceId: string): Promise<{ file_id: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized: No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Check permissions within transaction
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    if (!await hasPermission(currentUser, 'invoice', 'create', trx) && !await hasPermission(currentUser, 'invoice', 'generate', trx)) {
      throw new Error('Permission denied: Cannot generate invoice PDFs');
    }
  });

  // Use the factory function to create the PDF generation service
  const pdfGenerationService = createPDFGenerationService(tenant);

  const fileRecord = await pdfGenerationService.generateAndStore({
    invoiceId,
    userId: currentUser.user_id
  });

  return { file_id: fileRecord.file_id };
}

export async function downloadInvoicePDF(invoiceId: string): Promise<{ pdfData: number[]; invoiceNumber: string }> {
  try {
    console.log('[downloadInvoicePDF] Called with invoiceId:', invoiceId);
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized: No authenticated user found');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Check permissions within transaction
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'invoice', 'read', trx)) {
        throw new Error('Permission denied: Cannot download invoice PDFs');
      }
    });

    // Get invoice details
    const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .first();
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    console.log('[downloadInvoicePDF] Generating PDF for invoice:', invoice.invoice_number);
    // Use the PDF generation service to generate the PDF
    const pdfGenerationService = createPDFGenerationService(tenant);

    const pdfBuffer = await pdfGenerationService.generatePDF({
      invoiceId,
      userId: currentUser.user_id
    });

    console.log('[downloadInvoicePDF] PDF generated, size:', pdfBuffer.length, 'bytes');
    // Convert Buffer to plain array for serialization across server/client boundary
    return {
      pdfData: Array.from(pdfBuffer),
      invoiceNumber: invoice.invoice_number
    };
  } catch (error) {
    console.error('[downloadInvoicePDF] Error:', error);
    console.error('[downloadInvoicePDF] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
}

export async function createInvoiceFromBillingResult(
  billingResult: IBillingResult,
  clientId: string,
  cycleStart: ISO8601String,
  cycleEnd: ISO8601String,
  billing_cycle_id: string,
  userId: string
): Promise<IInvoice> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized: No authenticated user found');
  }

  // Verify that the userId matches the current user
  if (currentUser.user_id !== userId) {
    throw new Error('Permission denied: User ID mismatch');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  const client = await getClientDetails(knex, tenant, clientId);
  let region_code = await getClientDefaultTaxRegionCode(clientId);
  const taxService = new TaxService();

  if (!region_code) {
    console.warn(`[createInvoiceFromBillingResult] Client ${clientId} (${client.client_name}) has no default tax region. Attempting to create default tax settings automatically.`);
    try {
      await taxService.ensureDefaultTaxSettings(clientId);
      region_code = await getClientDefaultTaxRegionCode(clientId);
    } catch (autoConfigError) {
      console.error(`[createInvoiceFromBillingResult] Failed to auto-configure default tax region for client ${clientId}:`, autoConfigError);
    }
  }

  if (!region_code) {
    console.error(`[createInvoiceFromBillingResult] Cannot create invoice for client ${clientId} (${client.client_name}) because it lacks a default tax region (region_code) even after auto-configuration attempt.`);
    throw new Error(`Client '${client.client_name}' does not have a default tax region configured. Please set one before generating invoices.`);
  }
  const currentDate = Temporal.Now.plainDateISO().toString();
  const due_date = await getDueDate(clientId, cycleEnd); // Uses temporary import
  // taxService initialized above
  // let subtotal = 0; // Subtotal will be calculated by persistInvoiceCharges

  // Determine tax source for this invoice based on client/tenant settings
  const taxSource = await getInitialInvoiceTaxSource(clientId);
  const useTaxDelegation = await shouldUseTaxDelegation(clientId);

  // Create base invoice object
  const invoiceData = {
    client_id: clientId,
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
    billing_period_end: toPlainDate(cycleEnd),
    // Tax source: 'internal', 'pending_external', or 'external'
    tax_source: taxSource
  };

  let newInvoice: IInvoice | null = null;
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const invoiceNumber = await generateInvoiceNumber(); // Uses local function
      invoiceData.invoice_number = invoiceNumber;
      const [insertedInvoice] = await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Check permissions within transaction
        if (!await hasPermission(currentUser, 'invoice', 'create', trx) && !await hasPermission(currentUser, 'invoice', 'generate', trx)) {
          throw new Error('Permission denied: Cannot create invoices');
        }

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
    // Permission already checked in previous transaction, no need to recheck
    // Just use currentUser that we already validated

    // Persist all items (including fixed details) using the dedicated service function
    const sessionObject: Session = {
      user: {
        id: currentUser.user_id,
        email: currentUser.email,
        name: `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || currentUser.username,
        username: currentUser.username,
        image: currentUser.image,
        proToken: '', // Not available in currentUser, using empty string
        tenant: currentUser.tenant,
        user_type: currentUser.user_type,
        clientId: undefined, // Not available in currentUser
        contactId: currentUser.contact_id
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
    };
    const calculatedSubtotal = await persistInvoiceCharges(
      trx,
      newInvoice!.invoice_id,
      billingResult.charges,
      client,
      sessionObject,
      tenant
    );

    // Process discounts (if any) - This might need adjustment if persistInvoiceCharges handles them
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
      await trx('invoice_charges').insert(discountItem);
      discountSubtotalAdjustment += netAmount; // Add negative amount
    }

    // Use the subtotal returned by persistInvoiceCharges + discount adjustment
    const subtotal = calculatedSubtotal + discountSubtotalAdjustment;

    // Leverage the shared tax helper so automated invoices mirror manual invoices
    const calculatedTax = await calculateAndDistributeTax(
      trx,
      newInvoice!.invoice_id,
      client,
      taxService,
      tenant
    );

    const finalSubtotal = Math.ceil(subtotal);
    const finalTax = Math.ceil(calculatedTax);
    const totalAmount = finalSubtotal + finalTax;
    const availableCredit = await ClientContractLine.getClientCredit(clientId);
    const creditToApply = Math.min(availableCredit, Math.ceil(totalAmount));

    // Update the invoice with subtotal, tax, and total amount
    await trx('invoices')
      .where({ invoice_id: newInvoice!.invoice_id, tenant })
      .update({
        subtotal: finalSubtotal,
        tax: finalTax,
        total_amount: Math.ceil(totalAmount),
        credit_applied: 0
      });

    // Corrected call signature: removed finalSubtotal and finalTax as they are recalculated internally
    await updateInvoiceTotalsAndRecordTransaction(
      trx,
      newInvoice!.invoice_id,
      client,
      tenant,
      invoiceData.invoice_number
      // expirationDate is optional and not needed here
    );
  });

  // Track analytics
  analytics.capture(AnalyticsEvents.INVOICE_GENERATED, {
    invoice_id: newInvoice.invoice_id,
    invoice_number: newInvoice.invoice_number,
    client_id: clientId,
    subtotal: newInvoice.subtotal,
    tax: newInvoice.tax,
    total_amount: newInvoice.total_amount,
    billing_period_start: cycleStart,
    billing_period_end: cycleEnd,
    charge_count: billingResult.charges.length,
    discount_count: billingResult.discounts.length,
    is_manual: false
  }, userId);

  return newInvoice;
}
