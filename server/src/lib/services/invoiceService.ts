import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { TaxService } from 'server/src/lib/services/taxService';
import { generateInvoiceNumber } from 'server/src/lib/actions/invoiceGeneration';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import { InvoiceViewModel, IInvoiceItem as ManualInvoiceItem, NetAmountItem, DiscountType } from 'server/src/interfaces/invoice.interfaces'; // Renamed for clarity
import { IBillingCharge, IFixedPriceCharge, IService, TransactionType } from 'server/src/interfaces/billing.interfaces'; // Added import
import { IClientWithLocation } from 'server/src/interfaces/client.interfaces';
import { Knex } from 'knex';
import { Session } from 'next-auth';
import { ISO8601String } from 'server/src/types/types.d';
import { getClientDefaultTaxRegionCode } from 'server/src/lib/actions/client-actions/clientTaxRateActions'; // Import the new lookup function
import { getSession } from 'server/src/lib/auth/getSession';

// Helper interface for tax calculation
interface ITaxableEntity {
  id: string; // item_id or item_detail_id
  type: 'item' | 'fixed_detail';
  amount: number; // net_amount or allocated_amount (in cents)
  taxRegion: string;
  isTaxable: boolean;
  parentId?: string; // item_id for fixed_detail
  calculatedTax?: number; // Calculated tax share (in cents)
  taxRate?: number; // Tax rate applied
}

interface InvoiceContext {
  session: Session;
  knex: Knex;
  tenant: string;
}

export async function validateSessionAndTenant(): Promise<InvoiceContext> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }
  return { session, knex, tenant };
}

export async function getClientDetails(knex: Knex, tenant: string, clientId: string): Promise<IClientWithLocation> {
  const client = await knex('clients as c')
    .leftJoin('client_locations as cl', function() {
      this.on('c.client_id', '=', 'cl.client_id')
          .andOn('c.tenant', '=', 'cl.tenant')
          .andOn('cl.is_default', '=', knex.raw('true'));
    })
    .select(
      'c.*',
      'cl.address_line1 as location_address'
    )
    .where({
      'c.client_id': clientId,
      'c.tenant': tenant
    })
    .first();
  if (!client) {
    throw new Error(`Client not found for tenant ${tenant}`);
  }
  return client;
}

// Renamed interface for clarity within manual context
interface ManualInvoiceItemInput extends NetAmountItem {
  service_id?: string; // Optional for manual items
  description: string;
  is_taxable?: boolean; // Still needed for purely manual items without a service
  applies_to_service_id?: string;
  discount_percentage?: number;
}


export function calculateNetAmount(
  requestItem: NetAmountItem,
  currentSubtotal: number,
  applicableItemAmount?: number
): number {
  if (requestItem.is_discount) {
    if (requestItem.discount_type === 'percentage') {
      const applicableAmount = requestItem.applies_to_item_id
        ? (applicableItemAmount || 0)
        : currentSubtotal;
      const percentage = requestItem.discount_percentage !== undefined
        ? requestItem.discount_percentage
        : Math.abs(requestItem.rate); // Fallback for older manual discounts? Review this.
      return -Math.round((applicableAmount * percentage) / 100);
    } else {
      // Fixed amount discount - ensure it's always negative
      return -Math.abs(Math.round(requestItem.rate));
    }
  } else {
    // Regular line item
    return Math.round(requestItem.quantity * requestItem.rate);
  }
}

/**
 * Persists manual invoice items to the database.
 * Handles both regular manual items and manual discount items.
 * Resolves service ID references for discounts.
 * @returns The subtotal of the persisted manual items.
 */
