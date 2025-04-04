import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import {
  IBillingPeriod,
  IBillingResult,
  IBillingCharge,
  ICompanyBillingPlan,
  IBucketPlan,
  IBucketUsage,
  IBucketCharge,
  IDiscount,
  IAdjustment,
  IUsageBasedCharge,
  ITimeBasedCharge,
  IFixedPriceCharge,
  IProductCharge,
  ILicenseCharge,
  ICompanyBillingCycle,
  BillingCycleType
} from 'server/src/interfaces/billing.interfaces';
import {
  IPlanServiceConfiguration,
  IPlanServiceFixedConfig,
  IPlanServiceHourlyConfig,
  IPlanServiceUsageConfig,
  IPlanServiceBucketConfig,
  IPlanServiceRateTier
} from 'server/src/interfaces/planServiceConfiguration.interfaces';
// Use the Temporal polyfill for all date arithmetic and plain‐date handling
import { Temporal } from '@js-temporal/polyfill';
import { ISO8601String } from 'server/src/types/types.d';
import { getCompanyTaxRate } from 'server/src/lib/actions/invoiceActions';
import { toPlainDate, toISODate } from 'server/src/lib/utils/dateTimeUtils';
import { getCompanyById } from 'server/src/lib/actions/companyActions';
import { ICompany } from 'server/src/interfaces';
import { get } from 'http';
import { TaxService } from 'server/src/lib/services/taxService';
import { v4 as uuidv4 } from 'uuid';

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

  private async hasExistingInvoiceForCycle(companyId: string, billingCycleId: string): Promise<boolean> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first();
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }

    const existingInvoice = await this.knex('invoices')
      .where({
        company_id: companyId,
        billing_cycle_id: billingCycleId,
        tenant: this.tenant
      })
      .first();
    return !!existingInvoice;
  }

  async calculateBilling(companyId: string, startDate: ISO8601String, endDate: ISO8601String, billingCycleId: string): Promise<IBillingResult & { error?: string }> {
    try {
      await this.initKnex();
      const company = await getCompanyById(companyId);
      console.log(`Calculating billing for company ${company?.company_name} (${companyId}) from ${startDate} to ${endDate}`);
      
      // Check for existing invoice in this billing cycle
      const hasExistingInvoice = await this.hasExistingInvoiceForCycle(companyId, billingCycleId);
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

      // Validate that the billing period doesn't cross a cycle change
      const validationResult = await this.validateBillingPeriod(companyId, startDate, endDate);
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
      const billingPeriod: IBillingPeriod = { startDate, endDate };
      let totalCharges: IBillingCharge[] = [];
      
      // Get billing plans and cycle
      const plansResult = await this.getCompanyBillingPlansAndCycle(companyId, billingPeriod);
      
      // Type assertion to include error property
      const { companyBillingPlans, billingCycle: cycle, error: plansError } = plansResult as {
        companyBillingPlans: ICompanyBillingPlan[];
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

      if (companyBillingPlans.length === 0) {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          error: `No active billing plans found for company ${companyId} in the given period`
        };
      }

      console.log(`Found ${companyBillingPlans.length} active billing plan(s) for company ${companyId}`);
      console.log(`Billing cycle: ${cycle}`);

      for (const companyBillingPlan of companyBillingPlans) {
        console.log(`Processing billing plan: ${companyBillingPlan.plan_name}`);
        const [
          fixedPriceCharges,
          timeBasedCharges,
          usageBasedCharges,
          bucketPlanCharges,
          productCharges,
          licenseCharges
        ] = await Promise.all([
          this.calculateFixedPriceCharges(companyId, billingPeriod, companyBillingPlan),
          this.calculateTimeBasedCharges(companyId, billingPeriod, companyBillingPlan),
          this.calculateUsageBasedCharges(companyId, billingPeriod, companyBillingPlan),
          this.calculateBucketPlanCharges(companyId, billingPeriod, companyBillingPlan),
          this.calculateProductCharges(companyId, billingPeriod, companyBillingPlan),
          this.calculateLicenseCharges(companyId, billingPeriod, companyBillingPlan)
        ]);

        console.log(`Fixed price charges: ${fixedPriceCharges.length}`);
        console.log(`Time-based charges: ${timeBasedCharges.length}`);
        console.log(`Usage-based charges: ${usageBasedCharges.length}`);
        console.log(`Bucket plan charges: ${bucketPlanCharges.length}`);
        console.log(`Product charges: ${productCharges.length}`);
        console.log(`License charges: ${licenseCharges.length}`);

        console.log(`Total fixed charges before proration: ${fixedPriceCharges.reduce((sum: number, charge: IFixedPriceCharge) => sum + charge.total, 0)}`);

        // Only prorate fixed price charges
        const proratedFixedCharges = this.applyProrationToPlan(fixedPriceCharges, billingPeriod, companyBillingPlan.start_date, cycle);

        console.log(`Total fixed charges after proration: ${proratedFixedCharges.reduce((sum: number, charge: IBillingCharge) => sum + charge.total, 0)}`);

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
          console.log(`fixed - ${charge.serviceName}: $${charge.total}`);
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
        companyId,
        billingPeriod
      );

      console.log(`Discounts applied: ${finalCharges.discounts.length}`);
      console.log(`Adjustments applied: ${finalCharges.adjustments.length}`);
      console.log(`Final amount after discounts and adjustments: $${finalCharges.finalAmount}`);      

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

  private async getCompanyBillingPlansAndCycle(companyId: string, billingPeriod: IBillingPeriod): Promise<{ companyBillingPlans: ICompanyBillingPlan[], billingCycle: string }> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first();
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }

    const billingCycle = await this.getBillingCycle(companyId, billingPeriod.startDate);
    const tenant = this.tenant; // Capture tenant value here
    
    // Get directly assigned billing plans
    const directBillingPlans = await this.knex('company_billing_plans')
      .join('billing_plans', function() {
        this.on('company_billing_plans.plan_id', '=', 'billing_plans.plan_id')
            .andOn('billing_plans.tenant', '=', 'company_billing_plans.tenant');
      })
      .where({
        'company_billing_plans.company_id': companyId,
        'company_billing_plans.is_active': true,
        'company_billing_plans.tenant': this.tenant
      })
      .whereNull('company_billing_plans.company_bundle_id') // Only get plans not associated with bundles
      .where('company_billing_plans.start_date', '<=', billingPeriod.endDate)
      .where(function (this: any) {
        this.where('company_billing_plans.end_date', '>=', billingPeriod.startDate).orWhereNull('company_billing_plans.end_date');
      })
      .select(
        'company_billing_plans.*',
        'billing_plans.plan_name',
        'billing_plans.billing_frequency'
      );

    // Get plans from active bundles
    const bundlePlans = await this.knex('company_plan_bundles')
      .join('bundle_billing_plans', function() {
        this.on('company_plan_bundles.bundle_id', '=', 'bundle_billing_plans.bundle_id')
            .andOn('bundle_billing_plans.tenant', '=', 'company_plan_bundles.tenant');
      })
      .join('billing_plans', function() {
        this.on('bundle_billing_plans.plan_id', '=', 'billing_plans.plan_id')
            .andOn('billing_plans.tenant', '=', 'bundle_billing_plans.tenant');
      })
      .join('plan_bundles', function() {
        this.on('company_plan_bundles.bundle_id', '=', 'plan_bundles.bundle_id')
            .andOn('plan_bundles.tenant', '=', 'company_plan_bundles.tenant');
      })
      .where({
        'company_plan_bundles.company_id': companyId,
        'company_plan_bundles.is_active': true,
        'company_plan_bundles.tenant': this.tenant
      })
      .where('company_plan_bundles.start_date', '<=', billingPeriod.endDate)
      .where(function (this: any) {
        this.where('company_plan_bundles.end_date', '>=', billingPeriod.startDate).orWhereNull('company_plan_bundles.end_date');
      })
      .select(
        'bundle_billing_plans.plan_id',
        'billing_plans.plan_name',
        'billing_plans.billing_frequency',
        'billing_plans.service_category',
        'bundle_billing_plans.custom_rate',
        'company_plan_bundles.start_date',
        'company_plan_bundles.end_date',
        'company_plan_bundles.company_bundle_id',
        'plan_bundles.bundle_name'
      );

    // Convert bundle plans to company billing plan format
    const formattedBundlePlans = bundlePlans.map((plan: any) => {
      return {
        company_billing_plan_id: `bundle-${plan.company_bundle_id}-${plan.plan_id}`, // Generate a virtual ID
        company_id: companyId,
        plan_id: plan.plan_id,
        service_category: plan.service_category,
        start_date: plan.start_date,
        end_date: plan.end_date,
        is_active: true,
        custom_rate: plan.custom_rate,
        company_bundle_id: plan.company_bundle_id,
        plan_name: plan.plan_name,
        billing_frequency: plan.billing_frequency,
        bundle_name: plan.bundle_name,
        tenant: this.tenant
      };
    });

    // Combine direct plans and bundle plans
    const companyBillingPlans = [...directBillingPlans, ...formattedBundlePlans];

    // Convert dates from the DB into plain ISO strings using our date utilities
    companyBillingPlans.forEach((plan: any) => {
      plan.start_date = toISODate(toPlainDate(plan.start_date));
      plan.end_date = plan.end_date ? toISODate(toPlainDate(plan.end_date)) : null;
    });

    return { companyBillingPlans, billingCycle };
  }

  private async getBillingCycle(companyId: string, date: ISO8601String = toISODate(Temporal.Now.plainDateISO())): Promise<string> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first();
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }

    const result = await this.knex('company_billing_cycles')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .where('effective_date', '<=', date)
      .orderBy('effective_date', 'desc')
      .first() as ICompanyBillingCycle | undefined;

    if (!result) {
      // Check again for existing cycle to handle race conditions
      const existingCycle = await this.knex('company_billing_cycles')
        .where({
          company_id: companyId,
          tenant: this.tenant
        })
        .first();

      if (existingCycle) {
        return existingCycle.billing_cycle;
      }

      try {
        const defaultCycle: Partial<ICompanyBillingCycle> = {
          company_id: companyId,
          billing_cycle: 'monthly',
          effective_date: '2023-01-01T00:00:00Z',
          tenant: this.tenant
        };
        
        await this.knex('company_billing_cycles').insert(defaultCycle);
      } catch (error) {
        // If insert fails due to race condition, get the existing record
        const cycle = await this.knex('company_billing_cycles')
          .where({
            company_id: companyId,
            tenant: this.tenant
          })
          .first();
        
        if (!cycle) {
          throw new Error(`Failed to create or retrieve billing cycle for company ${companyId} in tenant ${this.tenant}`);
        }
        
        return cycle.billing_cycle;
      }
      return 'monthly' as BillingCycleType;
    }

    return result.billing_cycle as BillingCycleType;
  }

  private async validateBillingPeriod(companyId: string, startDate: ISO8601String, endDate: ISO8601String): Promise<{ success: boolean; error?: string }> {
    try {
      await this.initKnex();
      if (!this.tenant) {
        return {
          success: false,
          error: "tenant context not found"
        };
      }

      const company = await this.knex('companies')
        .where({
          company_id: companyId,
          tenant: this.tenant
        })
        .first();
      if (!company) {
        return {
          success: false,
          error: `Company ${companyId} not found in tenant ${this.tenant}`
        };
      }

      const cycles = await this.knex('company_billing_cycles')
        .where({
          company_id: companyId,
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
        await this.getBillingCycle(companyId, startDate);
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to validate billing period'
      };
    }
  }

  private async calculateFixedPriceCharges(companyId: string, billingPeriod: IBillingPeriod, companyBillingPlan: ICompanyBillingPlan): Promise<IFixedPriceCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first() as ICompany;
    
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }
      
    const tenant = this.tenant; // Capture tenant value for joins
    
    // Use the new plan_service_configuration tables
    const planServices = await this.knex('company_billing_plans')
      .join('plan_service_configuration', function() {
        this.on('company_billing_plans.plan_id', '=', 'plan_service_configuration.plan_id')
            .andOn('plan_service_configuration.tenant', '=', 'company_billing_plans.tenant');
      })
      .join('plan_service_fixed_config', function() {
        this.on('plan_service_configuration.config_id', '=', 'plan_service_fixed_config.config_id')
            .andOn('plan_service_fixed_config.tenant', '=', 'plan_service_configuration.tenant');
      })
      .join('service_catalog', function() {
        this.on('plan_service_configuration.service_id', '=', 'service_catalog.service_id')
            .andOn('service_catalog.tenant', '=', 'plan_service_configuration.tenant');
      })
      .where({
        'company_billing_plans.company_id': companyId,
        'company_billing_plans.company_billing_plan_id': companyBillingPlan.company_billing_plan_id,
        'company_billing_plans.tenant': company.tenant,
        'plan_service_configuration.configuration_type': 'Fixed'
      })
      .select(
        'service_catalog.*',
        'plan_service_configuration.quantity',
        'plan_service_configuration.custom_rate',
        'plan_service_fixed_config.enable_proration',
        'plan_service_fixed_config.billing_cycle_alignment'
      );

    const fixedCharges: IFixedPriceCharge[] = planServices.map((service: any):IFixedPriceCharge => {
      const charge: IFixedPriceCharge = {
        serviceId: service.service_id,
        serviceName: service.service_name,
        quantity: service.quantity,
        rate: service.custom_rate || service.default_rate,
        total: (service.custom_rate || service.default_rate) * service.quantity,
        type: 'fixed',
        tax_amount: 0,
        tax_rate: 0,
        tax_region: service.tax_region || company.tax_region,
        is_taxable: service.is_taxable !== false
      };
  
      if (!company.is_tax_exempt && service.is_taxable !== false) {
        charge.tax_rate = service.tax_rate || 0;
        charge.tax_amount = charge.total * (charge.tax_rate);
      } else {
        charge.tax_rate = 0;
        charge.tax_amount = 0;
      }
  
      return charge;
    });

    console.log(`Fixed price charges for company ${companyId}:`, fixedCharges);
    return fixedCharges;
  }    

  private async calculateTimeBasedCharges(companyId: string, billingPeriod: IBillingPeriod, companyBillingPlan: ICompanyBillingPlan): Promise<ITimeBasedCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first();
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }
    
    // Fetch the billing plan details to get plan-wide settings
    const plan = await this.knex('billing_plans')
      .where({
        plan_id: companyBillingPlan.plan_id,
        tenant: this.tenant
      })
      .first();
      
    if (!plan) {
        throw new Error(`Billing plan ${companyBillingPlan.plan_id} not found for company ${companyId}`);
    }

    const tenant = this.tenant; // Capture tenant value for joins
    
    // First get the hourly configurations for this plan
    const hourlyConfigs = await this.knex('plan_service_configuration')
      .join('plan_service_hourly_config', function() {
        this.on('plan_service_configuration.config_id', '=', 'plan_service_hourly_config.config_id')
            .andOn('plan_service_hourly_config.tenant', '=', 'plan_service_configuration.tenant');
      })
      .where({
        'plan_service_configuration.plan_id': companyBillingPlan.plan_id,
        'plan_service_configuration.configuration_type': 'Hourly',
        'plan_service_configuration.tenant': tenant
      })
      .select('plan_service_configuration.*', 'plan_service_hourly_config.*');
    
    // Create a map of service IDs to their hourly configurations
    const serviceConfigMap = new Map<string, {
      config: IPlanServiceConfiguration & IPlanServiceHourlyConfig,
      userTypeRates: Map<string, number>
    }>();
    
    for (const config of hourlyConfigs) {
      // Get user type rates if any
      const userTypeRates = await this.knex('user_type_rates')
        .where({
          config_id: config.config_id,
          tenant
        })
        .select('*');
      
      const userRateMap = new Map<string, number>();
      for (const rate of userTypeRates) {
        userRateMap.set(rate.user_type, rate.rate);
      }
      
      serviceConfigMap.set(config.service_id, {
        config,
        userTypeRates: userRateMap
      });
    }
    
    const query = this.knex('time_entries')
      .join('users', function() {
        this.on('time_entries.user_id', '=', 'users.user_id')
            .andOn('users.tenant', '=', 'time_entries.tenant');
      })
      .leftJoin('project_ticket_links', function() {
        this.on('time_entries.work_item_id', '=', 'project_ticket_links.ticket_id')
            .andOn('project_ticket_links.tenant', '=', 'time_entries.tenant');
      })
      .leftJoin('project_tasks', function() {
        this.on('time_entries.work_item_id', '=', 'project_tasks.task_id')
            .andOn('project_tasks.tenant', '=', 'time_entries.tenant');
      })
      .leftJoin('project_phases', function() {
        this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
            .andOn('project_phases.tenant', '=', 'project_tasks.tenant');
      })
      .leftJoin('projects', function() {
        this.on('project_phases.project_id', '=', 'projects.project_id')
            .andOn('projects.tenant', '=', 'project_phases.tenant');
      })
      .leftJoin('tickets', function() {
        this.on('time_entries.work_item_id', '=', 'tickets.ticket_id')
            .andOn('tickets.tenant', '=', 'time_entries.tenant');
      })
      .join('service_catalog', function() {
        this.on('time_entries.service_id', '=', 'service_catalog.service_id')
            .andOn('service_catalog.tenant', '=', 'time_entries.tenant');
      })
      .where({
        'time_entries.tenant': company.tenant
      })
      .where('time_entries.start_time', '>=', billingPeriod.startDate)
      .where('time_entries.end_time', '<', billingPeriod.endDate)
      .where('time_entries.invoiced', false)
      .where(function(this: Knex.QueryBuilder) {
        // Either the time entry has the specific billing plan ID
        this.where('time_entries.billing_plan_id', companyBillingPlan.company_billing_plan_id)
          // Or it has no billing plan ID (for backward compatibility) and should be allocated to this plan
          .orWhere(function(this: Knex.QueryBuilder) {
            this.whereNull('time_entries.billing_plan_id');
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
        this.where('projects.company_id', companyId)
          .orWhere('tickets.company_id', companyId)
      })
      .where('time_entries.approval_status', 'APPROVED')
      .select(
        'time_entries.*',
        'service_catalog.service_name',
        'service_catalog.default_rate',
        'plan_services.custom_rate',
        this.knex.raw('COALESCE(project_tasks.task_name, tickets.title) as work_item_name')
      );

    console.log('Time entries query:', query.toString());
    const timeEntries = await query;

    console.log('Time entries:', timeEntries);

    const timeBasedCharges: ITimeBasedCharge[] = timeEntries.map((entry: any):ITimeBasedCharge => {
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
      
      return {
        serviceId: entry.service_id,
        serviceName: entry.service_name,
        userId: entry.user_id,
        duration,
        rate,
        total,
        type: 'time',
        tax_amount: 0,
        tax_rate: 0,
        tax_region: entry.tax_region || entry.company_tax_region,
        entryId: entry.entry_id,
        is_taxable: entry.is_taxable !== false
      };
    });

    return timeBasedCharges;
  }

  private async calculateUsageBasedCharges(companyId: string, billingPeriod: IBillingPeriod, companyBillingPlan: ICompanyBillingPlan): Promise<IUsageBasedCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first();
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }

    const tenant = this.tenant; // Capture tenant value for joins
    
    // First get the usage configurations for this plan
    const usageConfigs = await this.knex('plan_service_configuration')
      .join('plan_service_usage_config', function() {
        this.on('plan_service_configuration.config_id', '=', 'plan_service_usage_config.config_id')
            .andOn('plan_service_usage_config.tenant', '=', 'plan_service_configuration.tenant');
      })
      .where({
        'plan_service_configuration.plan_id': companyBillingPlan.plan_id,
        'plan_service_configuration.configuration_type': 'Usage',
        'plan_service_configuration.tenant': tenant
      })
      .select('plan_service_configuration.*', 'plan_service_usage_config.*');
    
    // Create a map of service IDs to their usage configurations and rate tiers
    const serviceConfigMap = new Map<string, {
      config: IPlanServiceConfiguration & IPlanServiceUsageConfig,
      rateTiers: IPlanServiceRateTier[]
    }>();
    
    for (const config of usageConfigs) {
      // Get rate tiers if tiered pricing is enabled
      let rateTiers: IPlanServiceRateTier[] = [];
      if (config.enable_tiered_pricing) {
        rateTiers = await this.knex('plan_service_rate_tiers')
          .where({
            config_id: config.config_id,
            tenant
          })
          .orderBy('min_quantity', 'asc')
          .select('*');
      }
      
      serviceConfigMap.set(config.service_id, {
        config,
        rateTiers
      });
    }
    
    const usageRecordQuery = this.knex('usage_tracking')
      .join('service_catalog', function() {
        this.on('usage_tracking.service_id', '=', 'service_catalog.service_id')
            .andOn('service_catalog.tenant', '=', 'usage_tracking.tenant');
      })
      .where({
        'usage_tracking.company_id': companyId,
        'usage_tracking.tenant': this.tenant,
        'usage_tracking.invoiced': false
      })
      .where('usage_tracking.usage_date', '>=', billingPeriod.startDate)
      .where('usage_tracking.usage_date', '<', billingPeriod.endDate)
      .where(function(this: Knex.QueryBuilder) {
        // Either the usage record has the specific billing plan ID
        this.where('usage_tracking.billing_plan_id', companyBillingPlan.company_billing_plan_id)
          // Or it has no billing plan ID (for backward compatibility) and should be allocated to this plan
          .orWhere(function(this: Knex.QueryBuilder) {
            this.whereNull('usage_tracking.billing_plan_id');
          });
      })
      .select('usage_tracking.*', 'service_catalog.service_name', 'service_catalog.default_rate');

      console.log('Usage record query:', usageRecordQuery.toQuery());
      const usageRecords = await usageRecordQuery;

    const usageBasedCharges: IUsageBasedCharge[] = usageRecords.map((record: any):IUsageBasedCharge => {
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
      
      return {
        serviceId: record.service_id,
        serviceName: record.service_name,
        quantity,
        rate,
        total,
        tax_region: record.tax_region || record.company_tax_region,
        type: 'usage',
        tax_amount: 0,
        tax_rate: 0,
        usageId: record.usage_id,
        is_taxable: record.is_taxable !== false
      };
    });

    return usageBasedCharges;
  }

  private async calculateProductCharges(companyId: string, billingPeriod: IBillingPeriod, companyBillingPlan: ICompanyBillingPlan): Promise<IProductCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first() as ICompany;
    
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }
      
    const tenant = this.tenant; // Capture tenant value for joins
    
    // Get product services from the configuration tables
    const planServices = await this.knex('company_billing_plans')
      .join('plan_service_configuration', function() {
        this.on('company_billing_plans.plan_id', '=', 'plan_service_configuration.plan_id')
            .andOn('plan_service_configuration.tenant', '=', 'company_billing_plans.tenant');
      })
      .join('service_catalog', function() {
        this.on('plan_service_configuration.service_id', '=', 'service_catalog.service_id')
            .andOn('service_catalog.tenant', '=', 'plan_service_configuration.tenant');
      })
      .where({
        'company_billing_plans.company_id': companyId,
        'company_billing_plans.company_billing_plan_id': companyBillingPlan.company_billing_plan_id,
        'company_billing_plans.tenant': company.tenant,
        'service_catalog.service_type': 'Hardware' // Updated filter to use new category
      })
      .select(
        'service_catalog.*',
        'plan_service_configuration.quantity',
        'plan_service_configuration.custom_rate'
      );

    const productCharges: IProductCharge[] = planServices.map((service: any): IProductCharge => {
      const charge: IProductCharge = {
        type: 'product',
        serviceId: service.service_id,
        serviceName: service.service_name,
        quantity: service.quantity,
        rate: service.custom_rate || service.default_rate,
        total: (service.custom_rate || service.default_rate) * service.quantity,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: service.tax_region || company.tax_region,
        is_taxable: service.is_taxable !== false
      };

      if (!company.is_tax_exempt && service.is_taxable !== false) {
        charge.tax_rate = service.tax_rate || 0;
        charge.tax_amount = charge.total * (charge.tax_rate);
      }

      return charge;
    });

    return productCharges;
  }

  private async calculateLicenseCharges(companyId: string, billingPeriod: IBillingPeriod, companyBillingPlan: ICompanyBillingPlan): Promise<ILicenseCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first() as ICompany;
    
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }
    
    const tenant = this.tenant; // Capture tenant value for joins
    
    // Get license services from the configuration tables
    const planServices = await this.knex('company_billing_plans')
      .join('plan_service_configuration', function() {
        this.on('company_billing_plans.plan_id', '=', 'plan_service_configuration.plan_id')
            .andOn('plan_service_configuration.tenant', '=', 'company_billing_plans.tenant');
      })
      .join('service_catalog', function() {
        this.on('plan_service_configuration.service_id', '=', 'service_catalog.service_id')
            .andOn('service_catalog.tenant', '=', 'plan_service_configuration.tenant');
      })
      .where({
        'company_billing_plans.company_id': companyId,
        'company_billing_plans.company_billing_plan_id': companyBillingPlan.company_billing_plan_id,
        'company_billing_plans.tenant': company.tenant,
        'service_catalog.service_type': 'Software License' // Updated filter to use new category
      })
      .select(
        'service_catalog.*',
        'plan_service_configuration.quantity',
        'plan_service_configuration.custom_rate'
      );

    const licenseCharges: ILicenseCharge[] = planServices.map((service: any): ILicenseCharge => {
      const charge: ILicenseCharge = {
        type: 'license',
        serviceId: service.service_id,
        serviceName: service.service_name,
        quantity: service.quantity,
        rate: service.custom_rate || service.default_rate,
        total: (service.custom_rate || service.default_rate) * service.quantity,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: service.tax_region || company.tax_region,
        period_start: billingPeriod.startDate,
        period_end: billingPeriod.endDate,
        is_taxable: service.is_taxable !== false
      };

      if (!company.is_tax_exempt && service.is_taxable !== false) {
        charge.tax_rate = service.tax_rate || 0;
        charge.tax_amount = charge.total * (charge.tax_rate);
      }

      return charge;
    });

    return licenseCharges;
  }

  private async calculateBucketPlanCharges(companyId: string, period: IBillingPeriod, billingPlan: ICompanyBillingPlan): Promise<IBucketCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first();
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }

    // Get bucket configurations for this plan
    const bucketConfigs = await this.knex('plan_service_configuration')
      .join('plan_service_bucket_config', function() {
        this.on('plan_service_configuration.config_id', '=', 'plan_service_bucket_config.config_id')
            .andOn('plan_service_bucket_config.tenant', '=', 'plan_service_configuration.tenant');
      })
      .join('service_catalog', function() {
        this.on('plan_service_configuration.service_id', '=', 'service_catalog.service_id')
            .andOn('service_catalog.tenant', '=', 'plan_service_configuration.tenant');
      })
      .where({
        'plan_service_configuration.plan_id': billingPlan.plan_id,
        'plan_service_configuration.configuration_type': 'Bucket',
        'plan_service_configuration.tenant': company.tenant
      })
      .select(
        'plan_service_configuration.*',
        'plan_service_bucket_config.*',
        'service_catalog.service_name',
        'service_catalog.is_taxable',
        'service_catalog.tax_region'
      );

    if (!bucketConfigs || bucketConfigs.length === 0) {
      return [];
    }
    
    // Process each bucket configuration
    const bucketCharges: IBucketCharge[] = [];
    
    for (const bucketConfig of bucketConfigs) {
      // Get usage data for this service
      const timeEntries = await this.knex('time_entries')
        .where({
          service_id: bucketConfig.service_id,
          tenant: company.tenant,
          invoiced: false
        })
        .where('start_time', '>=', period.startDate)
        .where('end_time', '<', period.endDate)
        .select('*');
      
      // Calculate total hours used
      let hoursUsed = 0;
      for (const entry of timeEntries) {
        const startDateTime = Temporal.PlainDateTime.from(entry.start_time.toISOString().replace('Z', ''));
        const endDateTime = Temporal.PlainDateTime.from(entry.end_time.toISOString().replace('Z', ''));
        const duration = Math.floor(startDateTime.until(endDateTime, { largestUnit: 'hours' }).hours);
        hoursUsed += duration;
      }
      
      // Calculate overage
      const totalHours = bucketConfig.total_hours;
      const overageHours = Math.max(0, hoursUsed - totalHours);
      
      if (overageHours > 0) {
        const taxRegion = bucketConfig.tax_region || company.tax_region;
        const taxRate = await getCompanyTaxRate(taxRegion, period.endDate);

        const overageRate = Math.ceil(bucketConfig.overage_rate);
        const total = Math.ceil(overageHours * overageRate);
        const taxAmount = Math.ceil((taxRate) * total);

        const charge: IBucketCharge = {
          type: 'bucket',
          service_catalog_id: bucketConfig.service_id,
          serviceName: bucketConfig.service_name,
          rate: overageRate,
          total: total,
          hoursUsed: hoursUsed,
          overageHours: overageHours,
          overageRate: overageRate,
          tax_rate: taxRate,
          tax_region: taxRegion,
          serviceId: bucketConfig.service_id,
          tax_amount: taxAmount,
          is_taxable: bucketConfig.is_taxable !== false
        };

        bucketCharges.push(charge);
      }
    }

    return bucketCharges;
  }


  private applyProrationToPlan(charges: IBillingCharge[], billingPeriod: IBillingPeriod, planStartDate: ISO8601String, billingCycle: string): IBillingCharge[] {
    console.log('Billing period start:', billingPeriod.startDate);
    console.log('Billing period end:', billingPeriod.endDate);
    console.log('Plan start date:', planStartDate);

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

    // Calculate the actual number of days in the billing period
    const periodEnd = toPlainDate(billingPeriod.endDate);
    const actualDays = effectiveStartDate.until(periodEnd, { largestUnit: 'days' }).days;
    console.log(`Actual days in plan period: ${actualDays}`);
    console.log(`Cycle length: ${cycleLength}`);

    const prorationFactor = actualDays / cycleLength;
    console.log(`Proration factor: ${prorationFactor.toFixed(4)} (${actualDays} / ${cycleLength})`);

    return charges.map((charge: IBillingCharge): IBillingCharge => {
      // Check if this charge should be prorated
      // For fixed charges, we need to check if proration is enabled in the configuration
      if (charge.type === 'fixed') {
        // The enable_proration flag would be added to the charge by the calculateFixedPriceCharges method
        if ((charge as any).enable_proration === false) {
          console.log(`Skipping proration for charge: ${charge.serviceName} (proration disabled)`);
          return charge;
        }
      }
      
      const proratedTotal = Math.ceil(Math.ceil(charge.total) * prorationFactor);
      console.log(`Prorating charge: ${charge.serviceName}`);
      console.log(`  Original total: $${(charge.total/100).toFixed(2)}`);
      console.log(`  Prorated total: $${(proratedTotal/100).toFixed(2)}`);
      return {
        ...charge,
        total: proratedTotal
      };
    });
  }

  private async applyDiscountsAndAdjustments(
    billingResult: IBillingResult,
    companyId: string,
    billingPeriod: IBillingPeriod
  ): Promise<IBillingResult> {
    // Fetch applicable discounts within the billing period
    const discounts = await this.fetchDiscounts(companyId, billingPeriod);

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

  private async fetchDiscounts(companyId: string, billingPeriod: IBillingPeriod): Promise<IDiscount[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first();
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }

    const { startDate, endDate } = billingPeriod;
    const discounts = await this.knex('discounts')
      .join('plan_discounts', function() {
        this.on('discounts.discount_id', '=', 'plan_discounts.discount_id')
            .andOn('plan_discounts.tenant', '=', 'discounts.tenant');
      })
      .join('company_billing_plans', function (this: Knex.JoinClause) {
        this.on('company_billing_plans.plan_id', '=', 'plan_discounts.plan_id')
          .andOn('company_billing_plans.company_id', '=', 'plan_discounts.company_id')
          .andOn('company_billing_plans.tenant', '=', 'plan_discounts.tenant');
      })
      .where({
        'company_billing_plans.company_id': companyId,
        'company_billing_plans.tenant': company.tenant,
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




  private async fetchAdjustments(companyId: string): Promise<IAdjustment[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first();
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }

    const adjustments = await this.knex('adjustments')
      .where({ 
        company_id: companyId,
        tenant: company.tenant 
      });
    return Array.isArray(adjustments) ? adjustments : [];
  }

  async rolloverUnapprovedTime(companyId: string, currentPeriodEnd: ISO8601String, nextPeriodStart: ISO8601String): Promise<void> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const company = await this.knex('companies')
      .where({
        company_id: companyId,
        tenant: this.tenant
      })
      .first();
    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${this.tenant}`);
    }
    // Fetch unapproved time entries
    const knex = this.knex;
    const unapprovedEntries = await this.knex('time_entries')
      .leftJoin('tickets', function (this: Knex.JoinClause) {
        this.on('time_entries.work_item_id', '=', 'tickets.ticket_id')
          .andOn('time_entries.work_item_type', '=', knex.raw('?', ['ticket']))
      })
      .leftJoin('project_tasks', function (this: Knex.JoinClause) {
        this.on('time_entries.work_item_id', '=', 'project_tasks.task_id')
          .andOn('time_entries.work_item_type', '=', knex.raw('?', ['project_task']))
          .andOn('project_tasks.tenant', '=', 'time_entries.tenant')
      })
      .leftJoin('project_phases', function() {
        this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
            .andOn('project_phases.tenant', '=', 'project_tasks.tenant')
      })
      .leftJoin('projects', function() {
        this.on('project_phases.project_id', '=', 'projects.project_id')
            .andOn('projects.tenant', '=', 'project_phases.tenant')
      })
      .where({
        'time_entries.tenant': company.tenant
      })
      .where(function (this: Knex.QueryBuilder) {
        this.where('tickets.company_id', companyId)
          .orWhere('projects.company_id', companyId)
      })
      .whereIn('time_entries.approval_status', ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED'])
      .where('time_entries.end_time', '<=', currentPeriodEnd)
      .select('time_entries.*');

    // Update the start and end times of unapproved entries to the next billing period
    for (const entry of unapprovedEntries) {
      const startInstant = Temporal.Instant.from(entry.start_time);
      const endInstant = Temporal.Instant.from(entry.end_time);
      const durationMs = endInstant.epochMilliseconds - startInstant.epochMilliseconds;
      const newStartInstant = Temporal.Instant.from(nextPeriodStart);
      const newEndInstant = newStartInstant.add({ milliseconds: durationMs });
      await this.knex('time_entries')
        .where({ entry_id: entry.entry_id })
        .update({
          start_time: newStartInstant.toString(),
          end_time: newEndInstant.toString()
        });
    }

    console.log(`Rolled over ${unapprovedEntries.length} unapproved time entries for company ${companyId}`);
  }

  /**
   * Recalculates an entire invoice, including tax amounts and totals.
   * This is used when updating manual items to ensure all calculations are consistent.
   */
  async recalculateInvoice(invoiceId: string): Promise<void> {
    await this.initKnex();
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

    const company = await this.knex('companies')
      .where({
        company_id: invoice.company_id,
        tenant: this.tenant
      })
      .first();

    if (!company) {
      throw new Error(`Company ${invoice.company_id} not found in tenant ${this.tenant}`);
    }

    const taxService = new TaxService();
    let subtotal = 0;
    let totalTax = 0;

    // Process each line item
    const items = await this.knex('invoice_items')
      .where({ invoice_id: invoiceId })
      .orderBy('created_at', 'asc');

    console.log(`Processing ${items.length} invoice items`);

    console.log('Starting invoice recalculation:', {
      invoiceId,
      itemCount: items.length,
      company: {
        id: company.company_id,
        name: company.company_name,
        isTaxExempt: company.is_tax_exempt,
        taxRegion: company.tax_region
      }
    });

    await this.knex.transaction(async (trx) => {
      // First process non-discount items
      const regularItems = items.filter(item => !item.is_discount);
      for (const item of regularItems) {
        // Get service details for tax info
        const service = await trx('service_catalog')
          .where({ 
            service_id: item.service_id,
            tenant: company.tenant 
          })
          .first();

        // Ensure netAmount is an integer
        const netAmount = typeof item.net_amount === 'string' ? parseInt(item.net_amount, 10) : item.net_amount;
        let taxAmount = 0;
        let taxRate = 0;

        console.log('Processing regular item:', {
          itemId: item.item_id,
          serviceId: item.service_id,
          serviceName: service?.service_name,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          netAmount,
          isTaxable: service ? service.is_taxable !== false : true,
          taxRegion: service?.tax_region || company.tax_region
        });

        // Only calculate tax for taxable items and non-exempt companies
        if (!company.is_tax_exempt && item.is_taxable !== false) {
          const taxCalculationResult = await taxService.calculateTax(
            company.company_id,
            netAmount,
            toISODate(Temporal.Now.plainDateISO()),
            service?.tax_region || item.tax_region
          );
          taxAmount = Math.round(taxCalculationResult.taxAmount);
          taxRate = taxCalculationResult.taxRate;
        }

        const totalPrice = netAmount + taxAmount;

        // Update item with new tax calculation
        await trx('invoice_items')
          .where({ item_id: item.item_id })
          .update({
            tax_amount: taxAmount,
            tax_rate: taxRate,
            tax_region: service?.tax_region || company.tax_region,
            total_price: totalPrice
          });

        subtotal = Math.round(subtotal + netAmount);
        totalTax = Math.round(totalTax + taxAmount);
      }

      // Then process discount items (which should already have negative amounts)
      const discountItems = items.filter(item => item.is_discount);
      for (const item of discountItems) {
        console.log('item:', item);
        let netAmount: number;
        // Ensure netAmount is an integer and is negative
        netAmount = typeof item.net_amount === 'string' ?
          -Math.abs(parseInt(item.net_amount, 10)) :
          -Math.abs(item.net_amount);

        console.log('Processing discount item:', {
          itemId: item.item_id,
          discountType: item.discount_type,
          netAmount,
          appliesTo: item.applies_to_item_id || 'entire invoice'
        });

        // No tax calculation needed for discounts
        const taxAmount = 0;
        const taxRate = 0;

        if (item.discount_type === 'percentage') {
          // For percentage discounts, calculate based on applicable amount and stored percentage
          const applicableAmount = item.applies_to_item_id
            ? (await trx('invoice_items')
                .where({ item_id: item.applies_to_item_id })
                .first())?.net_amount || 0
            : subtotal;
          
          // Use discount_percentage field instead of rate for percentage calculation
          const percentage = item.discount_percentage || 0;
          netAmount = -Math.round((applicableAmount * percentage) / 100);

          console.log('Processing percentage discount:', {
            itemId: item.item_id,
            percentage,
            applicableAmount,
            calculatedDiscount: netAmount,
            appliesTo: item.applies_to_item_id || 'entire invoice'
          });

          // Update discount item, preserving the original percentage
          await trx('invoice_items')
            .where({ item_id: item.item_id })
            .update({
              net_amount: netAmount,
              tax_amount: 0,
              tax_rate: 0,
              total_price: netAmount,
              unit_price: netAmount, // Store calculated amount in unit_price
              discount_percentage: percentage // Preserve the original percentage
            });
        } else {
          // Fixed amount discounts
          netAmount = Math.round(item.net_amount);

          console.log('Processing fixed discount:', {
            itemId: item.item_id,
            fixedAmount: netAmount,
            appliesTo: item.applies_to_item_id || 'entire invoice'
          });

          // Update fixed discount item
          await trx('invoice_items')
            .where({ item_id: item.item_id })
            .update({
              net_amount: netAmount,
              tax_amount: 0,
              tax_rate: 0,
              total_price: netAmount,
              unit_price: netAmount,
              discount_percentage: null // Clear any percentage for fixed discounts
            });
        }

        subtotal = Math.round(subtotal + netAmount);
      }

      // Calculate final totals using Math.round for consistent rounding
      const finalSubtotal = Math.round(subtotal);
      const finalTax = Math.round(totalTax);
      const finalTotal = Math.round(finalSubtotal + finalTax);

      console.log('Final totals:', {
        finalSubtotal,
        finalTax,
        finalTotal,
        originalSubtotal: subtotal,
        originalTax: totalTax,
        originalTotal: subtotal + totalTax
      });

      // Update invoice totals
      await trx('invoices')
        .where({ invoice_id: invoiceId })
        .update({
          subtotal: finalSubtotal,
          tax: finalTax,
          total_amount: finalTotal
        });

      // Record adjustment transaction
      await trx('transactions').insert({
        transaction_id: uuidv4(),
        tenant: this.tenant,
        company_id: invoice.company_id,
        invoice_id: invoiceId,
        amount: finalTotal,
        type: 'invoice_adjustment',
        status: 'completed',
        description: `Recalculated invoice ${invoice.invoice_number}`,
        created_at: toISODate(Temporal.Now.plainDateISO()),
        balance_after: finalTotal
      });
    });

    console.log(`Invoice ${invoiceId} recalculated:`, {
      subtotal: subtotal,
      tax: totalTax,
      total: subtotal + totalTax
    });
  }
}
