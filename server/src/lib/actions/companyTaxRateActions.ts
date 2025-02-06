'use server'

import { createTenantKnex } from '@/lib/db';
import { ICompanyTaxRate } from '@/interfaces/billing.interfaces';

export async function getCompanyTaxRates(companyId: string): Promise<ICompanyTaxRate[]> {
  const { knex, tenant } = await createTenantKnex();
  return await knex('company_tax_rates')
    .join('tax_rates', function() {
      this.on('company_tax_rates.tax_rate_id', '=', 'tax_rates.tax_rate_id')
          .andOn('company_tax_rates.tenant', '=', 'tax_rates.tenant');
    })
    .where({ 
      'company_tax_rates.company_id': companyId,
      'company_tax_rates.tenant': tenant 
    })
    .select('company_tax_rates.*', 'tax_rates.region', 'tax_rates.tax_percentage', 'tax_rates.description');
}

export async function addCompanyTaxRate(companyTaxRate: Omit<ICompanyTaxRate, 'tenant'>): Promise<ICompanyTaxRate> {
  const { knex, tenant } = await createTenantKnex();
  const [newCompanyTaxRate] = await knex('company_tax_rates').insert({ ...companyTaxRate, tenant: tenant! }).returning('*');
  return newCompanyTaxRate;
}

export async function removeCompanyTaxRate(companyId: string, taxRateId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  await knex('company_tax_rates')
    .where({ 
      company_id: companyId,
      tax_rate_id: taxRateId,
      tenant
    })
    .del();
}