export async function persistManualInvoiceItems(
  tx: Knex.Transaction,
  invoiceId: string,
  manualItems: ManualInvoiceItemInput[],
  client: any,
  session: Session,
  tenant: string
): Promise<number> {
  let subtotal = 0;
  const serviceToItemMap = new Map<string, string>(); // Maps service_id to item_id for discount resolution
  const now = Temporal.Now.instant().toString();

  // --- First Pass: Process non-discount manual items ---
  const nonDiscountItems = manualItems.filter(item => !item.is_discount);
  for (const requestItem of nonDiscountItems) {
    let service;
    if (requestItem.service_id) {
      service = await tx('service_catalog')
        .where({ service_id: requestItem.service_id, tenant })
        .select('*', 'tax_rate_id') // Fetch tax_rate_id
        .first();
      if (!service) {
        console.warn(`Service ID ${requestItem.service_id} provided for manual item but not found.`);
        throw new Error(`Service not found: ${requestItem.service_id}`);
      }
    }
    // --- Determine Tax Info based on Service's Tax Rate ID ---
    let serviceTaxRegion: string | null = null;
    let serviceIsTaxable = true; // Default for purely manual items if no service
    if (service) {
      if (service.tax_rate_id) {
        const taxRateInfo = await tx('tax_rates')
          .where({ tax_rate_id: service.tax_rate_id, tenant })
          // Add validity checks if needed (e.g., is_active, date range)
          // For now, just fetch the region code associated with the ID
          .select('region_code')
          .first();
        if (taxRateInfo) {
          serviceTaxRegion = taxRateInfo.region_code;
          serviceIsTaxable = true; // Service with a valid tax_rate_id is taxable
        } else {
          // tax_rate_id exists but doesn't link to a valid rate? Treat as non-taxable.
          console.warn(`Service ${service.service_id} has tax_rate_id ${service.tax_rate_id} but no matching tax_rate found.`);
          serviceIsTaxable = false;
          serviceTaxRegion = null;
        }
      } else {
        // Service exists but tax_rate_id is NULL, so it's non-taxable
        serviceIsTaxable = false;
        serviceTaxRegion = null;
      }
    } else {
      // No service linked, use fallback logic below for purely manual items
      serviceIsTaxable = requestItem.is_taxable ?? true; // Existing fallback
      // serviceTaxRegion is derived from tax_rate_id now, or client default if no service/rate
      // No direct tax_region on requestItem anymore
      serviceTaxRegion = client.region_code ?? null; // Fallback to client default region if no service linked
    }
    // --- End Determine Tax Info ---

    const netAmount = calculateNetAmount(requestItem, subtotal); // No applicable amount needed here

    // Detect manual credits (negative rate, not explicitly marked as discount)
    const isCredit = !requestItem.is_discount && requestItem.rate < 0;

    const invoiceItem = {
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: requestItem.service_id || null,
      description: requestItem.description,
      quantity: requestItem.quantity,
      unit_price: Math.round(requestItem.rate), // Store the actual rate
      net_amount: netAmount,
      tax_amount: 0, // Placeholder
      tax_region: service ? serviceTaxRegion : (client.region_code ?? null), // Fallback to client region if no service
      tax_rate: 0, // Placeholder
      total_price: netAmount, // Placeholder
      is_manual: true,
      is_discount: isCredit, // Mark manual credits as discounts for tax base calculation logic
      is_taxable: isCredit ? false : serviceIsTaxable, // Use derived taxable status
      discount_type: isCredit ? 'fixed' : undefined, // Credits are like fixed discounts
      applies_to_item_id: null, // Manual non-discounts don't apply to others
      applies_to_service_id: null,
      created_by: session.user.id,
      created_at: now,
      tenant
    };

    await tx('invoice_items').insert(invoiceItem);
    if (requestItem.service_id) {
      serviceToItemMap.set(requestItem.service_id, invoiceItem.item_id);
    }
    subtotal += netAmount;
  }

  // --- Second Pass: Process manual discount items ---
  const discountItems = manualItems.filter(item => item.is_discount);
  for (const requestItem of discountItems) {
    let applicableItemId = requestItem.applies_to_item_id;
    let applicableAmount;

    // Resolve service ID reference if needed
    if (requestItem.applies_to_service_id && !applicableItemId) {
      applicableItemId = serviceToItemMap.get(requestItem.applies_to_service_id);
      if (!applicableItemId) {
        throw new Error(`Could not find invoice item for service: ${requestItem.applies_to_service_id} to apply discount.`);
      }
    }

    // Get applicable item amount for percentage discounts
    if (applicableItemId) {
      const applicableItem = await tx('invoice_items')
        .where({ item_id: applicableItemId, tenant })
        .first();
      applicableAmount = applicableItem?.net_amount;
    }

    const netAmount = calculateNetAmount(
      { ...requestItem, applies_to_item_id: applicableItemId },
      subtotal, // Pass current subtotal for percentage discounts not tied to an item
      applicableAmount
    );

    let service; // Discounts might optionally reference a service
    if (requestItem.service_id) {
        service = await tx('service_catalog')
            .where({ service_id: requestItem.service_id, tenant })
            .select('*', 'tax_rate_id') // Fetch tax_rate_id
            .first();
    }
    // --- Determine Tax Region for Discount (less critical as not taxed, but for consistency) ---
    let discountTaxRegion: string | null = null;
    if (service) {
        if (service.tax_rate_id) {
            const taxRateInfo = await tx('tax_rates')
                .where({ tax_rate_id: service.tax_rate_id, tenant })
                .select('region_code')
                .first();
            discountTaxRegion = taxRateInfo?.region_code ?? null;
        }
        // If service exists but no tax_rate_id, region remains null
    } else {
        // No service linked, use fallback
        discountTaxRegion = client.region_code ?? null; // Fallback to client region if no service
    }
    // --- End Determine Tax Region ---

    const invoiceItem = {
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: requestItem.service_id || null,
      description: requestItem.description,
      quantity: requestItem.quantity,
      // Unit price for percentage discount is tricky, maybe store percentage? Or keep 0?
      unit_price: requestItem.discount_type === 'percentage' ? 0 : -Math.abs(Math.round(requestItem.rate)),
      net_amount: netAmount,
      tax_amount: 0, // Discounts are not taxed
      tax_region: discountTaxRegion, // Use derived/fallback region
      tax_rate: 0,
      total_price: netAmount,
      is_manual: true,
      is_discount: true,
      is_taxable: false, // Discounts are never taxable
      discount_type: requestItem.discount_type || 'fixed',
      discount_percentage: requestItem.discount_type === 'percentage' ? requestItem.discount_percentage : undefined,
      applies_to_item_id: applicableItemId,
      applies_to_service_id: requestItem.applies_to_service_id, // Store original reference
      created_by: session.user.id,
      created_at: now,
      tenant
    };

    await tx('invoice_items').insert(invoiceItem);
    subtotal += netAmount;
  }

  return subtotal;
}

/**
 * Persists fixed-price invoice items generated by the billing engine.
 * Handles detailed fixed-price charges (V1) and contract-level fixed-price charges.
 * Creates consolidated invoice_items and detail records as needed.
 * @returns The subtotal of the persisted fixed-price items.
 */
