import { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { ICompany } from '../../interfaces/company.interfaces';
import { BillingCycleType } from '@/interfaces';

const Company = {
  async getById(companyId: string): Promise<ICompany | null> {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting company by ID');
    }

    try {
      const company = await db<ICompany>('companies')
        .where({
          company_id: companyId,
          tenant
        })
        .first();
      return company || null;
    } catch (error) {
      console.error(`Error getting company ${companyId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get company: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async create(company: Omit<ICompany, 'company_id' | 'created_at' | 'updated_at'>): Promise<ICompany> {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for creating company');
    }

    try {
      const [createdCompany] = await db<ICompany>('companies')
        .insert({
          ...company,
          tenant,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .returning('*');

      return createdCompany;
    } catch (error) {
      console.error(`Error creating company in tenant ${tenant}:`, error);
      throw new Error(`Failed to create company: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async update(companyId: string, company: Partial<ICompany>): Promise<ICompany> {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating company');
    }

    try {
      const [updatedCompany] = await db<ICompany>('companies')
        .where({
          company_id: companyId,
          tenant
        })
        .update({
          ...company,
          updated_at: new Date().toISOString()
        })
        .returning('*');

      if (!updatedCompany) {
        throw new Error(`Company ${companyId} not found in tenant ${tenant}`);
      }

      return updatedCompany;
    } catch (error) {
      console.error(`Error updating company ${companyId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to update company: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async delete(companyId: string): Promise<void> {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deleting company');
    }

    try {
      const result = await db<ICompany>('companies')
        .where({
          company_id: companyId,
          tenant
        })
        .del();

      if (result === 0) {
        throw new Error(`Company ${companyId} not found in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error deleting company ${companyId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to delete company: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async getAll(): Promise<ICompany[]> {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for listing companies');
    }

    try {
      const companies = await db<ICompany>('companies')
        .where({ tenant })
        .select('*');
      return companies;
    } catch (error) {
      console.error(`Error getting all companies in tenant ${tenant}:`, error);
      throw new Error(`Failed to get companies: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async getByTaxRegion(taxRegion: string): Promise<ICompany[]> {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting companies by tax region');
    }

    try {
      const companies = await db<ICompany>('companies')
        .where({
          tax_region: taxRegion,
          tenant
        })
        .select('*');
      return companies;
    } catch (error) {
      console.error(`Error getting companies by tax region ${taxRegion} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get companies by tax region: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async updateTaxSettings(companyId: string, taxSettings: Partial<ICompany>): Promise<ICompany> {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating company tax settings');
    }

    try {
      const [updatedCompany] = await db<ICompany>('companies')
        .where({
          company_id: companyId,
          tenant
        })
        .update({
          tax_id_number: taxSettings.tax_id_number,
          tax_region: taxSettings.tax_region,
          is_tax_exempt: taxSettings.is_tax_exempt,
          tax_exemption_certificate: taxSettings.tax_exemption_certificate,
          updated_at: new Date().toISOString()
        })
        .returning('*');

      if (!updatedCompany) {
        throw new Error(`Company ${companyId} not found in tenant ${tenant}`);
      }

      return updatedCompany;
    } catch (error) {
      console.error(`Error updating tax settings for company ${companyId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to update company tax settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async getBillingCycle(companyId: string): Promise<string | null> {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting company billing cycle');
    }

    try {
      const company = await db<ICompany>('companies')
        .where({
          company_id: companyId,
          tenant
        })
        .select('billing_cycle')
        .first();

      return company ? company.billing_cycle || null : null;
    } catch (error) {
      console.error(`Error getting billing cycle for company ${companyId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get company billing cycle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async updateBillingCycle(companyId: string, billingCycle: string): Promise<void> {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating company billing cycle');
    }

    try {
      const result = await db<ICompany>('companies')
        .where({
          company_id: companyId,
          tenant
        })
        .update({
          billing_cycle: billingCycle as BillingCycleType,
          updated_at: new Date().toISOString()
        });

      if (result === 0) {
        throw new Error(`Company ${companyId} not found in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error updating billing cycle for company ${companyId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to update company billing cycle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};

export default Company;
