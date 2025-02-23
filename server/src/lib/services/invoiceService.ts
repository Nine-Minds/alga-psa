import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { options } from '@/app/api/auth/[...nextauth]/options';
import { v4 as uuidv4 } from 'uuid';
import { TaxService } from '@/lib/services/taxService';
import { generateInvoiceNumber } from '@/lib/actions/invoiceActions';
import { BillingEngine } from '@/lib/billing/billingEngine';
import { InvoiceViewModel, IInvoiceItem, DiscountType } from '@/interfaces/invoice.interfaces';
import { Knex } from 'knex';
import { Session } from 'next-auth';
import { ISO8601String } from '@/types/types.d';

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

interface NetAmountItem {
  quantity: number;
  rate: number;
  is_discount?: boolean;
  discount_type?: DiscountType;
  applies_to_item_id?: string;
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
      return -Math.round((applicableAmount * requestItem.rate) / 100);
    } else {
      // Fixed amount discount
      return -Math.round(requestItem.rate);
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

  for (const requestItem of items) {
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

    // Calculate net amount considering any applicable item amount for percentage discounts
    let applicableAmount;
    if (requestItem.applies_to_item_id) {
      const applicableItem = await tx('invoice_items')
        .where({ 
          item_id: requestItem.applies_to_item_id,
          tenant 
        })
        .first();
      applicableAmount = applicableItem?.net_amount;
    }

    const netAmount = calculateNetAmount(requestItem, subtotal, applicableAmount);

    const invoiceItem = {
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: requestItem.service_id,
      description: requestItem.description,
      quantity: requestItem.quantity,
      unit_price: requestItem.is_discount ? -Math.abs(Math.round(requestItem.rate)) : Math.round(requestItem.rate),
      net_amount: netAmount,
      tax_amount: 0, // Will be updated after calculating total tax
      tax_region: service?.tax_region || company.tax_region,
      tax_rate: 0, // Will be updated after calculating total tax
      total_price: netAmount, // Will be updated after calculating total tax
      is_manual: isManual,
      is_discount: requestItem.is_discount || false,
      discount_type: requestItem.discount_type,
      applies_to_item_id: requestItem.applies_to_item_id,
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
    }

    try {
      await tx('invoice_items').insert(invoiceItem);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to create invoice item: ${message}`);
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

  // Calculate the overall taxable base (ensuring it's non-negative)
  const overallTaxableAmount = Math.max(subtotal, 0);

  // Separate positive items (net_amount > 0) from non-positive items
  const positiveItems = invoiceItems.filter(item => Number(item.net_amount) > 0);
  const nonPositiveItems = invoiceItems.filter(item => Number(item.net_amount) <= 0);

  // For non-positive items, tax should be zero
  for (const item of nonPositiveItems) {
    await tx('invoice_items')
      .where({ item_id: item.item_id })
      .update({
        tax_amount: 0,
        tax_rate: 0,  // No tax rate applied for zero/negative items
        total_price: Number(item.net_amount)
      });
  }

  let computedTotalTax = 0;

  // If there are no positive items, we can skip tax calculation entirely
  if (positiveItems.length > 0) {
    // Sum all positive net amounts to determine the full base before considering discounts
    const totalPositiveAmount = positiveItems.reduce((sum, item) => sum + Number(item.net_amount), 0);

    // The discount factor adjusts for the negative items' effect on the taxable base
    const discountFactor = overallTaxableAmount / totalPositiveAmount;

    // Group positive invoice items by their tax region
    const groups = positiveItems.reduce<Record<string, IInvoiceItem[]>>((acc, item) => {
      const region = item.tax_region || company.tax_region;
      if (!acc[region]) {
        acc[region] = [];
      }
      acc[region].push(item);
      return acc;
    }, {});

    // Process each tax region group separately
    for (const [region, itemsInGroup] of Object.entries(groups)) {
      // Sum net amounts for this group
      const groupPositiveAmount = itemsInGroup.reduce((sum, item) => 
        sum + Number(item.net_amount), 0);
      
      // Compute the effective taxable amount for the group after applying the discount factor
      const effectiveTaxableAmount = Math.round(groupPositiveAmount * discountFactor);

      // Calculate tax for this group using its effective taxable base and tax region
      const groupTaxResult = await taxService.calculateTax(
        company.company_id,
        effectiveTaxableAmount,
        Temporal.Now.plainDateISO().toString(),
        region
      );

      // Sort items by net amount (highest to lowest) for consistent tax distribution
      itemsInGroup.sort((a, b) => Number(b.net_amount) - Number(a.net_amount));

      // Set up a remaining tax accumulator for proportional distribution
      let remainingGroupTax = groupTaxResult.taxAmount;

      // Distribute the computed group tax among the group's items
      for (let i = 0; i < itemsInGroup.length; i++) {
        const item = itemsInGroup[i];
        const netAmt = Number(item.net_amount);
        const isLastInGroup = (i === itemsInGroup.length - 1);
        
        let itemTax = 0;
        if (isLastInGroup) {
          // Assign all remaining tax to the last item to correct any rounding discrepancies
          itemTax = remainingGroupTax;
        } else {
          // Calculate proportional tax allocation for the item, rounding down
          itemTax = Math.floor((netAmt / groupPositiveAmount) * groupTaxResult.taxAmount);
          remainingGroupTax -= itemTax;
        }

        computedTotalTax += itemTax;

        // Update the invoice item with its tax details
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
  invoiceNumber: string
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
    balance_after: currentBalance + Math.ceil(subtotal + computedTotalTax)
  });
}