async function persistFixedInvoiceItems(
  tx: Knex.Transaction,
  invoiceId: string,
  fixedCharges: IFixedPriceCharge[],
  client: any,
  session: Session,
  tenant: string
): Promise<number> {
  let fixedSubtotal = 0;
  const now = Temporal.Now.instant().toString();
  const fixedPlanDetailsMap = new Map<string, { consolidatedItem: any; details: IFixedPriceCharge[] }>();

  for (const charge of fixedCharges) {
    // --- Handle Detailed Fixed Price Charges (V1 Scope) ---
    // --- DEBUG LOGGING ---
    console.log('[persistFixedInvoiceItems] Checking charge:', JSON.stringify(charge, null, 2));
    console.log('[persistFixedInvoiceItems] charge.config_id:', charge.config_id, 'Type:', typeof charge.config_id);
    // --- END DEBUG LOGGING ---
    // Rely on config_id being present and truthy, as 'in' check might be unreliable depending on object creation
    if (charge.config_id) {
      // Use client_contract_line_id from the base IBillingCharge interface if needed for grouping
      const clientContractLineId = charge.client_contract_line_id;
      if (!clientContractLineId) {
        // This shouldn't happen if billingEngine adds it correctly, but good to check.
        console.error("Detailed fixed price charge is missing client_contract_line_id:", charge);
        throw new Error("Internal error: Detailed fixed price charge must have a client_contract_line_id.");
      }

      // Group by clientContractLineId instead of planId
      if (!fixedPlanDetailsMap.has(clientContractLineId)) {
          if (charge.base_rate === undefined || charge.base_rate === null) {
              console.error("Detailed fixed price charge is missing base_rate:", charge);
              throw new Error("Internal error: Detailed fixed price charge must have a base_rate.");
          }

          // --- Determine Consolidated Item Tax Region & Taxability (Derived from Charges) ---
          // Get all charges associated with this clientContractLineId to determine consolidated properties
          const chargesForThisPlan = fixedCharges.filter(c => c.client_contract_line_id === clientContractLineId);

          // Determine if *any* charge in this group is taxable
          const isAnyChargeTaxable = chargesForThisPlan.some(c => c.is_taxable);

          // Determine the consolidated region
          const distinctChargeRegions = [...new Set(chargesForThisPlan.map(c => c.tax_region).filter((r): r is string => r !== null && r !== undefined))];
          let consolidatedRegion: string | null = null;
          if (distinctChargeRegions.length === 1) {
            consolidatedRegion = distinctChargeRegions[0];
            console.log(`[persistFixedInvoiceItems] Using consistent charge region '${consolidatedRegion}' for consolidated item of plan assignment ${clientContractLineId}`);
          } else {
            // Fallback to client default if regions are inconsistent or all null/undefined
            consolidatedRegion = await getClientDefaultTaxRegionCode(client.client_id);
            if (distinctChargeRegions.length > 1) {
              console.warn(`[persistFixedInvoiceItems] Multiple distinct tax regions found among charges for plan assignment ${clientContractLineId}. Using client default region '${consolidatedRegion}'.`);
            } else {
              console.log(`[persistFixedInvoiceItems] No single charge region found for plan assignment ${clientContractLineId}. Using client default region '${consolidatedRegion}'.`);
            }
          }
          // --- End Determine Consolidated Item Tax Region & Taxability ---

          fixedPlanDetailsMap.set(clientContractLineId, {
              consolidatedItem: {
                  invoice_id: invoiceId,
                  service_id: null,
                  description: `Fixed Plan: ${charge.serviceName}`,
                  quantity: 1,
                  unit_price: Math.round(charge.base_rate * 100),
                  net_amount: 0,
                  tax_amount: 0,
                  tax_region: consolidatedRegion, // Use the determined region
                  tax_rate: 0,
                  total_price: 0,
                  is_manual: false,
                  is_discount: false,
                  is_taxable: isAnyChargeTaxable, // Set based on whether *any* detail charge is taxable
                  discount_type: undefined,
                  discount_percentage: undefined,
                  applies_to_item_id: null,
                  applies_to_service_id: null,
                  created_by: session.user.id,
                  created_at: now,
                  tenant
              },
              details: []
          });
      }

      const planEntry = fixedPlanDetailsMap.get(clientContractLineId)!;
      planEntry.details.push(charge);

    } else {
      // --- Handle Contract-Level Fixed Price Charges (V1 - Old Behavior) ---
      // These are treated like simple manual items for persistence
      const netAmount = charge.total; // Contract rate is already calculated
      const invoiceItem = {
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: charge.serviceId || null, // Contract-level charges might not reference a single service ID
        // contract_line_id: charge.planId ?? null, // Removed - planId not part of IFixedPriceCharge
        // client_contract_line_id could be added here if needed for the DB schema, but invoice_items doesn't have it.
        description: charge.serviceName, // Use the name from the charge
        quantity: charge.quantity,
        unit_price: charge.rate, // The custom rate
        net_amount: netAmount,
        tax_amount: charge.tax_amount || 0, // Use tax from charge if available
        tax_region: client.tax_region, // Use client default
        tax_rate: charge.tax_rate || 0, // Use rate from charge if available
        total_price: netAmount + (charge.tax_amount || 0),
        is_manual: false,
        is_discount: false,
        is_taxable: charge.is_taxable,
        discount_type: undefined,
        discount_percentage: undefined,
        applies_to_item_id: null,
        applies_to_service_id: null,
        created_by: session.user.id,
        created_at: now,
        tenant
      };
      await tx('invoice_items').insert(invoiceItem);
      fixedSubtotal += netAmount;
    }
  }

  // --- Process Consolidated Fixed Plan Items and Details ---

  // Fetch plan details (name and fixed config base rate) for all consolidated items first
  const clientPlanIds = Array.from(fixedPlanDetailsMap.keys());
  // Map: clientContractLineId -> { contract_line_name: string, contract_line_base_rate: number | null }
  const planInfoMap = new Map<string, { contract_line_name: string; contract_line_base_rate: number | null }>();

  // Filter out virtual contract-association IDs that start with "contract-" as they're not real UUIDs in the database
  const validDbPlanIds = clientPlanIds.filter(id => !id.startsWith('contract-'));
  const contractLinkedPlanIds = clientPlanIds.filter(id => id.startsWith('contract-'));

  // Add default info for contract-associated plans that won't be found in the database
  for (const linkedPlanId of contractLinkedPlanIds) {
    planInfoMap.set(linkedPlanId, {
      contract_line_name: 'Contract Plan',
      contract_line_base_rate: null
    });
  }

  if (validDbPlanIds.length > 0) {
    const planDetails = await tx('client_contract_lines as ccl')
      .join('contract_lines as cl', function() {
        this.on('ccl.contract_line_id', '=', 'cl.contract_line_id')
            .andOn('ccl.tenant', '=', 'cl.tenant');
      })
      // Join with the new fixed config table to get the plan-level base rate
      .leftJoin('contract_line_fixed_config as clfc', function() {
        this.on('cl.contract_line_id', '=', 'clfc.contract_line_id')
            .andOn('cl.tenant', '=', 'clfc.tenant');
      })
      .whereIn('ccl.client_contract_line_id', validDbPlanIds)
      .andWhere('ccl.tenant', tenant) // Ensure tenant match on ccl
      .select(
        'ccl.client_contract_line_id',
        'cl.contract_line_name',
        'clfc.base_rate as contract_line_base_rate' // Select base_rate from the fixed config table
       );

    for (const detail of planDetails) {
      planInfoMap.set(detail.client_contract_line_id, {
        contract_line_name: detail.contract_line_name,
        // Parse the base_rate fetched from contract_line_fixed_config
        contract_line_base_rate: detail.contract_line_base_rate ? parseFloat(detail.contract_line_base_rate) : null
      });
    }
  }


  // Iterate using clientContractLineId as the key
  for (const [clientContractLineId, planEntry] of fixedPlanDetailsMap.entries()) {
    const planInfo = planInfoMap.get(clientContractLineId);
    if (!planInfo) {
        console.error(`Could not find plan info for clientContractLineId: ${clientContractLineId}`);
        // Decide how to handle missing plan info (skip? throw error?)
        continue;
    }

    // Update the consolidated item's description and unit_price before insertion
    planEntry.consolidatedItem.description = `Fixed Plan: ${planInfo.contract_line_name}`;
    // Use the plan-level base_rate fetched from contract_line_fixed_config if available.
    // Fallback to the unit_price derived from the first service charge if plan-level rate is missing (shouldn't happen ideally).
    planEntry.consolidatedItem.unit_price = planInfo.contract_line_base_rate !== null
        ? Math.round(planInfo.contract_line_base_rate * 100) // Use plan base rate in cents
        : planEntry.consolidatedItem.unit_price; // Fallback to initially set price (from first service)

    let planNetTotal = 0;
    let planTaxTotal = 0;
    let planTaxRegion: string | null = null;
    let planIsTaxable = false;

    for (const detail of planEntry.details) {
      const allocatedAmountCents = Number(detail.allocated_amount ?? detail.total ?? 0);
      const taxAmountCents = Number(detail.tax_amount || 0);

      planNetTotal += allocatedAmountCents;
      planTaxTotal += taxAmountCents;
      if (!planTaxRegion && detail.tax_region) {
        planTaxRegion = detail.tax_region;
      }
      if (detail.is_taxable) {
        planIsTaxable = true;
      }
    }

    const parentItemId = uuidv4();
    const aggregatedTaxRate = planNetTotal
      ? Number(((planTaxTotal / planNetTotal) * 100).toFixed(6))
      : 0;
    await tx('invoice_items').insert({
      item_id: parentItemId,
      invoice_id: invoiceId,
      service_id: null,
      description: planInfo.contract_line_name || 'Fixed Plan Charge',
      quantity: 1,
      unit_price: planNetTotal,
      net_amount: planNetTotal,
      tax_amount: planTaxTotal,
      total_price: planNetTotal + planTaxTotal,
      tax_region: planTaxRegion ?? client.tax_region ?? null,
      tax_rate: aggregatedTaxRate,
      is_manual: false,
      is_discount: false,
      is_taxable: planIsTaxable,
      created_by: session.user.id,
      created_at: now,
      updated_at: now,
      tenant
    });

    for (const detail of planEntry.details) {
      const detailId = uuidv4();
      const allocatedAmountCents = Number(detail.allocated_amount ?? detail.total ?? 0);
      const taxAmountCents = Number(detail.tax_amount || 0);
      const detailQuantity = Number(detail.quantity ?? 1) || 1;
      const unitPriceCents = detailQuantity !== 0
        ? Math.round(allocatedAmountCents / detailQuantity)
        : allocatedAmountCents;

      await tx('invoice_item_details').insert({
        item_detail_id: detailId,
        item_id: parentItemId,
        service_id: detail.serviceId,
        config_id: detail.config_id,
        quantity: detailQuantity,
        rate: unitPriceCents,
        service_period_start: detail.servicePeriodStart ?? null,
        service_period_end: detail.servicePeriodEnd ?? null,
        billing_timing: detail.billingTiming ?? null,
        created_at: now,
        updated_at: now,
        tenant
      });

      await tx('invoice_item_fixed_details').insert({
        item_detail_id: detailId,
        base_rate: detail.base_rate,
        enable_proration: detail.enable_proration,
        fmv: Number(detail.fmv || 0),
        proportion: detail.proportion,
        allocated_amount: allocatedAmountCents,
        tax_amount: taxAmountCents,
        tax_rate: detail.tax_rate ?? 0,
        tenant
      });
    }

    fixedSubtotal += planNetTotal;
  }

  return fixedSubtotal;
}


