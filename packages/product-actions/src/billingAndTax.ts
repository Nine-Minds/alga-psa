'use server'

import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from '@server/lib/db';
import { ISO8601String } from 'server/src/types/types.d';
import { toPlainDate, toISODate } from '@server/lib/utils/dateTimeUtils';
import { withTransaction } from '@alga-psa/shared/db';
import {
    IBillingCharge,
    IBucketCharge,
    IUsageBasedCharge,
    ITimeBasedCharge,
    IFixedPriceCharge,
    BillingCycleType,
    IClientContractLineCycle
} from 'server/src/interfaces/billing.interfaces';
import { TaxService } from '@server/lib/services/taxService';
import { ITaxCalculationResult } from 'server/src/interfaces/tax.interfaces';
import { BillingEngine } from '@server/lib/billing/billingEngine'; // Needed for getAvailableBillingPeriods

// Type Guards
export async function isFixedPriceCharge(charge: IBillingCharge): Promise<boolean> {
    return charge.type === 'fixed';
}

export async function isTimeBasedCharge(charge: IBillingCharge): Promise<boolean> {
    return charge.type === 'time';
}

export async function isUsageBasedCharge(charge: IBillingCharge): Promise<boolean> {
    return charge.type === 'usage';
}

export async function isBucketCharge(charge: IBillingCharge): Promise<boolean> {
    return charge.type === 'bucket';
}

// Charge Helpers
export async function getChargeQuantity(charge: IBillingCharge): Promise<number> {
    // Need to await the results of the async type guards
    if (await isBucketCharge(charge)) return (charge as IBucketCharge).overageHours;
    if (await isFixedPriceCharge(charge) || await isUsageBasedCharge(charge)) return (charge as IFixedPriceCharge | IUsageBasedCharge).quantity ?? 0; // Handle potential undefined quantity
    if (await isTimeBasedCharge(charge)) return (charge as ITimeBasedCharge).duration ?? 0; // Handle potential undefined duration
    return 1;
}

export async function getChargeUnitPrice(charge: IBillingCharge): Promise<number> {
    // Need to await the result of the async type guard
    if (await isBucketCharge(charge)) return (charge as IBucketCharge).overageRate;
    return charge.rate;
}

/**
 * Gets the tax rate for a given region and date.
 * Uses the business rule for date ranges where:
 * - start_date is inclusive (>=)
 * - end_date is exclusive (>)
 * This ensures that when one tax rate ends and another begins,
 * there is no overlap or gap in coverage.
 */
export async function getClientTaxRate(taxRegion: string, date: ISO8601String): Promise<number> {
    const { knex, tenant } = await createTenantKnex();
    const taxRates = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('tax_rates')
            .where({
                region_code: taxRegion, // Changed from region
                tenant
            })
            .andWhere('start_date', '<=', date)
            .andWhere(function () {
                this.whereNull('end_date')
                    .orWhere('end_date', '>', date);
            })
            .select('tax_percentage');
    });

    // Parse the string percentage from DB and ensure numerical addition
    const totalTaxRate = taxRates.reduce((sum, rate) => sum + parseFloat(rate.tax_percentage), 0);
    return totalTaxRate;
}

