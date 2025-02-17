
import { ICompanyTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday, ITaxCalculationResult } from '../../interfaces/tax.interfaces';
import CompanyTaxSettings from '../models/companyTaxSettings';
import { ISO8601String } from '../../types/types.d';
import { createTenantKnex } from '../db';

export class TaxService {
  constructor() {
  }

  async calculateTax(companyId: string, netAmount: number, date: ISO8601String): Promise<ITaxCalculationResult> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for tax calculation');
    }

    console.log(`Calculating tax for company ${companyId} in tenant ${tenant}, net amount ${netAmount}, date ${date}`);

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

    if (company.is_tax_exempt) {
      console.log(`Company ${companyId} in tenant ${tenant} is tax exempt. Returning zero tax.`);
      return { taxAmount: 0, taxRate: 0 };
    }

    const taxSettings = await this.getCompanyTaxSettings(companyId);
    console.log(`Tax settings retrieved for company ${companyId}:`, taxSettings);

    if (taxSettings.is_reverse_charge_applicable) {
      console.log(`Reverse charge is applicable for company ${companyId}. Returning zero tax.`);
      return { taxAmount: 0, taxRate: 0 };
    }

    const taxRate = await CompanyTaxSettings.getTaxRate(taxSettings.tax_rate_id);
    console.log(`Tax rate retrieved for tax_rate_id ${taxSettings.tax_rate_id} in tenant ${tenant}:`, taxRate);

    if (!taxRate) {
      const error = `Tax rate not found for tax_rate_id ${taxSettings.tax_rate_id} in tenant ${tenant}`;
      console.error(error);
      throw new Error(error);
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

    const taxSettings = await CompanyTaxSettings.get(companyId);

    if (!taxSettings) {
      const error = `Tax settings not found for company ${companyId} in tenant ${tenant}`;
      console.error(error);
      throw new Error(error);
    }

    return taxSettings;
  }

  async isReverseChargeApplicable(companyId: string): Promise<boolean> {
    const taxSettings = await this.getCompanyTaxSettings(companyId);
    return taxSettings.is_reverse_charge_applicable;
  }

  async getTaxType(companyId: string): Promise<string> {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for tax type lookup');
    }

    const taxSettings = await this.getCompanyTaxSettings(companyId);
    const taxRate = await CompanyTaxSettings.getTaxRate(taxSettings.tax_rate_id);

    if (!taxRate) {
      const error = `Tax rate not found for company ${companyId} in tenant ${tenant}`;
      console.error(error);
      throw new Error(error);
    }

    return taxRate.tax_type;
  }
}
