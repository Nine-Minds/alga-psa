import { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { ICompany } from '../../interfaces/company.interfaces';
import { BillingCycleType } from '@/interfaces';

const Company = {
  async getById(companyId: string): Promise<ICompany | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const company = await db<ICompany>('companies')
      .where({ company_id: companyId })
      .andWhere('tenant', tenant)
      .first();
    return company || null;
  },

  async create(company: Omit<ICompany, 'company_id' | 'created_at' | 'updated_at'>): Promise<ICompany> {
    const {knex: db} = await createTenantKnex();
    const [createdCompany] = await db<ICompany>('companies')
      .insert({
        ...company,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');

    return createdCompany;
  },

  async update(companyId: string, company: Partial<ICompany>): Promise<ICompany> {
    const {knex: db} = await createTenantKnex();
    const [updatedCompany] = await db<ICompany>('companies')
      .where({ company_id: companyId })
      .update({
        ...company,
        updated_at: new Date().toISOString()
      })
      .returning('*');

    return updatedCompany;
  },

  async delete(companyId: string): Promise<void> {
    const {knex: db} = await createTenantKnex();
    await db<ICompany>('companies')
      .where({ company_id: companyId })
      .del();
  },

  async getAll(): Promise<ICompany[]> {
    const {knex: db} = await createTenantKnex();
    const companies = await db<ICompany>('companies')
      .select('*');
    return companies;
  },

  async getByTaxRegion(taxRegion: string): Promise<ICompany[]> {
    const {knex: db} = await createTenantKnex();
    const companies = await db<ICompany>('companies')
      .where({ tax_region: taxRegion })
      .select('*');
    return companies;
  },

  async updateTaxSettings(companyId: string, taxSettings: Partial<ICompany>): Promise<ICompany> {
    const {knex: db} = await createTenantKnex();
    const [updatedCompany] = await db<ICompany>('companies')
      .where({ company_id: companyId })
      .update({
        tax_id_number: taxSettings.tax_id_number,
        tax_region: taxSettings.tax_region,
        is_tax_exempt: taxSettings.is_tax_exempt,
        tax_exemption_certificate: taxSettings.tax_exemption_certificate,
        updated_at: new Date().toISOString()
      })
      .returning('*');

    return updatedCompany;
  },

  async getBillingCycle(companyId: string): Promise<string | null> {
    const {knex: db} = await createTenantKnex();
    const company = await db<ICompany>('companies')
      .where({ company_id: companyId })
      .select('billing_cycle')
      .first();

    return company ? company.billing_cycle || null : null;
  },

  async updateBillingCycle(companyId: string, billingCycle: string): Promise<void> {
    const {knex: db} = await createTenantKnex();
    await db<ICompany>('companies')
      .where({ company_id: companyId })
      .update({
        billing_cycle: billingCycle as BillingCycleType,
        updated_at: new Date().toISOString()
      });
  }
};

export default Company;
