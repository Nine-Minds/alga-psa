import { ICompanyTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday, ITaxCalculationResult } from '../../interfaces/tax.interfaces';
import CompanyTaxSettings from '../models/companyTaxSettings';
import { ISO8601String } from '../../types/types.d';
import { createTenantKnex } from '../db';
import { v4 as uuid4 } from 'uuid';

export class TaxService {
  constructor() {
  }

  async validateTaxRateDateRange(regionCode: string, startDate: ISO8601String, endDate: ISO8601String | null, excludeTaxRateId?: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for tax rate validation');
    }

    // Check for overlapping date ranges in the same region
    const query = knex('tax_rates')
      .where({
        region_code: regionCode,
        tenant
      })
      .andWhere(function() {
        this.where(function() {
          this.whereNull('end_date')
            .andWhere('start_date', '<', endDate || startDate);
        }).orWhere(function() {
          this.whereNotNull('end_date')
            .andWhere('start_date', '<', endDate || startDate)
            .andWhere('end_date', '>', startDate);
        });
      });

    // Only add the excludeTaxRateId condition if it's provided
    if (excludeTaxRateId) {
      query.andWhereNot('tax_rate_id', excludeTaxRateId);
    }

    const overlappingRates = await query;

    if (overlappingRates.length > 0) {
      throw new Error(`Tax rate date range overlaps with existing rate(s) in region ${regionCode}`);
    }
  }

  async calculateTax(companyId: string, netAmount: number, date: ISO8601String, regionCode?: string, is_taxable: boolean = true): Promise<ITaxCalculationResult> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for tax calculation');
    }

    console.log(`Calculating tax for company ${companyId} in tenant ${tenant}, net amount ${netAmount}, date ${date}, regionCode ${regionCode}`);

    // Check if company is tax exempt
    const company = await knex('companies')
      .where({
        company_id: companyId,
        tenant
      })
      .select('is_tax_exempt')
      .first();

    if (!company) {
      throw new Error(`Company ${companyId} not found in tenant ${tenant}`);
    }

    if (company.is_tax_exempt || !is_taxable) {
      console.log(`No tax applied: company ${companyId} is tax exempt or item is not taxable`);
      return { taxAmount: 0, taxRate: 0 };
    }

    // If regionCode is provided, use that to calculate tax directly, handling composite rates.
    if (regionCode) {
      console.log(`Calculating tax directly for regionCode: ${regionCode}, amount: ${netAmount}, date: ${date}`);
      
      // Explicitly type the result array
      const applicableRates: Pick<ITaxRate, 'tax_percentage'>[] = await knex('tax_rates')
        .where({
          region_code: regionCode,
          tenant,
          is_active: true
        })
        .andWhere('start_date', '<=', date)
        .andWhere(function() {
          this.whereNull('end_date')
            .orWhere('end_date', '>', date);
        })
        .select('tax_percentage'); // Select only the percentage

      if (!applicableRates || applicableRates.length === 0) {
        console.error(`No active tax rate(s) found for regionCode ${regionCode} on date ${date}`);
        // Optional: Log all rates for debugging
        // const allTaxRates = await knex('tax_rates').where({ tenant }).select('*');
        // console.log('All tax rates:', allTaxRates);
        throw new Error(`No active tax rate(s) found for region ${regionCode} on date ${date}`);
      }

      console.log('Applicable rates:', applicableRates);
      console.log(`Found ${applicableRates.length} applicable rate(s) for regionCode ${regionCode}`);

      // Sum percentages for composite tax
      // Handle potential string values from DB while satisfying TS type (number)
      const combinedTaxRate = applicableRates.reduce((sum, rate) => {
        const percentage = typeof rate.tax_percentage === 'string'
          ? parseFloat(rate.tax_percentage)
          : rate.tax_percentage;
        return sum + (isNaN(percentage) ? 0 : percentage); // Add parsed/original number, default to 0 if NaN
      }, 0);

      console.log(`Found ${applicableRates.length} applicable rate(s) for regionCode ${regionCode}. Combined rate: ${combinedTaxRate}%`);
      
      // Calculate tax based on the combined rate
      // Ensure tax is not applied if netAmount is zero or negative
      const taxAmount = netAmount > 0 ? Math.ceil((netAmount * combinedTaxRate) / 100) : 0;
      console.log(`Calculated tax amount: ${taxAmount} for net amount: ${netAmount} using combined rate ${combinedTaxRate}%`);
      
      return {
        taxAmount,
        taxRate: combinedTaxRate // Return the combined rate
      };
    }

    // Fallback: Get the company's default tax rate if no regionCode provided
    console.log(`No regionCode provided, fetching default tax rate for company ${companyId}`);

    // Check reverse charge applicability first (still on company_tax_settings)
    const taxSettings = await this.getCompanyTaxSettings(companyId); // Fetch settings for reverse charge check
    if (taxSettings.is_reverse_charge_applicable) {
      console.log(`Reverse charge is applicable for company ${companyId}. Returning zero tax.`);
      return { taxAmount: 0, taxRate: 0 };
    }

    // Find the default tax rate association
    const defaultRateAssoc = await knex('company_tax_rates')
      .where({
        company_id: companyId,
        tenant: tenant,
        is_default: true,
      })
      .whereNull('location_id')
      .select('tax_rate_id')
      .first();

    if (!defaultRateAssoc) {
      // Consider creating default settings if none exist, or throw error
      console.error(`No default tax rate configured for company ${companyId} in tenant ${tenant}`);
      // Option 1: Throw error
      // throw new Error(`No default tax rate configured for company ${companyId}`);
      // Option 2: Return zero tax (safer default?)
       return { taxAmount: 0, taxRate: 0 };
    }

    // Fetch the actual tax rate details using the ID found
    const taxRate = await knex<ITaxRate>('tax_rates')
      .where({
        tax_rate_id: defaultRateAssoc.tax_rate_id,
        tenant: tenant,
        is_active: true // Ensure the default rate is active
      })
      // Add date validity check similar to regionCode logic
      .andWhere('start_date', '<=', date)
      .andWhere(function() {
        this.whereNull('end_date')
          .orWhere('end_date', '>', date);
      })
      .first();

     console.log(`Default tax rate details retrieved for company ${companyId}:`, taxRate);

    if (!taxRate) {
      const error = `Default tax rate (ID: ${defaultRateAssoc.tax_rate_id}) found for company ${companyId} is inactive or invalid for date ${date} in tenant ${tenant}`;
      console.error(error);
      // Decide how to handle - throw error or return zero tax?
      // throw new Error(error);
       return { taxAmount: 0, taxRate: 0 };
    }

    let result: ITaxCalculationResult;
    if (taxRate.is_composite) {
      console.log(`Calculating composite tax for company ${companyId}`);
      result = await this.calculateCompositeTax(taxRate, netAmount, date);
    } else {
      console.log(`Calculating simple tax for company ${companyId}`);
      result = await this.calculateSimpleTax(taxRate, netAmount, date);
    }

    console.log(`Tax calculation result for company ${companyId}:`, result);
    return result;
  }
  
  private async calculateCompositeTax(taxRate: ITaxRate, netAmount: number, date: ISO8601String): Promise<ITaxCalculationResult> {
    const components = await CompanyTaxSettings.getCompositeTaxComponents(taxRate.tax_rate_id);
    let totalTaxAmount = 0;
    let taxableAmount = netAmount;
    const appliedComponents: ITaxComponent[] = [];

    for (const component of components) {
      if (!this.isComponentApplicable(component, date)) continue;

      const componentTax = await this.calculateComponentTax(component, taxableAmount, date);
      totalTaxAmount += componentTax;
      appliedComponents.push(component);

      if (component.is_compound) {
        taxableAmount += componentTax;
      }
    }

    const effectiveTaxRate = (totalTaxAmount / netAmount) * 100;

    return {
      taxAmount: totalTaxAmount,
      taxRate: effectiveTaxRate,
      taxComponents: appliedComponents
    };
  }

  private async calculateSimpleTax(taxRate: ITaxRate, netAmount: number, date: ISO8601String): Promise<ITaxCalculationResult> {
    const thresholds = await CompanyTaxSettings.getTaxRateThresholds(taxRate.tax_rate_id);
    
    if (thresholds.length > 0) {
      return this.calculateThresholdBasedTax(thresholds, netAmount);
    }

    // For negative or zero net amounts, no tax should be applied
    if (netAmount <= 0) {
      return { taxAmount: 0, taxRate: taxRate.tax_percentage };
    }

    const taxAmount = Math.ceil((netAmount * taxRate.tax_percentage) / 100);
    return { taxAmount, taxRate: taxRate.tax_percentage };
  }

  private calculateThresholdBasedTax(thresholds: ITaxRateThreshold[], netAmount: number): ITaxCalculationResult {
    console.log(`Calculating threshold-based tax for net amount: ${netAmount}`);
    console.log(`Number of thresholds: ${thresholds.length}`);

    let taxAmount = 0;
    let remainingAmount = netAmount;
    const appliedThresholds: ITaxRateThreshold[] = [];

    for (const threshold of thresholds) {
      console.log(`Processing threshold: ${JSON.stringify(threshold)}`);
      if (remainingAmount <= 0) {
        console.log('Remaining amount is 0 or less. Breaking out of threshold loop.');
        break;
      }

      const taxableAmount = threshold.max_amount
        ? Math.min(remainingAmount, threshold.max_amount - threshold.min_amount)
        : remainingAmount;

      console.log(`Taxable amount for this threshold: ${taxableAmount}`);

      const thresholdTax = Math.ceil((taxableAmount * threshold.rate) / 100);
      console.log(`Tax amount for this threshold: ${thresholdTax}`);

      taxAmount += thresholdTax;
      remainingAmount -= taxableAmount;
      appliedThresholds.push(threshold);

      console.log(`Cumulative tax amount: ${taxAmount}`);
      console.log(`Remaining amount: ${remainingAmount}`);
    }

    const effectiveTaxRate = (taxAmount / netAmount) * 100;
    console.log(`Effective tax rate: ${effectiveTaxRate}%`);

    const result = {
      taxAmount,
      taxRate: effectiveTaxRate,
      appliedThresholds
    };

    console.log(`Final tax calculation result: ${JSON.stringify(result)}`);
    return result;
  }

  private async calculateComponentTax(component: ITaxComponent, amount: number, date: ISO8601String): Promise<number> {
    const holiday = await this.getApplicableTaxHoliday(component.tax_component_id, date);
    if (holiday) {
      return 0; // No tax during holiday
    }

    return Math.ceil((amount * component.rate) / 100);
  }

  private isComponentApplicable(component: ITaxComponent, date: ISO8601String): boolean {
    const currentDate = new Date(date);
    if (component.start_date && new Date(component.start_date) > currentDate) return false;
    if (component.end_date && new Date(component.end_date) < currentDate) return false;
    return true;
  }

  private async getApplicableTaxHoliday(taxComponentId: string, date: ISO8601String): Promise<ITaxHoliday | undefined> {
    const holidays = await CompanyTaxSettings.getTaxHolidays(taxComponentId);
    const currentDate = new Date(date);

    return holidays.find(holiday => 
      new Date(holiday.start_date) <= currentDate && new Date(holiday.end_date) >= currentDate
    );
  }

  private async getCompanyTaxSettings(companyId: string): Promise<ICompanyTaxSettings> {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for tax settings lookup');
    }

    let taxSettings = await CompanyTaxSettings.get(companyId);

    if (!taxSettings) {
      taxSettings = await this.createDefaultTaxSettings(companyId);
    }

    return taxSettings;
  }

  async createDefaultTaxSettings(companyId: string): Promise<ICompanyTaxSettings> {
    const { knex, tenant } = await createTenantKnex();
    const trx = await knex.transaction();

    try {
      // Get the first active tax rate to use as the default
      const defaultTaxRate = await trx<ITaxRate>('tax_rates')
        .where('tenant', tenant!) // Use non-null assertion
        .andWhere('is_active', true)
        .orderBy('created_at', 'asc')
        .first(); // Use first() instead of limit(1) which returns array

      if (!defaultTaxRate) {
        throw new Error('No active tax rates found in the system to assign as default.');
      }

      // Create default company tax settings (without tax_rate_id)
      const [taxSettings] = await trx<ICompanyTaxSettings>('company_tax_settings')
        .insert({
          company_id: companyId,
          // tax_rate_id: defaultTaxRate.tax_rate_id, // Removed
          is_reverse_charge_applicable: false,
          tenant: tenant!
        })
        .returning('*');

      // Create the default association in company_tax_rates
      await trx('company_tax_rates')
        .insert({
          // company_tax_rate_id: uuid4(), // Assuming auto-generated or sequence
          company_id: companyId,
          tax_rate_id: defaultTaxRate.tax_rate_id,
          is_default: true,
          location_id: null,
          tenant: tenant!
        });

      // Create a default tax component (linked to the tax_rate, not settings)
      // This part remains largely the same, assuming components are tied to rates
      const tax_component_id = uuid4();
      await trx<ITaxComponent>('tax_components')
        .insert({
          tax_component_id,
          tax_rate_id: defaultTaxRate.tax_rate_id, // Link component to the chosen default rate
          name: 'Default Tax',
          rate: Math.ceil(defaultTaxRate.tax_percentage),
          sequence: 1,
          is_compound: false,
          tenant: tenant!
        });
        // Removed .returning('*') as it wasn't used

      await trx.commit();

      return taxSettings;
    } catch (error) {
      await trx.rollback();
      console.error('Error creating default tax settings:', error);
      throw new Error('Failed to create default tax settings');
    }
  }

  async isReverseChargeApplicable(companyId: string): Promise<boolean> {
    const taxSettings = await this.getCompanyTaxSettings(companyId);
    return taxSettings.is_reverse_charge_applicable;
  }

  async getTaxType(companyId: string): Promise<string> {   
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for tax type lookup');
    }

    // Find the default tax rate association for the company
    const defaultRateAssoc = await knex('company_tax_rates')
      .where({
        company_id: companyId,
        tenant: tenant,
        is_default: true,
      })
      .whereNull('location_id')
      .select('tax_rate_id')
      .first();

    if (!defaultRateAssoc) {
      // Handle case where no default rate is set - maybe return a default type or throw error
      console.warn(`No default tax rate configured for company ${companyId} in tenant ${tenant}. Cannot determine tax type.`);
      // Option 1: Throw error
      // throw new Error(`No default tax rate configured for company ${companyId}`);
      // Option 2: Return a default/unknown type
      return 'Unknown'; // Or potentially null/undefined depending on desired behavior
    }

    // Fetch the actual tax rate details using the ID found
    const taxRate = await knex<ITaxRate>('tax_rates')
      .where({
        tax_rate_id: defaultRateAssoc.tax_rate_id,
        tenant: tenant
        // Assuming we don't need activity/date check just to get the type
      })
      .select('tax_type')
      .first();


    if (!taxRate) {
      const error = `Tax rate details not found for default rate ID ${defaultRateAssoc.tax_rate_id} (Company: ${companyId}, Tenant: ${tenant})`;
      console.error(error);
      // Handle case where rate details are missing despite association existing
      // throw new Error(error);
      return 'Unknown'; // Or potentially null/undefined
    }

    return taxRate.tax_type;
  }
}
