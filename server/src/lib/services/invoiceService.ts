import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from 'server/src/lib/db';
import { getServerSession } from 'next-auth/next';
import { options } from 'server/src/app/api/auth/[...nextauth]/options';
import { v4 as uuidv4 } from 'uuid';
import { TaxService } from 'server/src/lib/services/taxService';
import { generateInvoiceNumber } from 'server/src/lib/actions/invoiceGeneration';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import { InvoiceViewModel, IInvoiceItem, NetAmountItem, DiscountType } from 'server/src/interfaces/invoice.interfaces';
import { Knex } from 'knex';
import { Session } from 'next-auth';
import { ISO8601String } from 'server/src/types/types.d';

interface InvoiceContext {
  session: Session;
  knex: Knex;
  tenant: string;
}

export async function validateSessionAndTenant(): Promise<InvoiceContext> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }
  return { session, knex, tenant };
}

export async function getCompanyDetails(knex: Knex, tenant: string, companyId: string) {
  const company = await knex('companies')
    .where({ 
      company_id: companyId, 
      tenant 
    })
    .first();
  if (!company) {
    throw new Error(`Company not found for tenant ${tenant}`);
  }
  return company;
}



export function calculateNetAmount(
  requestItem: NetAmountItem,
  currentSubtotal: number,
  applicableItemAmount?: number
): number {
  if (requestItem.is_discount) {
    if (requestItem.discount_type === 'percentage') {
      // For percentage discounts, if an applicable item is referenced, use its net amount
      // otherwise, use current subtotal
      const applicableAmount = requestItem.applies_to_item_id
        ? (applicableItemAmount || 0)
        : currentSubtotal;
      
      // Use discount_percentage if available, otherwise fall back to rate
      const percentage = requestItem.discount_percentage !== undefined
        ? requestItem.discount_percentage
        : Math.abs(requestItem.rate);
      
      console.log('Calculating percentage discount:', {
        applicableAmount,
        percentage,
        result: -Math.round((applicableAmount * percentage) / 100)
      });
        
      return -Math.round((applicableAmount * percentage) / 100);
    } else {
      // Fixed amount discount - ensure it's always negative
      console.log('Calculating fixed discount:', {
        rate: requestItem.rate,
        result: -Math.abs(Math.round(requestItem.rate))
      });
      
      return -Math.abs(Math.round(requestItem.rate));
    }
  } else {
    // Regular line item
    return Math.round(requestItem.quantity * requestItem.rate);
  }
}

interface InvoiceItem extends NetAmountItem {
  service_id: string;
  description: string;
  tax_region?: string;
  is_taxable?: boolean;
  applies_to_service_id?: string; // Add the new field
  discount_percentage?: number;
}

