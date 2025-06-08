import { Knex } from 'knex';
import { getCurrentTenantId } from 'server/src/lib/db';
import { ICompany } from '../../interfaces/company.interfaces';
import { BillingCycleType } from 'server/src/interfaces';

const Company = {
  async getById(knexOrTrx: Knex | Knex.Transaction, companyId: string): Promise<ICompany | null> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting company by ID');
    }

    try {
      const company = await knexOrTrx<ICompany>('companies')
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

  async create(knexOrTrx: Knex | Knex.Transaction, company: Omit<ICompany, 'company_id' | 'created_at' | 'updated_at'>): Promise<ICompany> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for creating company');
    }

    try {
      const [createdCompany] = await knexOrTrx<ICompany>('companies')
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

  async update(knexOrTrx: Knex | Knex.Transaction, companyId: string, company: Partial<ICompany>): Promise<ICompany> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating company');
    }

    try {
      const [updatedCompany] = await knexOrTrx<ICompany>('companies')
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

  async delete(knexOrTrx: Knex | Knex.Transaction, companyId: string): Promise<void> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deleting company');
    }

    try {
      const result = await knexOrTrx<ICompany>('companies')
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

  async getAll(knexOrTrx: Knex | Knex.Transaction): Promise<ICompany[]> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for listing companies');
    }

    try {
      const companies = await knexOrTrx<ICompany>('companies')
        .where({ tenant })
        .select('*');
      return companies;
    } catch (error) {
      console.error(`Error getting all companies in tenant ${tenant}:`, error);
      throw new Error(`Failed to get companies: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async getByRegionCode(knexOrTrx: Knex | Knex.Transaction, regionCode: string): Promise<ICompany[]> { // Renamed function and parameter
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting companies by region code');
    }

    try {
      const companies = await knexOrTrx<ICompany>('companies')
        .where({
          region_code: regionCode, // Changed column name
          tenant
        })
        .select('*');
      return companies;
    } catch (error) {
      console.error(`Error getting companies by region code ${regionCode} in tenant ${tenant}:`, error);
      throw new Error(`Failed to get companies by region code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  async updateTaxSettings(knexOrTrx: Knex | Knex.Transaction, companyId: string, taxSettings: Partial<ICompany>): Promise<ICompany> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating company tax settings');
    }

    try {
      const [updatedCompany] = await knexOrTrx<ICompany>('companies')
        .where({
          company_id: companyId,
          tenant
        })
        .update({
          tax_id_number: taxSettings.tax_id_number,
          region_code: taxSettings.region_code, // Changed column name
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

  async getBillingCycle(knexOrTrx: Knex | Knex.Transaction, companyId: string): Promise<string | null> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for getting company billing cycle');
    }

    try {
      const company = await knexOrTrx<ICompany>('companies')
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

  async updateBillingCycle(knexOrTrx: Knex | Knex.Transaction, companyId: string, billingCycle: string): Promise<void> {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for updating company billing cycle');
    }

    try {
      const result = await knexOrTrx<ICompany>('companies')
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
