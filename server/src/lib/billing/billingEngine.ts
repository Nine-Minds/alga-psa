import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import {
  IBillingPeriod,
  IBillingResult,
  IBillingCharge,
  IClientContractLine,
  IBucketUsage,
  IBucketCharge,
  IDiscount,
  IAdjustment,
  IUsageBasedCharge,
  ITimeBasedCharge,
  IFixedPriceCharge,
  IProductCharge,
  ILicenseCharge,
  IClientContractLineCycle,
  BillingCycleType
} from 'server/src/interfaces/billing.interfaces';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IContractLineServiceRateTier
} from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
// Use the Temporal polyfill for all date arithmetic and plain‐date handling
import { Temporal } from '@js-temporal/polyfill';
import { ISO8601String } from 'server/src/types/types.d';
import { getNextBillingDate } from 'server/src/lib/actions/billingAndTax'; // Removed getClientTaxRate
import { toPlainDate, toISODate } from 'server/src/lib/utils/dateTimeUtils';
import { getClientById } from 'server/src/lib/actions/client-actions/clientActions';
import { IClient } from 'server/src/interfaces';
import { get } from 'http';
// Removed TaxService import as it's no longer directly used here
// Import necessary functions from invoiceService
import { calculateAndDistributeTax, updateInvoiceTotalsAndRecordTransaction, getClientDetails } from 'server/src/lib/services/invoiceService';
import { v4 as uuidv4 } from 'uuid';
import { getClientDefaultTaxRegionCode } from 'server/src/lib/actions/client-actions/clientTaxRateActions'; // Import the correct lookup function
import ContractLineFixedConfig from 'server/src/lib/models/contractLineFixedConfig'; // Added import for new model
import { string, number } from 'zod';
import contractLine from '../models/contractLine';
import service from '../models/service';
import { TaxService } from '../services/taxService';
import { ClientContractServiceConfigurationService } from '../services/clientContractServiceConfigurationService';
// Workflow imports removed as event emission is moved back to the calling action

export class BillingEngine {
  private knex: Knex;
  private tenant: string | null;

  constructor() {
    this.knex = null as any;
    this.tenant = null;
  }