export async function persistInvoiceItems(
  tx: Knex.Transaction,
  invoiceId: string,
  items: InvoiceItem[],
  company: any,
  session: Session,
  tenant: string,
  isManual: boolean
): Promise<number> {
  let subtotal = 0;
  
  // Create a map to store service_id -> item_id mappings
  const serviceToItemMap = new Map<string, string>();
  
  // First pass: Process all non-discount items
  const nonDiscountItems = items.filter(item => !item.is_discount);
  
  for (const requestItem of nonDiscountItems) {
    // Get service details for tax info if service_id is provided
    let service;
    if (requestItem.service_id) {
      try {
        service = await tx('service_catalog')
          .where({
            service_id: requestItem.service_id,
            tenant
          })
          .first();
      } catch (error) {
        throw new Error(`Invalid service ID: ${requestItem.service_id}`);
      }
    }

    // For non-discount items, we don't need to look up applicable amounts
    const netAmount = calculateNetAmount(requestItem, subtotal);

    // Detect manual discounts (negative rate and no service_id)
    const isDiscount = !requestItem.service_id && requestItem.rate < 0;
    
    const invoiceItem = {
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: requestItem.service_id ? requestItem.service_id : null,
      description: requestItem.description,
      quantity: requestItem.quantity,
      unit_price: isDiscount ? -Math.abs(Math.round(requestItem.rate)) : Math.round(requestItem.rate),
      net_amount: netAmount,
      tax_amount: 0, // Will be updated after calculating total tax
      tax_region: service?.tax_region || company.tax_region,
      tax_rate: 0, // Will be updated after calculating total tax
      total_price: netAmount, // Will be updated after calculating total tax
      is_manual: isManual,
      is_discount: isDiscount || requestItem.is_discount || false,
      is_taxable: (isDiscount || requestItem.is_discount) ? false : (service ? service.is_taxable !== false : true),
      discount_type: isDiscount ? 'fixed' : requestItem.discount_type,
      applies_to_item_id: requestItem.applies_to_item_id,
      applies_to_service_id: requestItem.applies_to_service_id,
      created_by: session.user.id,
      created_at: Temporal.Now.plainDateISO().toString(),
      tenant
    };

    // Verify service exists if service_id is provided
    if (requestItem.service_id) {
      const exists = await tx('service_catalog')
        .where({
          service_id: requestItem.service_id,
          tenant
        })
        .first();

      if (!exists) {
        throw new Error(`Service not found: ${requestItem.service_id}`);
      }
      
      // Store the mapping of service_id to item_id for later use
      serviceToItemMap.set(requestItem.service_id, invoiceItem.item_id);
    }

    try {
      await tx('invoice_items').insert(invoiceItem);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to create invoice item: ${message}`);
    }

    subtotal += netAmount;
  }
  
  // Second pass: Process discount items and resolve service references
  const discountItems = items.filter(item => item.is_discount);
  
  for (const requestItem of discountItems) {
    // Resolve applies_to_service_id to applies_to_item_id if provided
    let applicableItemId = requestItem.applies_to_item_id;
    
    if (requestItem.applies_to_service_id && !applicableItemId) {
      applicableItemId = serviceToItemMap.get(requestItem.applies_to_service_id);
      
      if (!applicableItemId) {
        throw new Error(`Could not find invoice item for service: ${requestItem.applies_to_service_id}`);
      }
    }
    
    // Get applicable item amount for percentage discounts
    let applicableAmount;
    if (applicableItemId) {
      const applicableItem = await tx('invoice_items')
        .where({
          item_id: applicableItemId,
          tenant
        })
        .first();
      applicableAmount = applicableItem?.net_amount;
    }
    
    // Calculate net amount with the resolved applicable item ID
    const netAmount = calculateNetAmount(
      { ...requestItem, applies_to_item_id: applicableItemId },
      subtotal,
      applicableAmount
    );
    
    // Get service details for tax info if service_id is provided
    let service;
    if (requestItem.service_id) {
      try {
        service = await tx('service_catalog')
          .where({
            service_id: requestItem.service_id,
            tenant
          })
          .first();
      } catch (error) {
        throw new Error(`Invalid service ID: ${requestItem.service_id}`);
      }
    }
    
    // Log the discount details before creating the invoice item
    console.log('Creating discount invoice item:', {
      discount_type: requestItem.discount_type,
      discount_percentage: requestItem.discount_percentage,
      rate: requestItem.rate,
      netAmount,
      applies_to_item_id: applicableItemId
    });
    
    const invoiceItem = {
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: requestItem.service_id ? requestItem.service_id : null,
      description: requestItem.description,
      quantity: requestItem.quantity,
      unit_price: requestItem.discount_type === 'percentage' ? 0 : -Math.abs(Math.round(requestItem.rate)),
      net_amount: netAmount,
      tax_amount: 0, // Discounts don't get tax
      tax_region: service?.tax_region || company.tax_region,
      tax_rate: 0,
      total_price: netAmount,
      is_manual: isManual,
      is_discount: true,
      is_taxable: false, // Discounts are not taxable
      discount_type: requestItem.discount_type || 'fixed',
      discount_percentage: requestItem.discount_type === 'percentage' ? requestItem.discount_percentage : undefined,
      applies_to_item_id: applicableItemId,
      applies_to_service_id: requestItem.applies_to_service_id,
      created_by: session.user.id,
      created_at: Temporal.Now.plainDateISO().toString(),
      tenant
    };
    
    console.log('Final invoice item to be inserted:', {
      item_id: invoiceItem.item_id,
      discount_type: invoiceItem.discount_type,
      discount_percentage: invoiceItem.discount_percentage,
      unit_price: invoiceItem.unit_price,
      net_amount: invoiceItem.net_amount
    });
    
    try {
      await tx('invoice_items').insert(invoiceItem);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to create discount item: ${message}`);
    }
    
    subtotal += netAmount;
  }

  return subtotal;
}