/**
 * Persists invoice items generated by the billing engine.
 * Delegates fixed-price items to persistFixedInvoiceItems.
 * Handles other billing charge types (usage, hourly, etc.).
 * @returns The total subtotal of all persisted billing items.
 */
export async function persistInvoiceItems(
  tx: Knex.Transaction,
  invoiceId: string,
  billingCharges: IBillingCharge[],
  client: any,
  session: Session,
  tenant: string
): Promise<number> {
  let otherSubtotal = 0;
  const now = Temporal.Now.instant().toString();

  // Separate fixed charges from others
  const fixedCharges: IFixedPriceCharge[] = [];
  const otherCharges: IBillingCharge[] = [];

  for (const charge of billingCharges) {
    if (charge.type === 'fixed') {
      // This assumes the billing engine correctly types fixed charges
      // and includes all necessary fields from IFixedPriceCharge
      fixedCharges.push(charge as IFixedPriceCharge);
    } else {
      otherCharges.push(charge);
    }
  }

  // Persist fixed charges (detailed and contract-level) using the dedicated function
  const fixedSubtotal = await persistFixedInvoiceItems(
    tx,
    invoiceId,
    fixedCharges,
    client,
    session,
    tenant
  );

  // --- Handle Other Billing Charge Types (Usage, Hourly, Product, License etc.) ---
  for (const charge of otherCharges) {
    // Add specific handling for each type if needed, otherwise use generic approach
    const netAmount = charge.total; // Assuming 'total' is the net amount
    const invoiceItem = {
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: charge.serviceId,
      // Check if planId exists on the specific charge type if needed
      // For non-fixed types, planId might not be relevant or available
      // contract_line_id: ('planId' in charge ? (charge as any).planId : null), // Removed - planId not part of IFixedPriceCharge
      // Use client_contract_line_id if the schema requires it
      // client_contract_line_id: charge.client_contract_line_id ?? null,
      description: charge.serviceName,
      quantity: charge.quantity ?? 1,
      unit_price: charge.rate ?? 0,
      net_amount: netAmount,
      tax_amount: charge.tax_amount || 0,
      tax_region: charge.tax_region || client.tax_region, // Use charge region or default
      tax_rate: charge.tax_rate || 0,
      total_price: netAmount + (charge.tax_amount || 0), // Will be updated by tax calculation
      is_manual: false,
      is_discount: false,
      is_taxable: charge.is_taxable ?? false,
      discount_type: undefined,
      discount_percentage: undefined,
      applies_to_item_id: null,
      applies_to_service_id: null,
      created_by: session.user.id,
      created_at: now,
      tenant
    };
    await tx('invoice_items').insert(invoiceItem);
    otherSubtotal += netAmount;
  }

  return fixedSubtotal + otherSubtotal; // Return total subtotal
}