export async function getAvailableBillingPeriods(): Promise<(IClientContractLineCycle & {
    client_name: string;
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
        const availablePeriods = await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await trx('client_billing_cycles as cbc')
                .join('clients as c', function () {
                    this.on('c.client_id', '=', 'cbc.client_id')
                        .andOn('c.tenant', '=', 'cbc.tenant');
                })
                .leftJoin('invoices as i', function () {
                    this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id')
                        .andOn('i.tenant', '=', 'cbc.tenant');
                })
                .where('cbc.tenant', tenant)
                .whereNotNull('cbc.period_end_date')
                .whereNull('i.invoice_id')
                .select(
                    'cbc.client_id',
                    'c.client_name',
                    'cbc.billing_cycle_id',
                    'cbc.billing_cycle',
                    'cbc.period_start_date',
                    'cbc.period_end_date',
                    'cbc.effective_date',
                    'cbc.tenant'
                );
        });

        console.log(`Found ${availablePeriods.length} available billing periods`);

        // For each period, calculate the total unbilled amount
        console.log('Calculating unbilled amounts for each period');
        const periodsWithTotals = await Promise.all(availablePeriods.map(async (period): Promise<IClientContractLineCycle & {
            client_name: string;
            total_unbilled: number;
            period_start_date: ISO8601String;
            period_end_date: ISO8601String;
            can_generate: boolean;
            is_early: boolean;
        }> => {
            try {
                console.log(`Processing period for client: ${period.client_name} (${period.client_id})`);
                console.log(`Period dates: ${period.period_start_date} to ${period.period_end_date}`);

                // Ensure we have valid dates before proceeding
                if (!period.period_start_date || !period.period_end_date) {
                    console.error(`Invalid dates for client ${period.client_name}: start=${period.period_start_date}, end=${period.period_end_date}`);
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
                        period.client_id,
                        period.period_start_date,
                        period.period_end_date,
                        period.billing_cycle_id
                    );
                    total_unbilled = billingResult.charges.reduce((sum, charge) => sum + charge.total, 0);
                } catch (_error) {
                    console.log(`No billable charges for client ${period.client_name} (${period.client_id})`);
                }

                console.log(`Total unbilled amount for ${period.client_name}: ${total_unbilled}`);

                // Allow generation of invoices even if period hasn't ended
                const can_generate = true;

                // Convert dates using our utility functions with error handling
                let periodEndDate;
                try {
                    periodEndDate = toPlainDate(period.period_end_date);
                } catch (error) {
                    console.error(`Error converting period_end_date for client ${period.client_name}:`, error);
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
                console.error(`Error processing period for client ${period.client_name}:`, error);
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

export async function getPaymentTermDays(paymentTerms: string): Promise<number> {
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

export async function getDueDate(clientId: string, billingEndDate: ISO8601String): Promise<ISO8601String> {
    const { knex, tenant } = await createTenantKnex();
    const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('clients')
            .where({
                client_id: clientId,
                tenant
            })
            .select('payment_terms')
            .first();
    });

    const paymentTerms = client?.payment_terms || 'net_30';
    const days = await getPaymentTermDays(paymentTerms); // Await the async function
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
export async function getNextBillingDate(clientId: string, currentEndDate: ISO8601String): Promise<ISO8601String> {
    const { knex, tenant } = await createTenantKnex();
    const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('client_billing_cycles')
            .where({
                client_id: clientId,
                tenant
            })
            .select('billing_cycle')
            .first();
    });

    const billingCycle = (client?.billing_cycle || 'monthly') as BillingCycleType;

    // Convert to PlainDate for consistent date arithmetic
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

    // Return a PlainDate ISO string (YYYY-MM-DD) instead of a timestamp
    // This avoids timezone issues when parsing later
    return toISODate(nextDate);
}

export async function calculatePreviewTax(
    charges: IBillingCharge[],
    clientId: string,
    cycleEnd: ISO8601String,
    defaultTaxRegion: string
): Promise<number> {
    const taxService = new TaxService();
    let totalTax = 0;

    // Calculate tax only on positive taxable amounts before discounts
    for (const charge of charges) {
        if (charge.is_taxable && charge.total > 0) {
            const taxResult = await taxService.calculateTax(
                clientId,
                charge.total,
                cycleEnd,
                charge.tax_region || defaultTaxRegion,
                true // Assume preview doesn't apply discounts for tax calc? Check logic.
            );
            totalTax += taxResult.taxAmount;
        }
    }

    return totalTax;
}

export async function calculateChargeDetails(
    charge: IBillingCharge,
    clientId: string,
    endDate: ISO8601String,
    taxService: TaxService,
    defaultTaxRegion: string
): Promise<{ netAmount: number; taxCalculationResult: ITaxCalculationResult }> {
    let netAmount: number;

    // Use type guards to access specific properties safely
    // Need to await the result of the async type guard
    if (await isBucketCharge(charge)) {
        netAmount = (charge as IBucketCharge).overageHours > 0 ? Math.ceil(charge.total) : 0;
    } else {
        netAmount = Math.ceil(charge.total);
    }

    // Calculate tax only for taxable items with positive amounts
    const taxCalculationResult = charge.is_taxable !== false && netAmount > 0
        ? await taxService.calculateTax(
            clientId,
            netAmount,
            endDate,
            charge.tax_region || defaultTaxRegion
            // Removed the 'applyDiscount' flag, assuming default behavior is correct here
        )
        : { taxAmount: 0, taxRate: 0 };

    return { netAmount, taxCalculationResult };
}
// Interface for Payment Term options
export interface IPaymentTermOption {
  id: string; // e.g., 'net_15', 'net_30'
  name: string; // e.g., 'Net 15', 'Net 30'
}

/**
 * Fetches the list of available payment terms.
 * TODO: Implement actual logic - query a table or return a predefined list.
 */
export async function getPaymentTermsList(): Promise<IPaymentTermOption[]> {
  console.log(`[Billing Action] Fetching available payment terms list.`);

  try {
    // Although payment terms might be global, we use createTenantKnex
    // as it's the standard way to get a Knex instance here.
    // If the table IS tenant-specific, a tenant filter would be added.
    const { knex } = await createTenantKnex();

    const terms = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('payment_terms')
        .select('term_code as id', 'term_name as name')
        // Assuming an 'is_active' flag exists for filtering relevant terms
        .where({ is_active: true })
        // Assuming a 'sort_order' column exists for consistent ordering
        .orderBy('sort_order', 'asc');
    });

    console.log(`[Billing Action] Found ${terms.length} active payment terms.`);
    return terms;
  } catch (error) {
    console.error('[Billing Action] Error fetching payment terms:', error);
    // Depending on requirements, might return empty array or re-throw
    // Returning empty for now to avoid breaking UI if DB call fails
    return [];
  }
}