export async function calculateAndDistributeTax(
  tx: Knex.Transaction,
  invoiceId: string,
  company: any,
  subtotal: number,
  taxService: TaxService
): Promise<number> {
  // Get invoice items
  const invoiceItems = await tx('invoice_items')
    .where({ invoice_id: invoiceId })
    .orderBy('created_at', 'asc');

  // Get items that should be taxed (positive amounts and taxable)
  // Note: Discounts (is_discount=true) are already marked as non-taxable (is_taxable=false)
  const taxableItems = invoiceItems.filter(item =>
    Number(item.net_amount) > 0 &&
    item.is_taxable === true
  );

  // Get credit items (negative amounts that are NOT discounts)
  // These should reduce the taxable base
  const creditItems = invoiceItems.filter(item =>
    Number(item.net_amount) < 0 &&
    item.is_discount !== true
  );

  // Set tax to zero for all other items
  const nonTaxableItems = invoiceItems.filter(item =>
    !taxableItems.find(t => t.item_id === item.item_id)
  );

  for (const item of nonTaxableItems) {
    await tx('invoice_items')
      .where({ item_id: item.item_id })
      .update({
        tax_amount: 0,
        tax_rate: 0,
        total_price: Number(item.net_amount)
      });
  }

  let computedTotalTax = 0;

  if (taxableItems.length > 0) {
    // Group taxable items by tax region
    const groups = taxableItems.reduce<Record<string, IInvoiceItem[]>>((acc, item) => {
      const region = item.tax_region || company.tax_region;
      if (!acc[region]) {
        acc[region] = [];
      }
      acc[region].push(item);
      return acc;
    }, {});

    // Group credit items by tax region
    const creditGroups = creditItems.reduce<Record<string, IInvoiceItem[]>>((acc, item) => {
      const region = item.tax_region || company.tax_region;
      if (!acc[region]) {
        acc[region] = [];
      }
      acc[region].push(item);
      return acc;
    }, {});

    // Process each tax region separately
    for (const [region, itemsInGroup] of Object.entries(groups)) {
      // Calculate total taxable amount for this region
      const groupTaxableAmount = itemsInGroup.reduce((sum, item) =>
        sum + Number(item.net_amount), 0
      );

      // Calculate total credit amount for this region
      const regionCreditItems = creditGroups[region] || [];
      const creditAmount = regionCreditItems.reduce((sum, item) =>
        sum + Math.abs(Number(item.net_amount)), 0
      );

      // Adjust taxable amount by subtracting credits
      const adjustedTaxableAmount = Math.max(0, groupTaxableAmount - creditAmount);

      // Calculate tax for the adjusted group amount
      const groupTaxResult = await taxService.calculateTax(
        company.company_id,
        adjustedTaxableAmount,
        Temporal.Now.plainDateISO().toString(),
        region
      );

      // Sort items by amount for consistent distribution
      const sortedItems = [...itemsInGroup].sort((a, b) =>
        Number(b.net_amount) - Number(a.net_amount)
      );

      // Distribute tax proportionally
      let remainingTax = groupTaxResult.taxAmount;
      for (let i = 0; i < sortedItems.length; i++) {
        const item = sortedItems[i];
        const netAmt = Number(item.net_amount);
        const isLastItem = i === sortedItems.length - 1;

        // Calculate this item's share of tax
        const itemTax = isLastItem
          ? remainingTax  // Last item gets remaining tax
          : Math.floor((netAmt / groupTaxableAmount) * groupTaxResult.taxAmount);

        remainingTax -= itemTax;
        computedTotalTax += itemTax;

        // Update item with tax details
        await tx('invoice_items')
          .where({ item_id: item.item_id })
          .update({
            tax_amount: itemTax,
            tax_rate: groupTaxResult.taxRate,
            total_price: netAmt + itemTax
          });
      }
    }
  }

  return computedTotalTax;
}

export async function updateInvoiceTotalsAndRecordTransaction(
  tx: Knex.Transaction,
  invoiceId: string,
  company: any,
  subtotal: number,
  computedTotalTax: number,
  tenant: string,
  invoiceNumber: string,
  expirationDate?: string
): Promise<void> {
  // Update invoice with totals
  await tx('invoices')
    .where({ invoice_id: invoiceId })
    .update({
      subtotal: Math.ceil(subtotal),
      tax: Math.ceil(computedTotalTax),
      total_amount: Math.ceil(subtotal + computedTotalTax)
    });

  // Get current balance
  const currentBalance = await tx('transactions')
    .where({
      company_id: company.company_id,
      tenant
    })
    .orderBy('created_at', 'desc')
    .first()
    .then(lastTx => lastTx?.balance_after || 0);

  // Record transaction
  await tx('transactions').insert({
    transaction_id: uuidv4(),
    company_id: company.company_id,
    invoice_id: invoiceId,
    amount: Math.ceil(subtotal + computedTotalTax),
    type: 'invoice_generated',
    status: 'completed',
    description: `Generated invoice ${invoiceNumber}`,
    created_at: Temporal.Now.plainDateISO().toString(),
    tenant,
    balance_after: currentBalance + Math.ceil(subtotal + computedTotalTax),
    expiration_date: expirationDate
  });
}