export async function calculateAndDistributeTax(
  tx: Knex.Transaction,
  invoiceId: string,
  client: any,
  taxService: TaxService,
  tenant: string
): Promise<number> {
  // 1. Fetch all relevant data
  console.log(`[calculateAndDistributeTax] Starting for invoice: ${invoiceId}`);
  const invoiceItems: ManualInvoiceItem[] = await tx('invoice_items') // Use ManualInvoiceItem type for base structure
    .where({ invoice_id: invoiceId, tenant })
    .select('*');
  console.log(`[calculateAndDistributeTax] Fetched ${invoiceItems.length} invoice items:`, JSON.stringify(invoiceItems.map(i => ({id: i.item_id, desc: i.description, net: i.net_amount, tax: i.tax_amount, taxable: i.is_taxable, region: i.tax_region, is_discount: i.is_discount})), null, 2));

  // Correctly identify consolidated items by checking for existence in invoice_item_details
  // Fetch item_id and invoice_id from invoice_item_details to link back correctly
  const detailParentIdsResult = await tx('invoice_item_details')
    .where('invoice_item_details.tenant', tenant)
    .join('invoice_items', function() {
      this.on('invoice_items.item_id', '=', 'invoice_item_details.item_id')
        .andOn('invoice_items.tenant', '=', 'invoice_item_details.tenant');
    })
    .where('invoice_items.invoice_id', invoiceId) // Filter by the main invoice ID
    .andWhere('invoice_items.tenant', tenant)
    .distinct('invoice_item_details.item_id');
  const detailParentIds = new Set(detailParentIdsResult.map((row: { item_id: string }) => row.item_id));

  const consolidatedItemIds = invoiceItems
    .filter(item => detailParentIds.has(item.item_id)) // Item is consolidated if it's a parent in details table
    .map(item => item.item_id);

  console.log(`[calculateAndDistributeTax] Identified consolidatedItemIds: ${consolidatedItemIds.join(', ')}`);

  let fixedDetails: any[] = [];
  if (consolidatedItemIds.length > 0) {
    // Fetch details. Tax info (is_taxable, tax_region) should now be on the parent invoice_item
    // derived during item creation based on service's tax_rate_id.
    fixedDetails = await tx('invoice_item_fixed_details as iifd')
        .join('invoice_item_details as iid', function() {
            this.on('iid.item_detail_id', '=', 'iifd.item_detail_id')
                .andOn('iifd.tenant', '=', 'iid.tenant'); // Ensure tenant match
        })
        .whereIn('iid.item_id', consolidatedItemIds) // Filter by the correctly identified parent IDs
        .andWhere('iifd.tenant', tenant)
        .andWhere('iid.tenant', tenant)
        .select(
            'iifd.item_detail_id',
            'iifd.allocated_amount',
            'iid.item_id as parent_item_id',
            'iid.service_id' // Keep service_id if needed for other logic, but not for tax region/taxability here
        );
    console.log(`[calculateAndDistributeTax] Fetched ${fixedDetails.length} fixed details (tax info from parent item):`, JSON.stringify(fixedDetails.map(d => ({ detail_id: d.item_detail_id, parent_id: d.parent_item_id, amount: d.allocated_amount })), null, 2));
  } else {
      console.log(`[calculateAndDistributeTax] No consolidated items found, skipping fixed detail fetch.`);
  }

  // 2. Create unified list of taxable entities and credits
  const taxableEntities: ITaxableEntity[] = [];
  const creditItems = invoiceItems.filter(item => Number(item.net_amount) < 0 && item.is_discount !== true);

  // Process fixed details into taxable entities
  for (const detail of fixedDetails) {
    const parentItem = invoiceItems.find(item => item.item_id === detail.parent_item_id);
    if (!parentItem) {
        console.error(`[calculateAndDistributeTax] Could not find parent item ${detail.parent_item_id} for detail ${detail.item_detail_id}`);
        continue; // Skip this detail if parent is missing
    }
    const isTaxable = parentItem.is_taxable === true; // Get taxability from parent
    const allocatedAmount = Number(detail.allocated_amount || 0);
    if (allocatedAmount > 0 && isTaxable) {
      taxableEntities.push({
        id: detail.item_detail_id,
        type: 'fixed_detail',
        amount: allocatedAmount,
        // Use service region first, then lookup client default. Provide empty string if null.
        taxRegion: parentItem.tax_region || await getClientDefaultTaxRegionCode(client.client_id) || '', // Get region from parent
        isTaxable: true,
        parentId: detail.parent_item_id,
      });
    }
  }

  // Process other invoice items (non-consolidated fixed, usage, manual, etc.)
  for (const item of invoiceItems) {
    // Skip consolidated items (handled via details), credits, and discounts
    if (item.parent_item_id) {
      continue;
    }

    if (consolidatedItemIds.includes(item.item_id) || Number(item.net_amount) <= 0 || item.is_discount) {
      continue;
    }
    // Only include items marked as taxable
    if (item.is_taxable === true) {
      taxableEntities.push({
        id: item.item_id,
        type: 'item',
        amount: Number(item.net_amount),
        // Use item region first, then lookup client default. Provide empty string if null.
        taxRegion: item.tax_region || await getClientDefaultTaxRegionCode(client.client_id) || '',
        isTaxable: true,
      });
    }
  }
  console.log(`[calculateAndDistributeTax] Created ${taxableEntities.length} taxable entities:`, JSON.stringify(taxableEntities, null, 2));
  console.log(`[calculateAndDistributeTax] Identified ${creditItems.length} credit items (negative net, not discount).`);
  const explicitDiscountItemsLog = invoiceItems.filter(item => item.is_discount === true);
  console.log(`[calculateAndDistributeTax] Identified ${explicitDiscountItemsLog.length} explicit discount items.`);

  // 3. Group by tax region (including discounts)
  const regionGroups: Record<string, { taxable: ITaxableEntity[], credits: ManualInvoiceItem[], discounts: ManualInvoiceItem[] }> = {};

  // Initialize groups for all items to ensure all regions are captured
  for (const item of invoiceItems) {
      const region = item.tax_region || client.tax_region;
      if (!regionGroups[region]) {
          regionGroups[region] = { taxable: [], credits: [], discounts: [] };
      }
  }

  // Group taxable entities
  for (const entity of taxableEntities) {
    const region = entity.taxRegion;
    // Ensure group exists (should already from above, but safe check)
    if (!regionGroups[region]) regionGroups[region] = { taxable: [], credits: [], discounts: [] };
    regionGroups[region].taxable.push(entity);
  }

  // Group credit items (negative net_amount, NOT explicitly discount)
  for (const credit of creditItems) { // creditItems already filtered for net_amount < 0 and is_discount !== true
    const region = credit.tax_region || client.tax_region;
    if (!regionGroups[region]) regionGroups[region] = { taxable: [], credits: [], discounts: [] }; // Safety check
    regionGroups[region].credits.push(credit);
  }

  // Group explicit discount items (is_discount === true)
  const explicitDiscountItems = invoiceItems.filter(item => item.is_discount === true);
  for (const discount of explicitDiscountItems) {
      const region = discount.tax_region || client.tax_region;
      if (!regionGroups[region]) regionGroups[region] = { taxable: [], credits: [], discounts: [] }; // Safety check
      regionGroups[region].discounts.push(discount);
  }
  console.log(`[calculateAndDistributeTax] Region groups created:`, JSON.stringify(Object.keys(regionGroups)));

  // 4. Calculate Regional Base & Tax and 5. Distribute Tax
  let computedTotalInvoiceTax = 0;
  const detailUpdates: { item_detail_id: string, tax_amount: number, tax_rate: number }[] = [];
  const itemTaxUpdates: { item_id: string, tax_amount: number, tax_rate: number }[] = []; // Renamed for clarity

  for (const [region, group] of Object.entries(regionGroups)) {
    const positiveSum = group.taxable.reduce((sum, entity) => sum + entity.amount, 0);
    // Calculate base ONLY from positive taxable entities. Ignore credits/discounts for tax base calculation.
    const regionalTaxableBase = positiveSum;
    console.log(`[calculateAndDistributeTax] Region: ${region}, Positive Sum: ${positiveSum}, Taxable Base: ${regionalTaxableBase}`);

    let regionalTotalTax = 0;
    let taxRate = 0;

    if (regionalTaxableBase > 0) {
      try {
        const regionalTaxResult = await taxService.calculateTax(
          client.client_id,
          regionalTaxableBase,
          Temporal.Now.plainDateISO().toString(), // Consider using invoice date if available
          region
        );
        regionalTotalTax = regionalTaxResult.taxAmount;
        taxRate = regionalTaxResult.taxRate;
        computedTotalInvoiceTax += regionalTotalTax;
        console.log(`[calculateAndDistributeTax] Region: ${region}, Calculated Tax: ${regionalTotalTax}, Rate: ${taxRate}`);
      } catch (error) {
        console.error(`Error calculating tax for region ${region}:`, error);
        // Decide how to handle tax calculation errors (e.g., skip region, throw error?)
        // For now, we'll skip tax calculation for this region if an error occurs.
        regionalTotalTax = 0;
        taxRate = 0;
      }
    } else {
      console.log(`[calculateAndDistributeTax] Region: ${region}, Taxable Base is 0 or less, skipping tax calculation.`);
    }

    // Distribute tax proportionally among taxable entities in the region
    let remainingTax = regionalTotalTax;
    // Sort entities by amount descending for consistent remainder allocation
    const sortedTaxableEntities = [...group.taxable].sort((a, b) => b.amount - a.amount);

    for (let i = 0; i < sortedTaxableEntities.length; i++) {
      const entity = sortedTaxableEntities[i];
      const isLastEntity = i === sortedTaxableEntities.length - 1;
      let entityTax = 0;

      // Calculate proportion only if there's a positive sum and tax to distribute
      if (positiveSum > 0 && regionalTotalTax > 0) {
        entityTax = isLastEntity
          ? remainingTax // Assign remainder to the last item
          : Math.floor((entity.amount / positiveSum) * regionalTotalTax);
      }

      remainingTax -= entityTax;
      entity.calculatedTax = entityTax; // Store calculated tax
      entity.taxRate = taxRate; // Store applied rate

      // Prepare updates based on entity type
      if (entity.type === 'fixed_detail') {
        detailUpdates.push({ item_detail_id: entity.id, tax_amount: entityTax, tax_rate: taxRate });
      } else { // type === 'item'
        itemTaxUpdates.push({ item_id: entity.id, tax_amount: entityTax, tax_rate: taxRate });
      }
    }
     console.log(`[calculateAndDistributeTax] Region: ${region}, Distributed tax. Detail Updates: ${group.taxable.filter(e => e.type === 'fixed_detail').length}, Item Updates: ${group.taxable.filter(e => e.type === 'item').length}`);
    // Sanity check for remainder after distribution
    if (remainingTax !== 0 && Math.abs(remainingTax) > 1) { // Allow ~1 cent rounding difference
      console.warn(`Tax distribution remainder issue in region ${region}. Remainder: ${remainingTax} cents.`);
      // Optional: Adjust the last item's tax slightly if needed, though floor/remainder should handle it.
    }
  }

  // 6. Update Detail and Item Tables (Tax Amounts)
  const updatePromises: Array<Promise<any>> = [];

  // Update fixed details tax amounts
  if (detailUpdates.length > 0) {
    for (const update of detailUpdates) {
      updatePromises.push(
        tx('invoice_item_fixed_details')
          .where({ item_detail_id: update.item_detail_id, tenant })
          .update({ tax_amount: update.tax_amount, tax_rate: update.tax_rate })
      );
    }
  }

  // Update regular items tax amounts (those that received tax)
  if (itemTaxUpdates.length > 0) {
    for (const update of itemTaxUpdates) {
      updatePromises.push(
        tx('invoice_items')
          .where({ item_id: update.item_id, tenant })
          .update({ tax_amount: update.tax_amount, tax_rate: update.tax_rate })
      );
      // This log was misplaced inside the loop, moving it after the loop in step 7
    }
  }

  // Execute tax amount updates before proceeding to consolidated item updates
  await Promise.all(updatePromises);

  // 7. Update Consolidated Items' Tax Amount by summing updated details
  const consolidatedUpdatePromises: Array<Promise<any>> = [];
  if (consolidatedItemIds.length > 0) {
      // Fetch the *updated* tax amounts from details
      const updatedDetailsTaxSum = await tx('invoice_item_fixed_details as iifd')
          .join('invoice_item_details as iid', function() {
              this.on('iid.item_detail_id', '=', 'iifd.item_detail_id')
                  .andOn('iid.tenant', '=', 'iifd.tenant');
          })
          .whereIn('iid.item_id', consolidatedItemIds)
          .andWhere('iid.tenant', tenant)
          .andWhere('iifd.tenant', tenant)
          .groupBy('iid.item_id')
          .select(
              'iid.item_id',
              tx.raw('SUM(iifd.tax_amount) as total_detail_tax')
          );
      console.log(`[calculateAndDistributeTax] Fetched updated tax sums for consolidated items:`, JSON.stringify(updatedDetailsTaxSum, null, 2)); // Log moved here

      for (const consolidated of updatedDetailsTaxSum) {
          consolidatedUpdatePromises.push(
              tx('invoice_items')
                  .where({ item_id: consolidated.item_id, tenant })
                  .update({ tax_amount: Number(consolidated.total_detail_tax || 0) }) // Update parent with sum
          );
      }
      // Execute consolidated item updates
      await Promise.all(consolidatedUpdatePromises);
      console.log(`[calculateAndDistributeTax] Updated tax_amount for ${consolidatedUpdatePromises.length} consolidated items.`);
  }

  // 8 & 9. Final Pass: Update total_price and apply final tax zeroing if needed
  const finalItemUpdatePromises: Array<Promise<any>> = [];
  // Fetch all items again to get potentially updated tax amounts (especially the consolidated ones from step 7)
  const allFinalItems = await tx('invoice_items')
    .where({ invoice_id: invoiceId, tenant })
    .select('*');

  for (const item of allFinalItems) {
      const netAmount = Number(item.net_amount || 0); // Net amount already reflects discounts
      let finalTax = Number(item.tax_amount || 0); // Tax amount reflects pre-discount calculation from steps 6/7
      let finalRate = Number(item.tax_rate || 0);

      // Zero out tax ONLY if item is explicitly marked non-taxable.
      // Discounts should already have 0 tax from distribution as they weren't in the taxable base.
      if (item.is_taxable === false) {
          finalTax = 0;
          finalRate = 0;
      }

      // Calculate final total price: (Net Amount including discount) + (Pre-discount Tax)
      const finalTotalPrice = netAmount + finalTax;

      // Prepare final update for this item
      finalItemUpdatePromises.push(
          tx('invoice_items')
              .where({ item_id: item.item_id, tenant })
              .update({
                  tax_amount: finalTax, // Persist the final tax amount (pre-discount, or 0 if non-taxable)
                  tax_rate: finalRate,   // Persist the final tax rate
                  total_price: finalTotalPrice // Persist the final total price
              })
      );
  }
  // Execute final updates for all items
  await Promise.all(finalItemUpdatePromises);
  console.log(`[calculateAndDistributeTax] Completed final pass updates for ${finalItemUpdatePromises.length} items.`);

  // 10. Return total calculated tax for the invoice
  // Recalculate from the final state of invoice_items for definitive total
  const finalTaxSumResult = await tx('invoice_items')
    .where({ invoice_id: invoiceId, tenant })
    .sum('tax_amount as totalTax')
    .first();

  const finalTotalTax = Number(finalTaxSumResult?.totalTax || 0);
  console.log(`[calculateAndDistributeTax] Finished. Final calculated total tax for invoice ${invoiceId}: ${finalTotalTax}`);
  return finalTotalTax;
}