  private async initKnex() {
    if (!this.knex) {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error("tenant context not found");
      }
      this.knex = knex;
      this.tenant = tenant;
    }
  }

  /**
   * Determines the tax region and taxability based on a service's tax_rate_id.
   * @param service - The service object, expected to have service_id and tax_rate_id.
   * @returns An object containing the taxRegion (string | null) and isTaxable (boolean).
   */
  private async getTaxInfoFromService(service: any): Promise<{ taxRegion: string | null, isTaxable: boolean }> {
    if (!this.knex || !this.tenant) {
      await this.initKnex(); // Ensure Knex is initialized
      if (!this.tenant) throw new Error("Tenant context not found in getTaxInfoFromService");
    }

    // Default values if no service is provided or found
    if (!service) {
      console.warn("[getTaxInfoFromService] No service object provided.");
      return { taxRegion: null, isTaxable: false }; // Assuming non-taxable if no service context
    }

    if (service.tax_rate_id) {
      try {
        const taxRateInfo = await this.knex('tax_rates')
          .where({ tax_rate_id: service.tax_rate_id, tenant: this.tenant })
          // TODO: Add validity checks if needed (e.g., is_active, date range matching billing period)
          .select('region_code')
          .first();

        if (taxRateInfo && taxRateInfo.region_code) {
          // Valid tax_rate_id found, service is taxable in this region
          return { taxRegion: taxRateInfo.region_code, isTaxable: true };
        } else {
          // tax_rate_id exists but doesn't link to a valid/active rate? Treat as non-taxable.
          console.warn(`[getTaxInfoFromService] Service ${service.service_id} has tax_rate_id ${service.tax_rate_id} but no matching/valid tax_rate found in tenant ${this.tenant}. Treating as non-taxable.`);
          return { taxRegion: null, isTaxable: false };
        }
      } catch (error) {
        console.error(`[getTaxInfoFromService] Error fetching tax rate info for tax_rate_id ${service.tax_rate_id}:`, error);
        return { taxRegion: null, isTaxable: false }; // Treat as non-taxable on error
      }
    } else {
      // Service exists but tax_rate_id is NULL, explicitly non-taxable
      return { taxRegion: null, isTaxable: false };
    }
  }

  // Removed getDefaultTaxRatePercentage function as it uses outdated logic
  // and tax calculation is now delegated to invoiceService.

  private async hasExistingInvoiceForCycle(clientId: string, billingCycleId: string): Promise<boolean> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const existingInvoice = await this.knex('invoices')
      .where({
        client_id: clientId,
        billing_cycle_id: billingCycleId,
        tenant: this.tenant
      })
      .first();
    return !!existingInvoice;
  }

  async calculateBilling(clientId: string, startDate: ISO8601String, endDate: ISO8601String, billingCycleId: string): Promise<IBillingResult & { error?: string }> {
    try {
      await this.initKnex();
      const client = await getClientById(clientId);
      console.log(`Calculating billing for client ${client?.client_name} (${clientId}) using billingCycleId: ${billingCycleId}`);

      // Fetch the specific billing cycle record
      const cycleRecord = await this.knex('client_billing_cycles')
        .where({
          billing_cycle_id: billingCycleId,
          client_id: clientId, // Ensure it matches the client
          tenant: this.tenant
        })
        .first();

      if (!cycleRecord) {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          error: `Billing cycle ${billingCycleId} not found for client ${clientId}`
        };
      }

      // Check for existing invoice in this billing cycle (using the fetched cycleRecord)
      const hasExistingInvoice = await this.hasExistingInvoiceForCycle(clientId, cycleRecord.billing_cycle_id);
      if (hasExistingInvoice) {
        // Return zero-amount billing result if already invoiced
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0
        };
      }

      // Determine billing period dates CONSISTENTLY
      let periodStartDate: ISO8601String;
      let periodEndDate: ISO8601String;

      if (cycleRecord.period_start_date && cycleRecord.period_end_date) {
        console.log(`Using period dates from cycle record: ${cycleRecord.period_start_date} to ${cycleRecord.period_end_date}`);
        // Ensure dates are in the correct plain date format before converting
        periodStartDate = toISODate(toPlainDate(cycleRecord.period_start_date));
        periodEndDate = toISODate(toPlainDate(cycleRecord.period_end_date));
      } else if (cycleRecord.effective_date) {
        console.log(`Calculating period dates from effective date: ${cycleRecord.effective_date}`);
        // Ensure effective_date is in the correct plain date format
        const effectivePlainDate = toPlainDate(cycleRecord.effective_date);
        periodStartDate = toISODate(effectivePlainDate); // Start date is the effective date
        // Need client billing frequency to calculate end date accurately
        // Use the cycle's effective date to determine the relevant frequency
        const clientContractLineFrequency = await this.getBillingCycle(clientId, periodStartDate);
        const nextBillingDate = await getNextBillingDate(clientId, periodStartDate); // Pass the determined start date
        // The end date is one day before the start of the next cycle
        periodEndDate = toISODate(toPlainDate(nextBillingDate).subtract({ days: 1 }));
        console.log(`Calculated period: ${periodStartDate} to ${periodEndDate}`);
      } else {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          error: `Billing cycle ${billingCycleId} has invalid dates (no period dates or effective date)`
        };
      }

      // Use the determined periodStartDate and periodEndDate consistently below
      const billingPeriod: IBillingPeriod = { startDate: periodStartDate, endDate: periodEndDate };
      console.log(`Consistent billing period: ${billingPeriod.startDate} to ${billingPeriod.endDate}`);


      // Validate that the billing period doesn't cross a cycle change
      const validationResult = await this.validateBillingPeriod(clientId, periodStartDate, periodEndDate);
      if (!validationResult.success) {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          error: validationResult.error
        };
      }

      // Initialize all variables we'll need throughout the function
      let totalCharges: IBillingCharge[] = [];

      // Get contract lines and cycle
      const plansResult = await this.getClientContractLinesAndCycle(clientId, billingPeriod);

      // Type assertion to include error property
      const { clientContractLines, billingCycle: cycle, error: plansError } = plansResult as {
        clientContractLines: IClientContractLine[];
        billingCycle: string;
        error?: string;
      };

      if (plansError) {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          error: plansError
        };
      }

      if (clientContractLines.length === 0) {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          error: `No active contract lines found for client ${clientId} in the given period`
        };
      }

      console.log(`Found ${clientContractLines.length} active contract line(s) for client ${clientId}`);
      console.log(`Billing cycle: ${cycle}`);

      for (const clientContractLine of clientContractLines) {
        console.log(`Processing contract line: ${clientContractLine.contract_line_name}`);
        const [
          fixedPriceCharges,
          timeBasedCharges,
          usageBasedCharges,
          bucketPlanCharges,
          productCharges,
          licenseCharges
        ] = await Promise.all([
          this.calculateFixedPriceCharges(clientId, billingPeriod, clientContractLine),
          this.calculateTimeBasedCharges(clientId, billingPeriod, clientContractLine),
          this.calculateUsageBasedCharges(clientId, billingPeriod, clientContractLine),
          this.calculateBucketPlanCharges(clientId, billingPeriod, clientContractLine),
          this.calculateProductCharges(clientId, billingPeriod, clientContractLine),
          this.calculateLicenseCharges(clientId, billingPeriod, clientContractLine)
        ]);

        console.log(`Fixed price charges: ${fixedPriceCharges.length}`);
        console.log(`Time-based charges: ${timeBasedCharges.length}`);
        console.log(`Usage-based charges: ${usageBasedCharges.length}`);
        console.log(`Bucket plan charges: ${bucketPlanCharges.length}`);
        console.log(`Product charges: ${productCharges.length}`);
        console.log(`License charges: ${licenseCharges.length}`);

        const totalBeforeProration = fixedPriceCharges.reduce((sum: number, charge: IFixedPriceCharge) => sum + charge.total, 0);
        console.log(`Total fixed charges before proration: $${(totalBeforeProration / 100).toFixed(2)} (${totalBeforeProration} cents)`);

        // Only prorate fixed price charges
        const proratedFixedCharges = this.applyProrationToPlan(fixedPriceCharges, billingPeriod, clientContractLine.start_date, clientContractLine.end_date, cycle);

        const totalAfterProration = proratedFixedCharges.reduce((sum: number, charge: IBillingCharge) => sum + charge.total, 0);
        console.log(`Total fixed charges after proration: $${(totalAfterProration / 100).toFixed(2)} (${totalAfterProration} cents)`);

        // Combine all charges without prorating time-based or usage-based charges
        totalCharges = totalCharges.concat(
          proratedFixedCharges,
          timeBasedCharges,
          usageBasedCharges,
          bucketPlanCharges,
          productCharges,
          licenseCharges
        );

        console.log('Total charges breakdown:');
        proratedFixedCharges.forEach((charge: IBillingCharge) => {
          console.log(`fixed - ${charge.serviceName}: $${(charge.total / 100).toFixed(2)}`);
        });
        timeBasedCharges.forEach((charge: ITimeBasedCharge) => {
          console.log(`hourly - ${charge.serviceName}: $${charge.total}`);
        });
        usageBasedCharges.forEach((charge: IUsageBasedCharge) => {
          console.log(`usage - ${charge.serviceName}: $${charge.total}`);
        });
        bucketPlanCharges.forEach((charge: IBucketCharge) => {
          console.log(`bucket - ${charge.serviceName}: $${charge.total}`);
        });
        productCharges.forEach((charge: IProductCharge) => {
          console.log(`product - ${charge.serviceName}: $${charge.total}`);
        });
        licenseCharges.forEach((charge: ILicenseCharge) => {
          console.log(`license - ${charge.serviceName}: $${charge.total}`);
        });

        console.log('Total charges:', totalCharges);
      }

      const totalAmount = totalCharges.reduce((sum: number, charge: IBillingCharge) => sum + charge.total, 0);

      const finalCharges = await this.applyDiscountsAndAdjustments(
        {
          charges: totalCharges,
          totalAmount,
          discounts: [],
          adjustments: [],
          finalAmount: totalAmount
        },
        clientId,
        billingPeriod
      );

      console.log(`Discounts applied: ${finalCharges.discounts.length}`);
      console.log(`Adjustments applied: ${finalCharges.adjustments.length}`);
      console.log(`Final amount after discounts and adjustments: $${(finalCharges.finalAmount / 100).toFixed(2)} (${finalCharges.finalAmount} cents)`);

      return finalCharges;
    } catch (err) {
      console.error('Error in calculateBilling:', err);
      return {
        charges: [],
        totalAmount: 0,
        discounts: [],
        adjustments: [],
        finalAmount: 0,
        error: err instanceof Error ? err.message : 'An error occurred while calculating billing'
      };
    }
  }

  private async getClientContractLinesAndCycle(clientId: string, billingPeriod: IBillingPeriod): Promise<{ clientContractLines: IClientContractLine[], billingCycle: string }> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }
    const knex = this.knex;
    if (!knex) {
      throw new Error('Database connection not initialized');
    }

    const client = await knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const billingCycle = await this.getBillingCycle(clientId, billingPeriod.startDate);
    const tenant = this.tenant; // Capture tenant value here

    const clientContractLines = await knex('client_contract_lines as ccl')
      .leftJoin('contract_lines as cl', (join) => {
        join
          .on(
            'cl.contract_line_id',
            '=',
            knex.raw('coalesce(ccl.contract_line_id, ccl.template_contract_line_id)')
          )
          .andOn('cl.tenant', '=', 'ccl.tenant');
      })
      .leftJoin('client_contracts as cc', function () {
        this.on('ccl.client_contract_id', '=', 'cc.client_contract_id')
          .andOn('cc.tenant', '=', 'ccl.tenant');
      })
      .leftJoin('contracts as c', (join) => {
        join
          .on('c.contract_id', '=', knex.raw('coalesce(cc.template_contract_id, cc.contract_id)'))
          .andOn('c.tenant', '=', 'cc.tenant');
      })
      .leftJoin('client_contract_line_pricing as pricing', function () {
        this.on('pricing.client_contract_line_id', '=', 'ccl.client_contract_line_id')
          .andOn('pricing.tenant', '=', 'ccl.tenant');
      })
      .leftJoin('client_contract_line_terms as terms', function () {
        this.on('terms.client_contract_line_id', '=', 'ccl.client_contract_line_id')
          .andOn('terms.tenant', '=', 'ccl.tenant');
      })
      .where({
        'ccl.client_id': clientId,
        'ccl.is_active': true,
        'ccl.tenant': this.tenant
      })
      .where('ccl.start_date', '<=', billingPeriod.endDate)
      .where(function (this: any) {
        this.where('ccl.end_date', '>=', billingPeriod.startDate).orWhereNull('ccl.end_date');
      })
      .select(
        'ccl.*',
        'cl.contract_line_name as template_contract_line_name',
        'cl.contract_line_type',
        'cl.billing_frequency as template_billing_frequency',
        'cl.billing_timing as template_billing_timing',
        'cl.custom_rate as contract_line_custom_rate',
        'cl.enable_proration as contract_line_enable_proration',
        'cl.billing_cycle_alignment as contract_line_billing_cycle_alignment',
        'cc.contract_id',
        'c.contract_name',
        'pricing.custom_rate as pricing_custom_rate',
        'terms.billing_frequency as term_billing_frequency',
        'terms.billing_timing as term_billing_timing'
      );

    // Convert dates from the DB into plain ISO strings using our date utilities
    clientContractLines.forEach((plan: any) => {
      plan.start_date = toISODate(toPlainDate(plan.start_date));
      plan.end_date = plan.end_date ? toISODate(toPlainDate(plan.end_date)) : null;
      plan.contract_line_name = plan.template_contract_line_name || plan.contract_line_name;
      plan.billing_frequency = plan.term_billing_frequency || plan.template_billing_frequency || plan.billing_frequency;
      const resolvedTiming = (plan.term_billing_timing ?? plan.template_billing_timing ?? plan.billing_timing ?? 'arrears') as 'arrears' | 'advance';
      plan.billing_timing = resolvedTiming;
      delete plan.term_billing_timing;
      delete plan.template_billing_timing;
      const pricingRate = plan.pricing_custom_rate;
      const contractLineRate = plan.contract_line_custom_rate;

      if (pricingRate !== null && pricingRate !== undefined) {
        const parsedRate = typeof pricingRate === 'string' ? parseFloat(pricingRate) : Number(pricingRate);
        plan.custom_rate = Number.isFinite(parsedRate) ? Math.round(parsedRate * 100) : null;
      } else if (contractLineRate !== null && contractLineRate !== undefined) {
        const parsedRate = typeof contractLineRate === 'string' ? parseFloat(contractLineRate) : Number(contractLineRate);
        plan.custom_rate = Number.isFinite(parsedRate) ? Math.round(parsedRate * 100) : null;
      } else {
        plan.custom_rate = null;
      }

      plan.enable_proration = plan.contract_line_enable_proration ?? plan.enable_proration ?? false;
      plan.billing_cycle_alignment =
        (plan.contract_line_billing_cycle_alignment as 'start' | 'end' | 'prorated' | undefined) ??
        plan.billing_cycle_alignment ??
        'start';

      delete plan.pricing_custom_rate;
      delete plan.contract_line_custom_rate;
      delete plan.contract_line_enable_proration;
      delete plan.contract_line_billing_cycle_alignment;
    });

    return { clientContractLines, billingCycle };
  }

  private async getBillingCycle(clientId: string, date: ISO8601String = toISODate(Temporal.Now.plainDateISO())): Promise<string> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const result = await this.knex('client_billing_cycles')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .where('effective_date', '<=', date)
      .orderBy('effective_date', 'desc')
      .first() as IClientContractLineCycle | undefined;

    if (!result) {
      // Check again for existing cycle to handle race conditions
      const existingCycle = await this.knex('client_billing_cycles')
        .where({
          client_id: clientId,
          tenant: this.tenant
        })
        .first();

      if (existingCycle) {
        return existingCycle.billing_cycle;
      }

      try {
        const defaultCycle: Partial<IClientContractLineCycle> = {
          client_id: clientId,
          billing_cycle: 'monthly',
          effective_date: '2023-01-01T00:00:00Z',
          tenant: this.tenant
        };

        await this.knex('client_billing_cycles').insert(defaultCycle);
      } catch (error) {
        // If insert fails due to race condition, get the existing record
        const cycle = await this.knex('client_billing_cycles')
          .where({
            client_id: clientId,
            tenant: this.tenant
          })
          .first();

        if (!cycle) {
          throw new Error(`Failed to create or retrieve billing cycle for client ${clientId} in tenant ${this.tenant}`);
        }

        return cycle.billing_cycle;
      }
      return 'monthly' as BillingCycleType;
    }

    return result.billing_cycle as BillingCycleType;
  }

  private async validateBillingPeriod(clientId: string, startDate: ISO8601String, endDate: ISO8601String): Promise<{ success: boolean; error?: string }> {
    try {
      await this.initKnex();
      if (!this.tenant) {
        return {
          success: false,
          error: "tenant context not found"
        };
      }

      const client = await this.knex('clients')
        .where({
          client_id: clientId,
          tenant: this.tenant
        })
        .first();
      if (!client) {
        return {
          success: false,
          error: `Client ${clientId} not found in tenant ${this.tenant}`
        };
      }

      const cycles = await this.knex('client_billing_cycles')
        .where({
          client_id: clientId,
          tenant: this.tenant
        })
        .where('effective_date', '<=', endDate)
        .orderBy('effective_date', 'asc');

      let currentCycle = null;
      for (const cycle of cycles) {
        const cycleDate = toPlainDate(cycle.effective_date);
        const start = toPlainDate(startDate);
        const end = toPlainDate(endDate);
        if (Temporal.PlainDate.compare(cycleDate, start) <= 0) {
          currentCycle = cycle;
        } else if (Temporal.PlainDate.compare(cycleDate, start) > 0 && Temporal.PlainDate.compare(cycleDate, end) < 0) {
          return {
            success: false,
            error: 'Invoice period cannot span billing cycle change'
          };
        }
      }

      if (!currentCycle) {
        // If no cycle found, create default monthly cycle
        await this.getBillingCycle(clientId, startDate);
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to validate billing period'
      };
    }
  }
  private async calculateFixedPriceCharges(clientId: string, billingPeriod: IBillingPeriod, clientContractLine: IClientContractLine): Promise<IFixedPriceCharge[]> {
    // Note: Fixed plan rates are stored as dollars (decimal) in the database,
    // but need to be converted to cents (integer) for consistency with other monetary values in the system.
    // Custom contract-level rates are assumed to be in cents already.
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const lineBillingTiming = (clientContractLine.billing_timing ?? 'arrears') as 'arrears' | 'advance';
    const servicePeriod = await this.resolveServicePeriod(
      clientId,
      billingPeriod,
      clientContractLine,
      lineBillingTiming
    );
    let { servicePeriodStart, servicePeriodEnd } = servicePeriod;
    if (lineBillingTiming === 'arrears' && clientContractLine.start_date) {
      const serviceEndDate = toPlainDate(servicePeriodEnd);
      const lineStartDate = toPlainDate(clientContractLine.start_date);

      if (Temporal.PlainDate.compare(serviceEndDate, lineStartDate) < 0) {
        console.log(
          `[ARREARS] Skipping fixed charge for ${clientContractLine.contract_line_name} (line ${clientContractLine.contract_line_id}) – service period ${servicePeriodStart} to ${servicePeriodEnd} ends before contract start ${clientContractLine.start_date}.`
        );
        return [];
      }

      const serviceStartDate = toPlainDate(servicePeriodStart);
      if (Temporal.PlainDate.compare(serviceStartDate, lineStartDate) < 0) {
        servicePeriodStart = toISODate(lineStartDate);
      }
    }

    // --- Custom Rate Check (Contracts & Pricing Schedules) ---
    // Check if a custom rate is defined for this plan assignment (provided via contract association)
    // or if an active pricing schedule overrides the rate for this billing period.
    // Pricing schedules take precedence over contract-level custom rates.
    // Ensure custom_rate is not null and not undefined before using it.

    let effectiveCustomRate = clientContractLine.custom_rate;
    let generatedCharges: IFixedPriceCharge[] | null = null;

    // Check for active pricing schedule that applies to this billing period
    if (clientContractLine.contract_id) {
      try {
        const activePricingSchedule = await this.knex('contract_pricing_schedules')
          .where({
            tenant: this.tenant,
            contract_id: clientContractLine.contract_id
          })
          .where('effective_date', '<=', billingPeriod.endDate)
          .where(function(builder) {
            builder.whereNull('end_date')
              .orWhere('end_date', '>', billingPeriod.startDate);
          })
          .orderBy('effective_date', 'desc')
          .first();

        if (activePricingSchedule && activePricingSchedule.custom_rate !== null && activePricingSchedule.custom_rate !== undefined) {
          effectiveCustomRate = activePricingSchedule.custom_rate;
          console.log(`[PRICING_SCHEDULE] Using pricing schedule rate ${activePricingSchedule.custom_rate} cents for contract ${clientContractLine.contract_id} during period ${billingPeriod.startDate} to ${billingPeriod.endDate}. Schedule ID: ${activePricingSchedule.schedule_id}`);
        }
      } catch (error) {
        console.warn(`[PRICING_SCHEDULE] Error checking for active pricing schedule for contract ${clientContractLine.contract_id}:`, error);
      }
    }

    if (effectiveCustomRate !== null && effectiveCustomRate !== undefined) {
      // Assuming effectiveCustomRate is already in cents. Add logging to confirm.
      console.log(`Using custom rate ${effectiveCustomRate} cents for plan ${clientContractLine.contract_line_name} (ID: ${clientContractLine.contract_line_id}) from contract ${clientContractLine.contract_name || 'N/A'}`);

      // If a custom rate exists, create a single charge item for the entire plan at that rate.
      // This charge represents the entire plan when a custom contract-level rate is applied.
      const customCharge: IFixedPriceCharge = {
        // Properties from IFixedPriceCharge & IBillingCharge
        type: 'fixed',
        serviceName: `${clientContractLine.contract_line_name}${clientContractLine.contract_name ? ` (Contract: ${clientContractLine.contract_name})` : ''}`,
        quantity: 1, // Represents the single contract-level plan item
        rate: effectiveCustomRate, // Use the effective custom rate (from schedule or contract) (assumed cents)
        total: effectiveCustomRate, // Total is the effective custom rate (assumed cents)
        // planId: clientContractLine.contract_line_id, // Removed - planId not part of IFixedPriceCharge
        client_contract_line_id: clientContractLine.client_contract_line_id, // Link back to the plan assignment
        client_contract_id: clientContractLine.client_contract_id || undefined, // Use correct property name
        contract_name: clientContractLine.contract_name || undefined,
        // Tax properties (defaulting to 0/non-taxable for now, needs review)
        tax_amount: 0,
        tax_rate: 0,
        tax_region: undefined, // Tax region for consolidated fixed item determined later
        servicePeriodStart,
        servicePeriodEnd,
        billingTiming: lineBillingTiming,
        // Note: serviceId is omitted as this charge represents the whole plan.
        // Other properties like enable_proration might need to be sourced if relevant for custom rates.
      };
      generatedCharges = [customCharge];
    }
    // --- End Custom Rate Check ---


    if (!generatedCharges) {
      // If no custom rate, proceed with calculating based on individual services or plan's fixed rate
      console.log(`No custom rate found for plan ${clientContractLine.contract_line_name} (ID: ${clientContractLine.contract_line_id}). Calculating based on services/plan rate.`);
      const client = await this.knex('clients')
        .where({
          client_id: clientId,
          tenant: this.tenant
        })
        .first() as IClient;

      if (!client) {
        throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
      }

      // Removed old logic fetching tax region via client_tax_settings (Phase 1.2)

      const tenant = this.tenant; // Capture tenant value for joins

      // Get the contract line details to determine if this is a fixed fee plan
      const contractLineDetails = await this.knex('contract_lines')
        .where({
          contract_line_id: clientContractLine.contract_line_id,
          tenant: client.tenant
        })
        .first();

      const isFixedFeePlan = contractLineDetails?.contract_line_type === 'Fixed';

      // --- Fetch Plan-Level Fixed Config (Base Rate, Proration, Alignment) ---
      let planLevelBaseRate: number | null = null; // Store plan base rate in dollars
      let planLevelEnableProration = false;
      let planLevelBillingCycleAlignment: 'start' | 'end' | 'prorated' = 'start';

      if (isFixedFeePlan && contractLineDetails) {
        if (contractLineDetails.custom_rate !== undefined && contractLineDetails.custom_rate !== null) {
          const parsedContractRate =
            typeof contractLineDetails.custom_rate === 'string'
              ? parseFloat(contractLineDetails.custom_rate)
              : Number(contractLineDetails.custom_rate);
          if (!Number.isNaN(parsedContractRate)) {
            planLevelBaseRate = parsedContractRate;
          }
        }

        if (contractLineDetails.enable_proration !== undefined && contractLineDetails.enable_proration !== null) {
          planLevelEnableProration = Boolean(contractLineDetails.enable_proration);
        }

        const alignmentCandidate = contractLineDetails.billing_cycle_alignment;
        if (
          typeof alignmentCandidate === 'string' &&
          (alignmentCandidate === 'start' || alignmentCandidate === 'end' || alignmentCandidate === 'prorated')
        ) {
          planLevelBillingCycleAlignment = alignmentCandidate;
        }
      }

      if (isFixedFeePlan) {
        const pricing = await this.knex('client_contract_line_pricing')
          .where({
            client_contract_line_id: clientContractLine.client_contract_line_id,
            tenant
          })
          .first('custom_rate');

        if (pricing?.custom_rate !== undefined && pricing.custom_rate !== null) {
          const parsedPricingRate =
            typeof pricing.custom_rate === 'string' ? parseFloat(pricing.custom_rate) : Number(pricing.custom_rate);
          if (!Number.isNaN(parsedPricingRate)) {
            planLevelBaseRate = parsedPricingRate;
          }
        } else if (planLevelBaseRate === null && clientContractLine.custom_rate != null) {
          const parsedAssignmentRate =
            typeof clientContractLine.custom_rate === 'string'
              ? parseFloat(clientContractLine.custom_rate)
              : Number(clientContractLine.custom_rate);
          if (!Number.isNaN(parsedAssignmentRate)) {
            planLevelBaseRate = parsedAssignmentRate;
          }
        }
      }

      const planServices = await this.knex('client_contract_services as ccs')
        .join('client_contract_service_configuration as ccsc', function () {
          this.on('ccsc.client_contract_service_id', '=', 'ccs.client_contract_service_id')
            .andOn('ccsc.tenant', '=', 'ccs.tenant');
        })
        .leftJoin('client_contract_service_fixed_config as ccsfc', function () {
          this.on('ccsfc.config_id', '=', 'ccsc.config_id')
            .andOn('ccsfc.tenant', '=', 'ccsc.tenant');
        })
        .join('service_catalog as sc', function () {
          this.on('sc.service_id', '=', 'ccs.service_id')
            .andOn('sc.tenant', '=', 'ccs.tenant');
        })
        .where({
          'ccs.client_contract_line_id': clientContractLine.client_contract_line_id,
          'ccs.tenant': tenant,
          'ccsc.configuration_type': 'Fixed'
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.default_rate',
          'sc.tax_rate_id',
          'ccs.quantity as service_quantity',
          'ccs.custom_rate as service_line_custom_rate',
          'ccsc.quantity as configuration_quantity',
          'ccsc.custom_rate as configuration_custom_rate',
          'ccsc.config_id',
          'ccsfc.base_rate as service_base_rate',
          'ccsfc.enable_proration',
          'ccsfc.billing_cycle_alignment'
        );

      if (planServices.length === 0) {
        return [];
      }

      const normalizedPlanServices = planServices.map((service: any) => {
        const quantityValue =
          service.configuration_quantity ?? service.service_quantity ?? service.quantity ?? 1;
        return {
          ...service,
          quantity: Number(quantityValue ?? 1) || 1,
        };
      });

      if (!planLevelEnableProration) {
        const prorationFromService = planServices.find((service: any) => service.enable_proration);
        if (prorationFromService?.enable_proration) {
          planLevelEnableProration = Boolean(prorationFromService.enable_proration);
        }
      }

      if (planLevelBillingCycleAlignment === 'start') {
        const alignmentFromService = planServices.find(
          (service: any) =>
            typeof service.billing_cycle_alignment === 'string' &&
            (service.billing_cycle_alignment === 'start' ||
              service.billing_cycle_alignment === 'end' ||
              service.billing_cycle_alignment === 'prorated')
        );
        if (alignmentFromService) {
          planLevelBillingCycleAlignment = alignmentFromService.billing_cycle_alignment;
        }
      }

      if (isFixedFeePlan && (planLevelBaseRate === null || Number.isNaN(planLevelBaseRate))) {
        let derivedBaseRate = 0;
        let hasServiceBaseRate = false;

        for (const service of planServices) {
          const rawServiceBaseRate = service.service_base_rate;
          if (rawServiceBaseRate !== null && rawServiceBaseRate !== undefined) {
            const parsedServiceBaseRate =
              typeof rawServiceBaseRate === 'string' ? parseFloat(rawServiceBaseRate) : Number(rawServiceBaseRate);
            if (!Number.isNaN(parsedServiceBaseRate)) {
              const quantity = Number(service.configuration_quantity ?? service.service_quantity ?? 1) || 1;
              derivedBaseRate += parsedServiceBaseRate * quantity;
              hasServiceBaseRate = true;
            }
          }
        }

        if (hasServiceBaseRate) {
          planLevelBaseRate = derivedBaseRate;
          console.log(
            `[DEBUG] Contract Line ${clientContractLine.contract_line_id} - Derived plan base rate from service configs: ${planLevelBaseRate}`
          );
        }
      }

      if (isFixedFeePlan && (planLevelBaseRate === null || Number.isNaN(planLevelBaseRate))) {
        const totalDefaultRateCents = planServices.reduce((sum: number, service: any) => {
          const rate = Number(service.default_rate ?? 0);
          const quantity = Number(service.configuration_quantity ?? service.service_quantity ?? 1) || 1;
          return sum + rate * quantity;
        }, 0);
        if (totalDefaultRateCents !== 0) {
          planLevelBaseRate = totalDefaultRateCents / 100;
          console.log(
            `[DEBUG] Contract Line ${clientContractLine.contract_line_id} - Derived plan base rate from service default rates: ${planLevelBaseRate}`
          );
        }
      }

      if (isFixedFeePlan && (planLevelBaseRate === null || Number.isNaN(planLevelBaseRate))) {
        console.error(
          `[DEBUG] Unable to determine base_rate for contract line ${clientContractLine.contract_line_id}.`
        );
        return [];
      }

    if (isFixedFeePlan) {
      // For fixed fee plans, we want to create a single consolidated charge
      // but internally allocate the tax based on FMV of each service

      // Use the plan-level base rate fetched earlier
      const baseRate = planLevelBaseRate!; // Assert non-null based on checks above
      console.log(`[DEBUG] Plan ${clientContractLine.contract_line_id} - Using Plan Level Base Rate: ${baseRate}`);

      // Calculate the total FMV (Fair Market Value) of all services
      // Calculate the total FMV (Fair Market Value) of all services in CENTS
      const totalFMVCents = normalizedPlanServices.reduce((sum, service) => {
        const serviceFMV = Number(service.default_rate ?? 0) * service.quantity;
        return sum + serviceFMV;
      }, 0);
      console.log(`[DEBUG] Plan ${clientContractLine.contract_line_id} - Calculated totalFMVCents: ${totalFMVCents}`); // DEBUG LOG

      // If totalFMVCents is exactly zero, we can't allocate properly
      // Note: Negative FMV is valid for credit-generating services and should be processed
      if (totalFMVCents === 0) {
        console.log(`Total FMV (cents) for services in plan ${clientContractLine.contract_line_id} is zero`);
        return [];
      }

      // Calculate tax for each service based on its proportion of the total FMV
      let totalTaxAmount = 0;
      let totalTaxableAmount = 0;
      let totalNonTaxableAmount = 0;

      // For detailed tax calculation and audit purposes

      // Instantiate TaxService
      const taxServiceInstance = new TaxService(); // Corrected instantiation
      // Fetch billing cycle once for proration calculation if needed
      const billingCycle = await this.getBillingCycle(clientId, billingPeriod.startDate);
      const effectiveProrationPeriod = lineBillingTiming === 'advance'
        ? { startDate: servicePeriodStart, endDate: servicePeriodEnd }
        : billingPeriod;

      const serviceAllocations = await Promise.all(normalizedPlanServices.map(async (service) => {
        // Calculate the FMV for this service in CENTS
        // Use custom_rate from plan config if available (assume dollars), otherwise fallback to service default_rate (assume cents).
        console.log('[DEBUG] Processing service object:', JSON.stringify(service, null, 2)); // DEBUG LOG - Inspect the service object
        // FMV should always be based on the service's default rate, not plan overrides.
        // Assume service.default_rate is stored in cents.
        const rateForFMV = Number(service.default_rate || 0); // Ensure it's a number, default to 0 if null/undefined
        const serviceFMVCents = Math.round(rateForFMV * service.quantity); // FMV is now correctly in cents
        console.log(`[DEBUG] Service ${service.service_id} - Calculated serviceFMVCents: ${serviceFMVCents} (Rate: ${rateForFMV}, Qty: ${service.quantity})`); // DEBUG LOG

        // Calculate the proportion of the total fixed fee that should be allocated to this service
        const proportion = totalFMVCents !== 0 ? serviceFMVCents / totalFMVCents : 0; // Use totalFMVCents and handle division by zero
        console.log(`[DEBUG] Service ${service.service_id} - Calculated proportion: ${proportion} (${serviceFMVCents} / ${totalFMVCents})`); // DEBUG LOG

        // --- Proration Calculation ---
        let prorationFactor = 1.0;
        let effectiveBaseRateInCents = Math.round(baseRate * 100); // Start with full rate in cents

        // Use the plan-level proration setting fetched earlier for fixed plans
        if (planLevelEnableProration) {
          prorationFactor = this._calculateProrationFactor(
            effectiveProrationPeriod,
            clientContractLine.start_date,
            clientContractLine.end_date,
            billingCycle
          );
          effectiveBaseRateInCents = Math.round(effectiveBaseRateInCents * prorationFactor);
          console.log(`[DEBUG] Service ${service.service_id} - Proration Enabled. Factor: ${prorationFactor.toFixed(4)}, Prorated Base (cents): ${effectiveBaseRateInCents}`);
        } else {
          console.log(`[DEBUG] Service ${service.service_id} - Proration Disabled.`);
        }
        // --- End Proration Calculation ---

        // Allocate a portion of the (potentially prorated) fixed fee to this service
        const allocatedAmount = Math.round(effectiveBaseRateInCents * proportion); // Use effective rate, round final cents value
        console.log(`[DEBUG] Service ${service.service_id} - Calculated allocatedAmount (cents): ${allocatedAmount} (Effective Base: ${effectiveBaseRateInCents}, Prop: ${proportion})`); // DEBUG LOG

        // Determine tax info using the helper function
        const { taxRegion: serviceTaxRegion, isTaxable } = await this.getTaxInfoFromService(service);

        // Calculate tax if applicable
        let taxAmount = 0;
        let taxRate = 0;

        // ***** START OF CORRECTED BLOCK *****
        if (!client.is_tax_exempt && isTaxable) {
          // Use the region derived from tax_rate_id, fallback to client default ONLY if service region is null
          const effectiveTaxRegion = serviceTaxRegion ?? await getClientDefaultTaxRegionCode(client.client_id) ?? '';
          if (effectiveTaxRegion) {
            // Use TaxService to calculate tax
            // allocatedAmount is already in cents
            const taxResult = await taxServiceInstance.calculateTax(client.client_id, allocatedAmount, billingPeriod.endDate, effectiveTaxRegion);
            taxRate = taxResult.taxRate;
            taxAmount = taxResult.taxAmount;
            console.log(`[DEBUG] Service ${service.service_id} - Tax calculated (TaxService): Rate=${taxRate}, Amount=${taxAmount}, Base=${allocatedAmount}, Region=${effectiveTaxRegion}`); // DEBUG LOG
          } else {
            // No region from service's tax_rate_id AND no client default region.
            console.warn(`[BillingEngine] No tax region found (from service tax_rate_id or client default via getClientDefaultTaxRegionCode) for service ${service.service_id} / client ${clientId}. Using zero tax rate.`);
            taxRate = 0;
            taxAmount = 0;
            console.log(`[DEBUG] Service ${service.service_id} - Tax calculation skipped (No effective region found)`); // DEBUG LOG
          }
          // Add the pre-tax allocated amount to the total taxable amount
          totalTaxableAmount += allocatedAmount;
        }
        // ***** END OF CORRECTED BLOCK *****
        else {
          // Add to the total non-taxable amount
          totalNonTaxableAmount += allocatedAmount;
          console.log(`[DEBUG] Service ${service.service_id} - Tax calculation skipped (Client exempt: ${client.is_tax_exempt} or service not taxable: ${!isTaxable})`); // DEBUG LOG
        }

        // Add to the total tax amount
        totalTaxAmount += taxAmount;

        return {
          serviceId: service.service_id,
          serviceName: service.service_name,
          fmv: serviceFMVCents, // Store FMV in cents
          proportion,
          allocatedAmount,
          isTaxable: isTaxable, // Use derived value
          taxRate: taxRate,
          taxAmount // This is the final calculated tax for this allocation
        };
      }));

      // Log the detailed allocation for audit purposes
      console.log(`Fixed fee plan ${clientContractLine.contract_line_id} tax allocation:`, {
        baseRate: baseRate, // Dollar amount from database
        baseRateInCents: baseRate * 100, // Converted to cents for calculations
        totalFMVCents,
        totalTaxableAmount,
        totalNonTaxableAmount,
        totalTaxAmount,
        serviceAllocations
      });

      // Create an array to hold the detailed charges
      const detailedCharges: IFixedPriceCharge[] = [];

      // Iterate through the service allocations and create a detailed charge for each
      for (const allocation of serviceAllocations) {
        // Find the corresponding planService data
        const planService = normalizedPlanServices.find(ps => ps.service_id === allocation.serviceId);

        if (!planService) {
          console.warn(`Could not find planService data for serviceId: ${allocation.serviceId} in plan ${clientContractLine.contract_line_id}`);
          continue; // Skip this allocation if data is missing
        }

        const quantity = Number(planService.quantity ?? 1) || 1;

        const detailedCharge: IFixedPriceCharge = {
          // Common IBillingCharge fields
          type: 'fixed',
          serviceId: allocation.serviceId,
          serviceName: allocation.serviceName,
          quantity, // Default to 1 if quantity is null
          rate: allocation.allocatedAmount, // Rate is the PRORATED allocated amount in cents
          total: allocation.allocatedAmount, // Total is the PRORATED allocated amount in cents
          tax_amount: allocation.taxAmount, // Per-allocation tax in cents
          tax_rate: allocation.taxRate, // Per-allocation tax rate
          is_taxable: allocation.isTaxable, // Use the derived isTaxable from the allocation object
          // Determine effective region for the charge record
          // We need the taxRegion derived from the service's tax_rate_id for this specific allocation
          // Let's re-fetch it here for clarity, although it was calculated during allocation.
          // Ideally, the allocation object would carry the derived taxRegion.
          // For now, re-derive:
          tax_region: (await this.getTaxInfoFromService(planService)).taxRegion ?? await getClientDefaultTaxRegionCode(client.client_id) ?? undefined, // Use derived region, fallback to client default lookup
          // planId: clientContractLine.contract_line_id, // Removed - planId not part of IFixedPriceCharge
          client_contract_line_id: clientContractLine.client_contract_line_id, // Link back to the plan assignment

          // Add contract association information for all fixed charges when the plan is covered by a contract assignment
          client_contract_id: clientContractLine.client_contract_id || undefined,
          contract_name: clientContractLine.contract_name || undefined,

          // IFixedPriceCharge specific fields (newly added)
          config_id: planService.config_id, // From the modified query
          base_rate: Math.round(baseRate * 100), // Use the PLAN-LEVEL base rate (converted to cents) used for allocation
          enable_proration: planLevelEnableProration, // Use plan-level setting
          fmv: allocation.fmv, // Use FMV directly from allocation (already in cents)
          proportion: allocation.proportion, // Numeric proportion
          allocated_amount: allocation.allocatedAmount, // PRORATED allocated amount in cents

          // Removed comment line
          billing_cycle_alignment: planLevelBillingCycleAlignment, // Use plan-level setting
          // taxAllocationDetails: undefined, // Remove this property as details are now fields
        };
        detailedCharges.push(detailedCharge);
      }

      console.log(`Detailed fixed price charges for client ${clientId}, plan ${clientContractLine.contract_line_id}:`, detailedCharges);
      generatedCharges = detailedCharges;
    } else {
      // This block handles cases where the plan type isn't 'Fixed', but a service within it
      // is configured as 'Fixed'. This might be legacy or an edge case.
      // We should still use the plan-level proration/alignment settings if the plan *was* fixed.
      // If the plan itself isn't fixed, proration likely doesn't apply anyway.
      // TODO: Review if this logic block is still necessary or correct after the refactor.
      console.warn(`[BillingEngine] Processing fixed service config for a non-fixed plan type (${contractLineDetails?.contract_line_type}) for plan ${clientContractLine.contract_line_id}. Review this logic.`);

      const fixedCharges: IFixedPriceCharge[] = await Promise.all(normalizedPlanServices.map(async (service): Promise<IFixedPriceCharge> => {
        const quantity = service.quantity;

        const parsedBaseRate = service.service_base_rate !== null && service.service_base_rate !== undefined
          ? Number(service.service_base_rate)
          : null;
        const baseRateInCents = parsedBaseRate !== null && !Number.isNaN(parsedBaseRate)
          ? Math.round(parsedBaseRate * 100)
          : Number(service.default_rate ?? 0);
        const total = baseRateInCents * quantity;

        // Determine tax info for this edge-case service
        const { taxRegion: serviceTaxRegion, isTaxable } = await this.getTaxInfoFromService(service);

        const charge: IFixedPriceCharge = {
          serviceId: service.service_id,
          serviceName: service.service_name,
          quantity,
          rate: baseRateInCents, // Rate in cents
          total, // Total in cents
          type: 'fixed',
          tax_amount: 0,
          tax_rate: 0,
          tax_region: serviceTaxRegion ?? await getClientDefaultTaxRegionCode(client.client_id) ?? undefined, // Use derived region, fallback to client default lookup
          is_taxable: isTaxable, // Use derived value
          // Use plan-level settings fetched earlier, even if plan type isn't strictly 'Fixed' now
          // This maintains consistency if a plan type was changed.
          enable_proration: planLevelEnableProration, // Use plan-level setting
          billing_cycle_alignment: planLevelBillingCycleAlignment, // Use plan-level setting
          // Add other relevant fields from IFixedPriceCharge if needed
          config_id: service.config_id,
          base_rate: baseRateInCents,
          // FMV/Proportion/AllocatedAmount might not be relevant here if not a true fixed plan
        };
        // Recalculate tax based on derived info for this edge case
        if (!client.is_tax_exempt && charge.is_taxable) {
          const effectiveTaxRegion = charge.tax_region ?? ''; // Use the already set region (derived or client default fallback)
          if (effectiveTaxRegion) {
            // Use TaxService instance if available, or instantiate if needed
            const taxServiceInstance = new TaxService(); // Assuming it's okay to instantiate here
            const taxResult = await taxServiceInstance.calculateTax(client.client_id, charge.total, billingPeriod.endDate, effectiveTaxRegion);
            charge.tax_rate = taxResult.taxRate;
            charge.tax_amount = taxResult.taxAmount;
          } else {
            console.warn(`No effective tax region found for edge-case fixed service ${service.service_id}, using zero tax rate`);
            charge.tax_rate = 0;
            charge.tax_amount = 0;
          }
        }

        return charge;
      }));

      console.log(`Fixed price charges for client ${clientId}:`, fixedCharges);
      generatedCharges = fixedCharges;
    }
  }

    if (!generatedCharges || generatedCharges.length === 0) {
      return [];
    }

    const chargesWithMeta = generatedCharges.map((charge) => ({
      ...charge,
      servicePeriodStart,
      servicePeriodEnd,
      billingTiming: lineBillingTiming
    }));

    let positiveCharges: IFixedPriceCharge[] = chargesWithMeta;

    if (lineBillingTiming === 'advance') {
      const endedBeforeAdvance = clientContractLine.end_date
        ? Temporal.PlainDate.compare(
            toPlainDate(clientContractLine.end_date),
            toPlainDate(servicePeriodStart)
          ) < 0
        : false;

      let existingAdvance = false;
      if (!endedBeforeAdvance) {
        existingAdvance = await this.hasExistingServicePeriodCharge(
          clientContractLine.client_contract_line_id,
          servicePeriodStart,
          servicePeriodEnd,
          'advance'
        );
      }

      if (endedBeforeAdvance || existingAdvance) {
        console.log(`[BillingEngine] Skipping advance billing for contract line ${clientContractLine.contract_line_id}: ${endedBeforeAdvance ? 'line ends before next period' : 'charge already persisted for service period'}`);
        positiveCharges = [];
      }
    }

    const creditCharges = lineBillingTiming === 'advance'
      ? this.buildAdvanceTerminationCredits(
          clientContractLine,
          billingPeriod,
          chargesWithMeta
        )
      : [];

    return [...positiveCharges, ...creditCharges];
  }

  private async calculateTimeBasedCharges(clientId: string, billingPeriod: IBillingPeriod, clientContractLine: IClientContractLine): Promise<ITimeBasedCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    // Fetch the contract line details to get plan-wide settings
    const plan = await this.knex('contract_lines')
      .where({
        contract_line_id: clientContractLine.contract_line_id,
        tenant: this.tenant
      })
      .first();

    if (!plan) {
      throw new Error(`Contract Line ${clientContractLine.contract_line_id} not found for client ${clientId}`);
    }

    const tenant = this.tenant; // Capture tenant value for joins
    const clientConfigService = new ClientContractServiceConfigurationService(this.knex, tenant);
    const clientServiceConfigs = await clientConfigService.getConfigurationsForClientContractLine(
      clientContractLine.client_contract_line_id
    );

    // Create a map of service IDs to their hourly configurations
    const serviceConfigMap = new Map<string, {
      config: IContractLineServiceConfiguration & IContractLineServiceHourlyConfig,
      userTypeRates: Map<string, number>
    }>();

    for (const configDetails of clientServiceConfigs) {
      if (configDetails.baseConfig.configuration_type !== 'Hourly') {
        continue;
      }
      const hourlyDetails = configDetails.typeConfig as (IContractLineServiceHourlyConfig & { hourly_rate?: number | null }) | null;
      if (!hourlyDetails) {
        continue;
      }

      const userTypeRates = configDetails.userTypeRates ?? [];
      const userRateMap = new Map<string, number>();
      for (const rate of userTypeRates) {
        userRateMap.set(rate.user_type, rate.rate);
      }

      const combinedConfig = {
        config_id: configDetails.baseConfig.config_id,
        contract_line_id: clientContractLine.contract_line_id,
        service_id: configDetails.serviceId,
        configuration_type: 'Hourly',
        quantity: configDetails.baseConfig.quantity ?? null,
        custom_rate: configDetails.baseConfig.custom_rate ?? null,
        hourly_rate: hourlyDetails.hourly_rate != null ? Number(hourlyDetails.hourly_rate) : 0,
        minimum_billable_time: hourlyDetails.minimum_billable_time ?? 0,
        round_up_to_nearest: hourlyDetails.round_up_to_nearest ?? 0
      } as IContractLineServiceConfiguration & IContractLineServiceHourlyConfig;

      serviceConfigMap.set(configDetails.serviceId, {
        config: combinedConfig,
        userTypeRates: userRateMap
      });
    }

    const query = this.knex('time_entries')
      .join('users', function () {
        this.on('time_entries.user_id', '=', 'users.user_id')
          .andOn('users.tenant', '=', 'time_entries.tenant');
      })
      .leftJoin('service_catalog', function () {
        this.on('service_catalog.service_id', '=', 'time_entries.service_id')
          .andOn('service_catalog.tenant', '=', 'time_entries.tenant');
      })
      .leftJoin('project_ticket_links', function () {
        this.on('time_entries.work_item_id', '=', 'project_ticket_links.ticket_id')
          .andOn('project_ticket_links.tenant', '=', 'time_entries.tenant');
      })
      .leftJoin('project_tasks', function () {
        this.on('time_entries.work_item_id', '=', 'project_tasks.task_id')
          .andOn('project_tasks.tenant', '=', 'time_entries.tenant');
      })
      .leftJoin('project_phases', function () {
        this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
          .andOn('project_phases.tenant', '=', 'project_tasks.tenant');
      })
      .leftJoin('projects', function () {
        this.on('project_phases.project_id', '=', 'projects.project_id')
          .andOn('projects.tenant', '=', 'project_phases.tenant');
      })
      .leftJoin('tickets', function () {
        this.on('time_entries.work_item_id', '=', 'tickets.ticket_id')
          .andOn('tickets.tenant', '=', 'time_entries.tenant');
      })
      .where({
        'time_entries.tenant': client.tenant
      })
      .where('time_entries.start_time', '>=', billingPeriod.startDate)
      .where('time_entries.end_time', '<', billingPeriod.endDate)
      .where('time_entries.invoiced', false)
      .where(function (this: Knex.QueryBuilder) {
        // Either the time entry has the specific contract line ID (use contract_line_id for contract associations)
        this.where('time_entries.contract_line_id', clientContractLine.contract_line_id) // Use contract_line_id here
          // Or it has no contract line ID (for backward compatibility) and should be allocated to this plan
          .orWhere(function (this: Knex.QueryBuilder) {
            this.whereNull('time_entries.contract_line_id');
          });
      })
      .where(function (this: Knex.QueryBuilder) {
        this.where(function (this: Knex.QueryBuilder) {
          this.where('time_entries.work_item_type', '=', 'project_task')
            .whereNotNull('project_tasks.task_id')
        }).orWhere(function (this: Knex.QueryBuilder) {
          this.where('time_entries.work_item_type', '=', 'ticket')
            .whereNotNull('tickets.ticket_id')
        })
      })
      .where(function (this: Knex.QueryBuilder) {
        this.where('projects.client_id', clientId)
          .orWhere('tickets.client_id', clientId)
      })
      .where('time_entries.approval_status', 'APPROVED')
      .select(
        'time_entries.*',
        'service_catalog.service_name',
        'service_catalog.default_rate',
        'service_catalog.tax_rate_id',
        this.knex.raw('COALESCE(project_tasks.task_name, tickets.title) as work_item_name')
      );

    console.log('Time entries query:', query.toString());
    const timeEntries = await query;

    console.log('Time entries:', timeEntries);

    const timeBasedChargesPromises = timeEntries.map(async (entry: any): Promise<ITimeBasedCharge> => {
      const startDateTime = Temporal.PlainDateTime.from(entry.start_time.toISOString().replace('Z', ''));
      const endDateTime = Temporal.PlainDateTime.from(entry.end_time.toISOString().replace('Z', ''));

      // Get the service configuration if available
      const serviceConfig = serviceConfigMap.get(entry.service_id);

      // Calculate duration based on configuration settings
      let durationMinutes = startDateTime.until(endDateTime, { largestUnit: 'minutes' }).minutes;

      if (serviceConfig) {
        // Apply minimum billable time
        if (durationMinutes < serviceConfig.config.minimum_billable_time) {
          durationMinutes = serviceConfig.config.minimum_billable_time;
        }

        // Round up to nearest increment
        if (serviceConfig.config.round_up_to_nearest > 0) {
          const remainder = durationMinutes % serviceConfig.config.round_up_to_nearest;
          if (remainder > 0) {
            durationMinutes += serviceConfig.config.round_up_to_nearest - remainder;
          }
        }
      }

      // Convert to hours
      const duration = Math.ceil(durationMinutes / 60);

      // Determine rate based on user type if applicable
      let rate = Math.ceil(entry.custom_rate ?? entry.default_rate);
      if (serviceConfig && serviceConfig.userTypeRates.has(entry.user_type)) {
        rate = serviceConfig.userTypeRates.get(entry.user_type) as number;
      }

      // Check for overtime if applicable
      let total = Math.round(duration * rate);
      // Use plan-wide settings from the fetched 'plan' object
      if (plan.enable_overtime &&
        plan.overtime_threshold &&
        duration > plan.overtime_threshold) {
        const regularHours = plan.overtime_threshold;
        const overtimeHours = duration - regularHours;
        // Use plan's overtime_rate, fallback to 1.5x the calculated rate (user or service specific)
        const overtimeRate = plan.overtime_rate || (rate * 1.5);
        total = Math.round((regularHours * rate) + (overtimeHours * overtimeRate));
      }

      // Determine tax info using the helper function
      // Pass a minimal service object containing the necessary IDs
      const { taxRegion: serviceTaxRegion, isTaxable } = await this.getTaxInfoFromService({
        service_id: entry.service_id,
        tax_rate_id: entry.tax_rate_id // Pass the fetched tax_rate_id
      });

      // Calculate tax amount (will be recalculated later in invoiceService, but set initial values)
      let taxAmount = 0;
      let taxRate = 0;
      const effectiveTaxRegion = serviceTaxRegion ?? await getClientDefaultTaxRegionCode(client.client_id) ?? undefined;

      if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
        try {
          const taxServiceInstance = new TaxService();
          const taxResult = await taxServiceInstance.calculateTax(client.client_id, total, billingPeriod.endDate, effectiveTaxRegion);
          taxRate = taxResult.taxRate;
          taxAmount = taxResult.taxAmount;
        } catch (error) {
          console.error(`Error calculating initial tax for time entry ${entry.entry_id}:`, error);
        }
      }

      return {
        serviceId: entry.service_id,
        serviceName: entry.service_name,
        userId: entry.user_id,
        duration,
        quantity: duration,
        rate,
        total,
        type: 'time',
        tax_amount: taxAmount, // Set initial tax amount
        tax_rate: taxRate,     // Set initial tax rate
        tax_region: effectiveTaxRegion, // Use derived region, fallback to client default lookup
        entryId: entry.entry_id,
        is_taxable: isTaxable, // Use derived value
        servicePeriodStart: billingPeriod.startDate,
        servicePeriodEnd: billingPeriod.endDate,
        billingTiming: 'arrears',
        // Add contract association information when the plan is covered by a contract assignment
        client_contract_id: clientContractLine.client_contract_id || undefined,
        contract_name: clientContractLine.contract_name || undefined
      };
    });

    const timeBasedCharges = await Promise.all(timeBasedChargesPromises);

    return timeBasedCharges;
  }

  private async calculateUsageBasedCharges(clientId: string, billingPeriod: IBillingPeriod, clientContractLine: IClientContractLine): Promise<IUsageBasedCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const tenant = this.tenant; // Capture tenant value for joins
    const clientConfigService = new ClientContractServiceConfigurationService(this.knex, tenant);
    const clientServiceConfigs = await clientConfigService.getConfigurationsForClientContractLine(
      clientContractLine.client_contract_line_id
    );

    // Create a map of service IDs to their usage configurations and rate tiers
    const serviceConfigMap = new Map<string, {
      config: IContractLineServiceConfiguration & IContractLineServiceUsageConfig,
      rateTiers: IContractLineServiceRateTier[]
    }>();

    for (const configDetails of clientServiceConfigs) {
      if (configDetails.baseConfig.configuration_type !== 'Usage') {
        continue;
      }
      const usageDetails = configDetails.typeConfig as (IContractLineServiceUsageConfig & { base_rate?: number | null }) | null;
      if (!usageDetails) {
        continue;
      }
      const rateTiers = configDetails.rateTiers ?? [];
      const normalizedConfig = {
        config_id: configDetails.baseConfig.config_id,
        contract_line_id: clientContractLine.contract_line_id,
        service_id: configDetails.serviceId,
        configuration_type: 'Usage',
        quantity: configDetails.baseConfig.quantity ?? null,
        custom_rate: configDetails.baseConfig.custom_rate != null ? Number(configDetails.baseConfig.custom_rate) : null,
        unit_of_measure: usageDetails.unit_of_measure,
        enable_tiered_pricing: Boolean(usageDetails.enable_tiered_pricing),
        minimum_usage: usageDetails.minimum_usage ?? 0,
        base_rate: usageDetails.base_rate != null ? Number(usageDetails.base_rate) : null
      } as IContractLineServiceConfiguration & IContractLineServiceUsageConfig;

      serviceConfigMap.set(configDetails.serviceId, {
        config: normalizedConfig,
        rateTiers
      });
    }

    const usageRecordQuery = this.knex('usage_tracking')
      .leftJoin('service_catalog', function () {
        this.on('service_catalog.service_id', '=', 'usage_tracking.service_id')
          .andOn('service_catalog.tenant', '=', 'usage_tracking.tenant');
      })
      .where({
        'usage_tracking.client_id': clientId,
        'usage_tracking.tenant': this.tenant,
        'usage_tracking.invoiced': false
      })
      .where('usage_tracking.usage_date', '>=', billingPeriod.startDate)
      .where('usage_tracking.usage_date', '<', billingPeriod.endDate)
      .where(function (this: Knex.QueryBuilder) {
        // Either the usage record has the specific contract line ID (use contract_line_id for contract associations)
        this.where('usage_tracking.contract_line_id', clientContractLine.contract_line_id) // Use contract_line_id here
          // Or it has no contract line ID (for backward compatibility) and should be allocated to this plan
          .orWhere(function (this: Knex.QueryBuilder) {
            this.whereNull('usage_tracking.contract_line_id');
          });
      })
      .select('usage_tracking.*', 'service_catalog.service_name', 'service_catalog.default_rate', 'service_catalog.tax_rate_id'); // Fetch tax_rate_id

    console.log('Usage record query:', usageRecordQuery.toQuery());
    const usageRecords = await usageRecordQuery;

    const usageBasedChargesPromises = usageRecords.map(async (record: any): Promise<IUsageBasedCharge> => {
      // Get the service configuration if available
      const serviceConfig = serviceConfigMap.get(record.service_id);

      // Apply minimum usage if configured
      let quantity = record.quantity;
      if (serviceConfig && quantity < (serviceConfig.config.minimum_usage ?? 0)) {
        quantity = serviceConfig.config.minimum_usage;
      }

      // Determine rate and calculate total
      let rate = Math.ceil(record.default_rate);
      let total = Math.ceil(quantity * rate);

      // If service has a custom rate in the configuration, use that
      if (serviceConfig && serviceConfig.config.custom_rate) {
        rate = Math.ceil(serviceConfig.config.custom_rate);
        total = Math.ceil(quantity * rate);
      }

      // Apply tiered pricing if enabled
      if (serviceConfig && serviceConfig.config.enable_tiered_pricing && serviceConfig.rateTiers.length > 0) {
        total = 0;
        let remainingQuantity = quantity;

        for (const tier of serviceConfig.rateTiers) {
          if (remainingQuantity <= 0) break;

          const tierMax = tier.max_quantity || Number.MAX_SAFE_INTEGER;
          const tierQuantity = Math.min(remainingQuantity, tierMax - tier.min_quantity + 1);

          if (tierQuantity > 0) {
            total += Math.ceil(tierQuantity * tier.rate);
            remainingQuantity -= tierQuantity;
          }
        }
      }

      // Determine tax info using the helper function
      const { taxRegion: serviceTaxRegion, isTaxable } = await this.getTaxInfoFromService({
        service_id: record.service_id,
        tax_rate_id: record.tax_rate_id // Pass the fetched tax_rate_id
      });

      // Calculate tax amount (will be recalculated later)
      let taxAmount = 0;
      let taxRate = 0;
      const effectiveTaxRegion = serviceTaxRegion ?? await getClientDefaultTaxRegionCode(client.client_id) ?? undefined;

      if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
        try {
          const taxServiceInstance = new TaxService();
          const taxResult = await taxServiceInstance.calculateTax(client.client_id, total, billingPeriod.endDate, effectiveTaxRegion);
          taxRate = taxResult.taxRate;
          taxAmount = taxResult.taxAmount;
        } catch (error) {
          console.error(`Error calculating initial tax for usage record ${record.usage_id}:`, error);
        }
      }

      return {
        serviceId: record.service_id,
        serviceName: record.service_name,
        quantity,
        rate,
        total,
        tax_region: effectiveTaxRegion, // Use derived region, fallback to client default lookup
        type: 'usage',
        tax_amount: taxAmount, // Set initial tax amount
        tax_rate: taxRate,     // Set initial tax rate
        usageId: record.usage_id,
        is_taxable: isTaxable, // Use derived value
        servicePeriodStart: billingPeriod.startDate,
        servicePeriodEnd: billingPeriod.endDate,
        billingTiming: 'arrears',
        // Add contract association information when the plan is covered by a contract assignment
        client_contract_id: clientContractLine.client_contract_id || undefined,
        contract_name: clientContractLine.contract_name || undefined
      };
    });

    const usageBasedCharges = await Promise.all(usageBasedChargesPromises);

    return usageBasedCharges;
  }

  private async calculateProductCharges(clientId: string, billingPeriod: IBillingPeriod, clientContractLine: IClientContractLine): Promise<IProductCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first() as IClient;

    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const tenant = this.tenant; // Capture tenant value for joins

    // TODO: The service_catalog table doesn't have a service_type column.
    // This requires further investigation to determine the correct way to filter for hardware products.
    // For now, return an empty array to prevent errors.
    // TODO: Update this query to fetch license services correctly and include tax_rate_id
    const planServices: any[] = []; // Placeholder

    const productChargesPromises = planServices.map(async (service: any): Promise<IProductCharge> => {
      // Determine tax info using the helper function
      const { taxRegion: serviceTaxRegion, isTaxable } = await this.getTaxInfoFromService({
        service_id: service.service_id,
        tax_rate_id: service.tax_rate_id // Assuming tax_rate_id is fetched
      });

      const rate = service.custom_rate || service.default_rate;
      const quantity = service.quantity || 1;
      const total = rate * quantity;

      // Calculate tax amount (will be recalculated later)
      let taxAmount = 0;
      let taxRate = 0;
      const effectiveTaxRegion = serviceTaxRegion ?? await getClientDefaultTaxRegionCode(client.client_id) ?? undefined;

      if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
        try {
          const taxServiceInstance = new TaxService();
          const taxResult = await taxServiceInstance.calculateTax(client.client_id, total, billingPeriod.endDate, effectiveTaxRegion);
          taxRate = taxResult.taxRate;
          taxAmount = taxResult.taxAmount;
        } catch (error) {
          console.error(`Error calculating initial tax for product service ${service.service_id}:`, error);
        }
      }

      const charge: IProductCharge = {
        type: 'product',
        serviceId: service.service_id,
        serviceName: service.service_name,
        quantity: quantity,
        rate: rate,
        total: total,
        tax_amount: taxAmount,
        tax_rate: taxRate,
        tax_region: effectiveTaxRegion, // Use derived region, fallback to client default lookup
        is_taxable: isTaxable,
        servicePeriodStart: billingPeriod.startDate,
        servicePeriodEnd: billingPeriod.endDate,
        billingTiming: 'arrears',
        // Add contract association information when the plan is covered by a contract assignment
        client_contract_id: clientContractLine.client_contract_id || undefined,
        contract_name: clientContractLine.contract_name || undefined
      };
      return charge;
    });
    const productCharges = await Promise.all(productChargesPromises);
    return productCharges;
  }

  private async calculateLicenseCharges(clientId: string, billingPeriod: IBillingPeriod, clientContractLine: IClientContractLine): Promise<ILicenseCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first() as IClient;

    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const tenant = this.tenant; // Capture tenant value for joins

    // TODO: The service_catalog table doesn't have a service_type column.
    // This requires further investigation to determine the correct way to filter for software licenses.
    // For now, return an empty array to prevent errors.
    const planServices: any[] = []; // Placeholder

    const licenseChargesPromises = planServices.map(async (service: any): Promise<ILicenseCharge> => {
      // Determine tax info using the helper function
      const { taxRegion: serviceTaxRegion, isTaxable } = await this.getTaxInfoFromService({
        service_id: service.service_id,
        tax_rate_id: service.tax_rate_id // Assuming tax_rate_id is fetched
      });

      const rate = service.custom_rate || service.default_rate;
      const quantity = service.quantity || 1;
      const total = rate * quantity;

      // Calculate tax amount (will be recalculated later)
      let taxAmount = 0;
      let taxRate = 0;
      const effectiveTaxRegion = serviceTaxRegion ?? await getClientDefaultTaxRegionCode(client.client_id) ?? undefined;

      if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
        try {
          const taxServiceInstance = new TaxService();
          const taxResult = await taxServiceInstance.calculateTax(client.client_id, total, billingPeriod.endDate, effectiveTaxRegion);
          taxRate = taxResult.taxRate;
          taxAmount = taxResult.taxAmount;
        } catch (error) {
          console.error(`Error calculating initial tax for license service ${service.service_id}:`, error);
        }
      }

      const charge: ILicenseCharge = {
        type: 'license',
        serviceId: service.service_id,
        serviceName: service.service_name,
        quantity: quantity,
        rate: rate,
        total: total,
        tax_amount: taxAmount,
        tax_rate: taxRate,
        tax_region: effectiveTaxRegion, // Use derived region, fallback to client default lookup
        period_start: billingPeriod.startDate,
        period_end: billingPeriod.endDate,
        servicePeriodStart: billingPeriod.startDate,
        servicePeriodEnd: billingPeriod.endDate,
        billingTiming: 'arrears',
        is_taxable: isTaxable,
        // Add contract association information when the plan is covered by a contract assignment
        client_contract_id: clientContractLine.client_contract_id || undefined,
        contract_name: clientContractLine.contract_name || undefined
      };
      return charge;
    });
    const licenseCharges = await Promise.all(licenseChargesPromises);

    return licenseCharges;
  }

  private async calculateBucketPlanCharges(clientId: string, billingPeriod: IBillingPeriod, contractLine: IClientContractLine): Promise<IBucketCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    // Get bucket configurations for this plan
    const bucketConfigs = await this.knex('client_contract_service_configuration as ccsc')
      .join('client_contract_services as ccs', function () {
        this.on('ccsc.client_contract_service_id', '=', 'ccs.client_contract_service_id')
          .andOn('ccsc.tenant', '=', 'ccs.tenant');
      })
      .leftJoin('client_contract_service_bucket_config as ccsbc', function () {
        this.on('ccsbc.config_id', '=', 'ccsc.config_id')
          .andOn('ccsbc.tenant', '=', 'ccsc.tenant');
      })
      .join('service_catalog as sc', function () {
        this.on('ccs.service_id', '=', 'sc.service_id')
          .andOn('sc.tenant', '=', 'ccs.tenant');
      })
      .where({
        'ccs.client_contract_line_id': contractLine.client_contract_line_id,
        'ccsc.configuration_type': 'Bucket',
        'ccs.tenant': client.tenant
      })
      .select(
        'ccsc.*',
        'ccsbc.*',
        'sc.service_name',
        'sc.default_rate',
        'sc.tax_rate_id',
        'ccs.service_id'
      );

    if (!bucketConfigs || bucketConfigs.length === 0) {
      return [];
    }

    // Process each bucket configuration
    const bucketChargesPromises = bucketConfigs.map(async (bucketConfig): Promise<IBucketCharge | null> => {
      // Pull usage records captured for bucket plans within this billing period
      const usageRecords = await this.knex('bucket_usage')
        .where({
          tenant: client.tenant,
          client_id: clientId,
          contract_line_id: contractLine.contract_line_id,
          service_catalog_id: bucketConfig.service_id
        })
        .where('period_start', '>=', billingPeriod.startDate)
        .where('period_end', '<=', billingPeriod.endDate)
        .select('*');

      if (usageRecords.length === 0) {
        return null;
      }

      // Normalize usage aggregates, accommodating legacy hour columns
      let minutesUsed = 0;
      let overageMinutes = 0;

      for (const record of usageRecords) {
        const recordMinutesUsed =
          Number(record.minutes_used ?? 0) ||
          (record.hours_used !== undefined ? Number(record.hours_used) * 60 : 0);
        const recordOverageMinutes =
          Number(record.overage_minutes ?? 0) ||
          (record.overage_hours !== undefined ? Number(record.overage_hours) * 60 : 0);

        minutesUsed += recordMinutesUsed;
        overageMinutes += recordOverageMinutes;
      }

      // Some datasets rely on inferred overage when explicit values are absent
      const configuredMinutes = bucketConfig.total_minutes ??
        (bucketConfig.total_hours !== undefined ? Number(bucketConfig.total_hours) * 60 : 0);
      if (!overageMinutes && configuredMinutes) {
        overageMinutes = Math.max(0, minutesUsed - configuredMinutes);
      }

      const hoursUsed = minutesUsed / 60;
      const overageHours = overageMinutes / 60;

      if (overageHours > 0) {
        // Determine tax info using the helper function
        const { taxRegion: serviceTaxRegion, isTaxable } = await this.getTaxInfoFromService({
          service_id: bucketConfig.service_id,
          tax_rate_id: bucketConfig.tax_rate_id // Pass the fetched tax_rate_id
        });

        const overageRate = Math.ceil(bucketConfig.overage_rate);
        const total = Math.ceil(overageHours * overageRate);

        // Calculate tax amount (will be recalculated later)
        let taxAmount = 0;
        let taxRate = 0;
        const effectiveTaxRegion = serviceTaxRegion ?? await getClientDefaultTaxRegionCode(client.client_id) ?? undefined;

        if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
          try {
            const taxServiceInstance = new TaxService();
            const taxResult = await taxServiceInstance.calculateTax(client.client_id, total, billingPeriod.endDate, effectiveTaxRegion);
            taxRate = taxResult.taxRate;
            taxAmount = taxResult.taxAmount;
          } catch (error) {
            console.error(`Error calculating initial tax for bucket service ${bucketConfig.service_id}:`, error);
          }
        }

        const charge: IBucketCharge = {
          type: 'bucket',
          service_catalog_id: bucketConfig.service_id, // Keep original field name if needed by interface
          serviceName: bucketConfig.service_name,
          rate: overageRate, // This seems redundant with overageRate, check interface
          total: total,
          hoursUsed: hoursUsed,
          overageHours: overageHours,
          overageRate: overageRate,
          tax_rate: taxRate,
          tax_region: effectiveTaxRegion, // Use derived region, fallback to client default lookup
          serviceId: bucketConfig.service_id, // Common field
          tax_amount: taxAmount,
          is_taxable: isTaxable,
          servicePeriodStart: billingPeriod.startDate,
          servicePeriodEnd: billingPeriod.endDate,
          billingTiming: 'arrears',
          // Add contract association information when the plan is covered by a contract assignment
          client_contract_id: contractLine.client_contract_id || undefined,
          contract_name: contractLine.contract_name || undefined
        };
        return charge;
      }
      return null; // Return null if no overage
    });

    // Filter out null results and await all promises
    const bucketCharges = (await Promise.all(bucketChargesPromises)).filter((charge): charge is IBucketCharge => charge !== null);

    return bucketCharges;
  }

  private async resolveServicePeriod(
    clientId: string,
    billingPeriod: IBillingPeriod,
    _clientContractLine: IClientContractLine,
    billingTiming: 'arrears' | 'advance'
  ): Promise<{ servicePeriodStart: ISO8601String; servicePeriodEnd: ISO8601String }> {
    const currentStart = toPlainDate(billingPeriod.startDate);
    const currentEndExclusive = toPlainDate(billingPeriod.endDate);

    if (billingTiming === 'advance') {
      const currentPeriodEnd = toISODate(currentEndExclusive.subtract({ days: 1 }));
      return {
        servicePeriodStart: toISODate(currentStart),
        servicePeriodEnd: currentPeriodEnd
      };
    }

    const cycleDays = Math.max(
      currentStart.until(currentEndExclusive, { largestUnit: 'days' }).days,
      1
    );
    const previousStart = toISODate(currentStart.subtract({ days: cycleDays }));
    const previousEnd = toISODate(currentStart.subtract({ days: 1 }));

    return {
      servicePeriodStart: previousStart,
      servicePeriodEnd: previousEnd
    };
  }

  private async hasExistingServicePeriodCharge(
    clientContractLineId: string,
    servicePeriodStart: ISO8601String,
    servicePeriodEnd: ISO8601String,
    billingTiming: 'arrears' | 'advance'
  ): Promise<boolean> {
    await this.initKnex();
    if (!this.knex || !this.tenant) {
      throw new Error('Database connection not initialized');
    }

    const existing = await this.knex('invoice_item_details as iid')
      .join('client_contract_service_configuration as ccsc', function () {
        this.on('iid.config_id', '=', 'ccsc.config_id')
          .andOn('iid.tenant', '=', 'ccsc.tenant');
      })
      .join('client_contract_services as ccs', function () {
        this.on('ccsc.client_contract_service_id', '=', 'ccs.client_contract_service_id')
          .andOn('ccsc.tenant', '=', 'ccs.tenant');
      })
      .where('iid.tenant', this.tenant)
      .andWhere('ccs.client_contract_line_id', clientContractLineId)
      .andWhere('iid.service_period_start', servicePeriodStart)
      .andWhere('iid.service_period_end', servicePeriodEnd)
      .andWhere('iid.billing_timing', billingTiming)
      .first();

    return Boolean(existing);
  }

  private buildAdvanceTerminationCredits(
    clientContractLine: IClientContractLine,
    billingPeriod: IBillingPeriod,
    advanceCharges: IFixedPriceCharge[]
  ): IFixedPriceCharge[] {
    if (!clientContractLine.end_date || advanceCharges.length === 0) {
      return [];
    }

    const periodEnd = toPlainDate(billingPeriod.endDate);
    const lineEnd = toPlainDate(clientContractLine.end_date);

    if (Temporal.PlainDate.compare(lineEnd, periodEnd) >= 0) {
      return [];
    }

    const billingStart = toPlainDate(billingPeriod.startDate);
    let creditStart = lineEnd.add({ days: 1 });
    if (Temporal.PlainDate.compare(creditStart, billingStart) < 0) {
      creditStart = billingStart;
    }

    if (Temporal.PlainDate.compare(creditStart, periodEnd) > 0) {
      return [];
    }

    const periodDays = this.calculateInclusiveDays(billingPeriod.startDate, billingPeriod.endDate);
    if (periodDays <= 0) {
      return [];
    }

    const unusedDays = creditStart.until(periodEnd, { largestUnit: 'days' }).days + 1;
    if (unusedDays <= 0) {
      return [];
    }

    const unusedFactor = Math.min(unusedDays / periodDays, 1);
    const creditStartIso = toISODate(creditStart);

    return advanceCharges
      .map((charge) => {
        const baseTotal = charge.total ?? 0;
        const baseTax = charge.tax_amount ?? 0;
        const creditTotal = Math.round(baseTotal * unusedFactor);
        const creditTax = Math.round(baseTax * unusedFactor);

        if (creditTotal === 0 && creditTax === 0) {
          return null;
        }

        return {
          ...charge,
          total: -creditTotal,
          tax_amount: -creditTax,
          servicePeriodStart: creditStartIso,
          servicePeriodEnd: billingPeriod.endDate,
          billingTiming: 'arrears' as const
        };
      })
      .filter((entry): entry is IFixedPriceCharge => Boolean(entry));
  }

  private calculateInclusiveDays(start: ISO8601String, end: ISO8601String): number {
    const startPlain = toPlainDate(start);
    const endPlain = toPlainDate(end);
    if (Temporal.PlainDate.compare(endPlain, startPlain) < 0) {
      return 0;
    }
    return startPlain.until(endPlain, { largestUnit: 'days' }).days + 1;
  }

  /**
   * Calculates the proration factor based on the plan's active dates within the billing period.
   * @returns Proration factor (0.0 to 1.0)
   */
  private _calculateProrationFactor(billingPeriod: IBillingPeriod, planStartDate: ISO8601String, planEndDate: ISO8601String | null, billingCycle: string): number {
    console.log('Billing period start:', billingPeriod.startDate);
    console.log('Billing period end:', billingPeriod.endDate);
    console.log('Plan start date:', planStartDate);
    console.log('Plan end date:', planEndDate);

    // Use our date utilities to handle the conversion
    const planStart = toPlainDate(planStartDate);
    const periodStart = toPlainDate(billingPeriod.startDate);
    const effectiveStartDate = Temporal.PlainDate.compare(planStart, periodStart) > 0 ? planStart : periodStart;
    console.log('Effective start:', toISODate(effectiveStartDate));

    let cycleLength: number;
    switch (billingCycle) {
      case 'weekly':
        cycleLength = 7;
        break;
      case 'bi-weekly':
        cycleLength = 14;
        break;
      case 'monthly': {
        const start = toPlainDate(billingPeriod.startDate);
        cycleLength = start.daysInMonth;
      }
        break;
      case 'quarterly':
        cycleLength = 91; // Approximation
        break;
      case 'semi-annually':
        cycleLength = 182; // Approximation
        break;
      case 'annually':
        cycleLength = 365; // Approximation
        break;
      default: {
        const start = toPlainDate(billingPeriod.startDate);
        cycleLength = start.daysInMonth;
      }
    }

    // Determine the effective end date for proration: the earlier of the plan end date and the period end date
    const periodEnd = toPlainDate(billingPeriod.endDate);
    const planEnd = planEndDate ? toPlainDate(planEndDate) : null;
    const effectiveEndDate = planEnd && Temporal.PlainDate.compare(planEnd, periodEnd) < 0 ? planEnd : periodEnd;
    console.log('Effective end:', toISODate(effectiveEndDate));

    // Calculate the actual number of billable days INCLUSIVE of the end date
    // Add 1 because .until is exclusive of the end date by default
    const actualDays = effectiveStartDate.until(effectiveEndDate, { largestUnit: 'days' }).days + 1;
    console.log(`Actual billable days (inclusive): ${actualDays}`);
    console.log(`Cycle length: ${cycleLength}`);

    // Ensure cycleLength is not zero to avoid division by zero
    if (cycleLength === 0) {
      console.error("Error: Cycle length is zero. Cannot calculate proration factor.");
      // Return 1.0 (no proration) if cycle length is zero to avoid division errors
      return 1.0;
    }

    const prorationFactor = actualDays / cycleLength;
    console.log(`Proration factor calculated: ${prorationFactor.toFixed(4)} (${actualDays} / ${cycleLength})`);
    return prorationFactor;
  }


  /**
   * Applies proration to applicable charges.
   * NOTE: Proration for 'fixed' charges is now handled within calculateFixedPriceCharges.
   * This function primarily handles proration for other potential future charge types if needed,
   * or acts as a fallback/consistency check.
   */
  private applyProrationToPlan(charges: IBillingCharge[], billingPeriod: IBillingPeriod, planStartDate: ISO8601String, planEndDate: ISO8601String | null, billingCycle: string): IBillingCharge[] {

    // Calculate the proration factor once
    const prorationFactor = this._calculateProrationFactor(billingPeriod, planStartDate, planEndDate, billingCycle);

    return charges.map((charge: IBillingCharge): IBillingCharge => {
      // Proration for 'fixed' type is now handled earlier in calculateFixedPriceCharges
      if (charge.type === 'fixed') {
        console.log(`Skipping proration in applyProrationToPlan for fixed charge: ${charge.serviceName} (handled earlier)`);
        return charge; // Return charge as is
      }

      // --- Example: Proration logic for other types (if needed in future) ---
      // if (charge.type === 'some_other_proratable_type') {
      //   // Check specific proration flag for this type if it exists
      //   if ((charge as any).enable_proration === false) {
      //      console.log(`Skipping proration for charge: ${charge.serviceName} (proration disabled)`);
      //      return charge;
      //   }
      //   const proratedTotal = Math.ceil(Math.ceil(charge.total) * prorationFactor);
      //   console.log(`Prorating charge: ${charge.serviceName}`);
      //   console.log(`  Original total: $${(charge.total / 100).toFixed(2)}`);
      //   console.log(`  Prorated total: $${(proratedTotal / 100).toFixed(2)}`);
      //   return { ...charge, total: proratedTotal };
      // }
      // --- End Example ---

      // If not a type that needs proration here, return as is
      return charge;
    });
  }

  private async applyDiscountsAndAdjustments(
    billingResult: IBillingResult,
    clientId: string,
    billingPeriod: IBillingPeriod
  ): Promise<IBillingResult> {
    // Fetch applicable discounts within the billing period
    const discounts = await this.fetchDiscounts(clientId, billingPeriod);

    let discountTotal = 0;
    for (const discount of discounts) {
      if (discount.discount_type === 'percentage') {
        discount.amount = (billingResult.totalAmount * (discount.value));
      } else if (discount.discount_type === 'fixed') {
        discount.amount = discount.value;
      }
      discountTotal += discount.amount || 0;
    }

    const finalAmount = billingResult.totalAmount - discountTotal;

    return {
      ...billingResult,
      discounts,
      adjustments: [], // Implement adjustments if needed
      finalAmount
    };
  }

  private async fetchDiscounts(clientId: string, billingPeriod: IBillingPeriod): Promise<IDiscount[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const { startDate, endDate } = billingPeriod;
    const discounts = await this.knex('discounts')
      .join('contract_line_discounts', function () {
        this.on('discounts.discount_id', '=', 'contract_line_discounts.discount_id')
          .andOn('contract_line_discounts.tenant', '=', 'discounts.tenant');
      })
      .join('client_contract_lines', function (this: Knex.JoinClause) {
        this.on('client_contract_lines.contract_line_id', '=', 'contract_line_discounts.contract_line_id')
          .andOn('client_contract_lines.client_id', '=', 'contract_line_discounts.client_id')
          .andOn('client_contract_lines.tenant', '=', 'contract_line_discounts.tenant');
      })
      .where({
        'client_contract_lines.client_id': clientId,
        'client_contract_lines.tenant': client.tenant,
        'discounts.is_active': true
      })
      .andWhere('discounts.start_date', '<=', endDate)
      .andWhere(function (this: Knex.QueryBuilder) {
        this.whereNull('discounts.end_date')
          .orWhere('discounts.end_date', '>', startDate);
      })
      .select('discounts.*');

    return discounts;
  }




  private async fetchAdjustments(clientId: string): Promise<IAdjustment[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const adjustments = await this.knex('adjustments')
      .where({
        client_id: clientId,
        tenant: client.tenant
      });
    return Array.isArray(adjustments) ? adjustments : [];
  }

  async rolloverUnapprovedTime(clientId: string, currentPeriodEnd: ISO8601String, nextPeriodStart: ISO8601String): Promise<void> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const client = await this.knex('clients')
      .where({
        client_id: clientId,
        tenant: this.tenant
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }
    // Fetch unapproved time entries
    const knex = this.knex;
    const unapprovedEntries = await this.knex('time_entries')
      .leftJoin('tickets', function (this: Knex.JoinClause) {
        this.on('time_entries.work_item_id', '=', 'tickets.ticket_id')
          .andOn('time_entries.work_item_type', '=', knex.raw('?', ['ticket']))
          .andOn('tickets.tenant', '=', 'time_entries.tenant')
      })
      .leftJoin('project_tasks', function (this: Knex.JoinClause) {
        this.on('time_entries.work_item_id', '=', 'project_tasks.task_id')
          .andOn('time_entries.work_item_type', '=', knex.raw('?', ['project_task']))
          .andOn('project_tasks.tenant', '=', 'time_entries.tenant')
      })
      .leftJoin('project_phases', function () {
        this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
          .andOn('project_phases.tenant', '=', 'project_tasks.tenant')
      })
      .leftJoin('projects', function () {
        this.on('project_phases.project_id', '=', 'projects.project_id')
          .andOn('projects.tenant', '=', 'project_phases.tenant')
      })
      .where({
        'time_entries.tenant': client.tenant
      })
      .where(function (this: Knex.QueryBuilder) {
        this.where('tickets.client_id', clientId)
          .orWhere('projects.client_id', clientId)
      })
      .whereIn('time_entries.approval_status', ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED'])
      .where('time_entries.end_time', '<=', currentPeriodEnd)
      .select('time_entries.*');

    // Helper function for robust date parsing, defined outside the loop
    const parseDateRobustly = (dateString: string, fieldName: string): Temporal.Instant => {
      try {
        // First try to parse as a standard ISO string
        return Temporal.Instant.from(dateString);
      } catch (error) {
        console.log(`Converting non-ISO date for ${fieldName}: ${dateString}`);
        // If that fails, try to convert using JavaScript Date
        try {
          const jsDate = new Date(dateString);
          if (isNaN(jsDate.getTime())) {
            throw new Error(`Invalid date: ${dateString}`);
          }
          return Temporal.Instant.from(jsDate.toISOString());
        } catch (innerError) {
          console.error(`Failed to convert date for ${fieldName}: ${dateString}`, innerError);
          // Last resort: use current date (or handle error differently)
          console.warn(`Falling back to current time for ${fieldName}`);
          return Temporal.Now.instant();
        }
      }
    };

    // Update the start and end times of unapproved entries to the next billing period
    for (const entry of unapprovedEntries) {
      // Get the duration of the original entry using robust parsing
      const startInstant = parseDateRobustly(entry.start_time, 'entry.start_time');
      const endInstant = parseDateRobustly(entry.end_time, 'entry.end_time');
      const durationMs = endInstant.epochMilliseconds - startInstant.epochMilliseconds;

      // Parse nextPeriodStart robustly
      const newStartInstant = parseDateRobustly(nextPeriodStart, 'nextPeriodStart');
      const newEndInstant = newStartInstant.add({ milliseconds: durationMs });
      await this.knex('time_entries')
        .where({ entry_id: entry.entry_id })
        .update({
          start_time: newStartInstant.toString(),
          end_time: newEndInstant.toString()
        });
    }

    console.log(`Rolled over ${unapprovedEntries.length} unapproved time entries for client ${clientId}`);
  }

  /**
   * Recalculates an entire invoice, including tax amounts and totals.
   * This is used when updating manual items to ensure all calculations are consistent.
   */
  async recalculateInvoice(invoiceId: string): Promise<void> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    let tenant = this.tenant;

    console.log(`Recalculating invoice ${invoiceId}`);

    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const invoice = await this.knex('invoices')
      .where({
        invoice_id: invoiceId,
        tenant: this.tenant
      })
      .first();

    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found in tenant ${this.tenant}`);
    }

    const client = await this.knex('clients')
      .where({
        client_id: invoice.client_id,
        tenant: this.tenant
      })
      .first();

    if (!client) {
      throw new Error(`Client ${invoice.client_id} not found in tenant ${this.tenant}`);
    }

    // Removed direct use of TaxService here.
    // Removed subtotal and totalTax accumulation logic.

    console.log('Starting invoice recalculation:', {
      invoiceId,
      client: {
        id: client.client_id,
        name: client.client_name,
        isTaxExempt: client.is_tax_exempt,
        // region_code is still on client table for default fallback, but not primary source for service tax
      }
    });

    await this.knex.transaction(async (trx) => {
      // Step 1: Recalculate and distribute tax across all items using the service function
      console.log(`[recalculateInvoice] Calling calculateAndDistributeTax for invoice ${invoiceId}`);
      const taxService = new TaxService(); // Instantiate TaxService here
      await calculateAndDistributeTax(trx, invoiceId, client, taxService, tenant); // Pass client object and taxService instance
      console.log(`[recalculateInvoice] Finished calculateAndDistributeTax for invoice ${invoiceId}`);

      // Step 2: Update invoice totals and record the transaction using the service function
      console.log(`[recalculateInvoice] Calling updateInvoiceTotalsAndRecordTransaction for invoice ${invoiceId}`);
      await updateInvoiceTotalsAndRecordTransaction(
        trx,
        invoiceId,
        client, // Pass client object
        tenant, // Pass tenant
        invoice.invoice_number, // Pass invoice number
        undefined,
        {
          transactionType: 'invoice_adjustment',
          description: `Adjusted invoice ${invoice.invoice_number}`
        }
      );
      console.log(`[recalculateInvoice] Finished updateInvoiceTotalsAndRecordTransaction for invoice ${invoiceId}`);

      // Note: The original logic for processing discount items and updating their net_amount
      // based on percentages is removed. It's assumed that calculateAndDistributeTax
      // handles the correct net amounts and tax distribution, including discounts.
      // If discount amounts need recalculation based on the new subtotal *before* tax distribution,
      // that logic would need to be added back here or integrated into calculateAndDistributeTax.
      // For now, we follow the instruction to delegate fully.
    });

    // Removed console log referencing deleted variables subtotal/totalTax

    // Event emission removed - moved back to invoiceModification.ts
  }
}