export async function updateInvoiceTotalsAndRecordTransaction(
  tx: Knex.Transaction,
  invoiceId: string,
  client: any,
  // subtotal and computedTotalTax are now calculated implicitly by summing items
  tenant: string,
  invoiceNumber: string,
  expirationDate?: string,
  options: {
    transactionType?: TransactionType;
    description?: string;
  } = {}
): Promise<void> {
  const {
    transactionType = 'invoice_generated',
    description
  } = options;

  // Recalculate totals directly from the updated invoice items
  const finalItems = await tx('invoice_items').where({ invoice_id: invoiceId, tenant });
  const finalSubtotal = finalItems.reduce((sum, item) => sum + Number(item.net_amount), 0);
  const finalTotalTax = finalItems.reduce((sum, item) => sum + Number(item.tax_amount), 0);
  const finalTotalAmount = finalSubtotal + finalTotalTax;


  // Update invoice with final totals
  await tx('invoices')
    .where({ invoice_id: invoiceId, tenant })
    .update({
      subtotal: Math.round(finalSubtotal), // Use Math.round for final cents
      tax: Math.round(finalTotalTax),
      total_amount: Math.round(finalTotalAmount)
    });

  // Get current balance
  const currentBalance = await tx('transactions')
    .where({
      client_id: client.client_id,
      tenant
    })
    .orderBy('created_at', 'desc')
    .first()
    .then(lastTx => lastTx?.balance_after || 0);

  // Record transaction
  await tx('transactions').insert({
    transaction_id: uuidv4(),
    client_id: client.client_id,
    invoice_id: invoiceId,
    amount: Math.round(finalTotalAmount), // Use rounded final amount
    type: transactionType,
    status: 'completed',
    description: description ?? (transactionType === 'invoice_generated'
      ? `Generated invoice ${invoiceNumber}`
      : `Adjusted invoice ${invoiceNumber}`),
    created_at: Temporal.Now.instant().toString(),
    tenant,
    balance_after: currentBalance + Math.round(finalTotalAmount), // Use rounded final amount
    expiration_date: expirationDate
  });
}
