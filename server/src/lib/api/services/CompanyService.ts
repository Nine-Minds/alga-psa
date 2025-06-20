/**
 * Company Service
 * Business logic for company-related operations
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { ICompany, ICompanyLocation } from 'server/src/interfaces/company.interfaces';
import { withTransaction } from '@shared/db';
import { getCompanyLogoUrl } from 'server/src/lib/utils/avatarUtils';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { addCompanyEmailSetting } from 'server/src/lib/actions/company-settings/emailSettings';
import { 
  CreateCompanyData, 
  UpdateCompanyData, 
  CompanyFilterData,
  CreateCompanyLocationData,
  UpdateCompanyLocationData
} from '../schemas/company';
import { ListOptions } from '../controllers/BaseController';

export class CompanyService extends BaseService<ICompany> {
  constructor() {
    super({
      tableName: 'companies',
      primaryKey: 'company_id',
      tenantColumn: 'tenant',
      searchableFields: ['company_name', 'email', 'phone_no', 'address'],
      defaultSort: 'company_name',
      defaultOrder: 'asc'
    });
  }

  /**
   * List companies with enhanced filtering and search
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<ICompany>> {
    const { knex } = await this.getKnex();
    
    const {
      page = 1,
      limit = 25,
      filters = {} as CompanyFilterData,
      sort,
      order
    } = options;

    // Build base query with account manager join
    let dataQuery = knex('companies as c')
      .leftJoin('users as u', function() {
        this.on('c.account_manager_id', '=', 'u.user_id')
            .andOn('c.tenant', '=', 'u.tenant');
      })
      .where('c.tenant', context.tenant);

    let countQuery = knex('companies as c')
      .where('c.tenant', context.tenant);

    // Apply filters
    dataQuery = this.applyCompanyFilters(dataQuery, filters);
    countQuery = this.applyCompanyFilters(countQuery, filters);

    // Apply sorting
    const sortField = sort || this.defaultSort;
    const sortOrder = order || this.defaultOrder;
    dataQuery = dataQuery.orderBy(`c.${sortField}`, sortOrder);

    // Apply pagination
    const offset = (page - 1) * limit;
    dataQuery = dataQuery.limit(limit).offset(offset);

    // Select fields
    dataQuery = dataQuery.select(
      'c.*',
      knex.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
    );

    // Execute queries
    const [companies, [{ count }]] = await Promise.all([
      dataQuery,
      countQuery.count('* as count')
    ]);

    // Add logo URLs
    const companiesWithLogos = await Promise.all(
      companies.map(async (company: ICompany) => {
        const logoUrl = await getCompanyLogoUrl(company.company_id, context.tenant);
        return { ...company, logoUrl };
      })
    );

    return {
      data: companiesWithLogos,
      total: parseInt(count as string)
    };
  }

  /**
   * Get company by ID with account manager and logo
   */
  async getById(id: string, context: ServiceContext): Promise<ICompany | null> {
    const { knex } = await this.getKnex();

    const company = await knex('companies as c')
      .leftJoin('users as u', function() {
        this.on('c.account_manager_id', '=', 'u.user_id')
            .andOn('c.tenant', '=', 'u.tenant');
      })
      .select(
        'c.*',
        knex.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
      )
      .where({ 'c.company_id': id, 'c.tenant': context.tenant })
      .first();

    if (!company) {
      return null;
    }

    // Get logo URL
    const logoUrl = await getCompanyLogoUrl(id, context.tenant);

    return {
      ...company,
      logoUrl
    } as ICompany;
  }

  /**
   * Create new company with default settings
   */
  async create(data: CreateCompanyData, context: ServiceContext): Promise<ICompany> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Prepare company data
      const companyData = {
        company_id: knex.raw('gen_random_uuid()'),
        company_name: data.company_name,
        phone_no: data.phone_no || '',
        email: data.email || '',
        url: data.url || '',
        address: data.address,
        client_type: data.client_type,
        tax_id_number: data.tax_id_number,
        notes: data.notes,
        properties: data.properties,
        payment_terms: data.payment_terms,
        billing_cycle: data.billing_cycle,
        credit_balance: 0,
        credit_limit: data.credit_limit,
        preferred_payment_method: data.preferred_payment_method,
        auto_invoice: data.auto_invoice || false,
        invoice_delivery_method: data.invoice_delivery_method,
        region_code: data.region_code,
        is_tax_exempt: data.is_tax_exempt || false,
        tax_exemption_certificate: data.tax_exemption_certificate,
        timezone: data.timezone,
        invoice_template_id: data.invoice_template_id,
        billing_contact_id: data.billing_contact_id,
        billing_email: data.billing_email,
        account_manager_id: data.account_manager_id,
        is_inactive: data.is_inactive || false,
        tenant: context.tenant,
        created_at: knex.raw('now()'),
        updated_at: knex.raw('now()')
      };

      // Insert company
      const [company] = await trx('companies').insert(companyData).returning('*');

      // Create default tax settings for the company
      await createDefaultTaxSettings(company.company_id, context.tenant, trx);

      // Add default email settings
      await addCompanyEmailSetting(company.company_id, trx);

      // Handle tags if provided
      if (data.tags && data.tags.length > 0) {
        await this.handleTags(company.company_id, data.tags, context, trx);
      }

      return company as ICompany;
    });
  }

  /**
   * Update company
   */
  async update(id: string, data: UpdateCompanyData, context: ServiceContext): Promise<ICompany> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Prepare update data
      const updateData = {
        ...data,
        updated_at: knex.raw('now()')
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if (updateData[key as keyof UpdateCompanyData] === undefined) {
          delete updateData[key as keyof UpdateCompanyData];
        }
      });

      // Update company
      const [company] = await trx('companies')
        .where({ company_id: id, tenant: context.tenant })
        .update(updateData)
        .returning('*');

      if (!company) {
        throw new Error('Company not found or permission denied');
      }

      // Handle tags if provided
      if (data.tags) {
        await this.handleTags(id, data.tags, context, trx);
      }

      return company as ICompany;
    });
  }

  /**
   * Get company locations
   */
  async getCompanyLocations(companyId: string, context: ServiceContext): Promise<ICompanyLocation[]> {
    const { knex } = await this.getKnex();

    const locations = await knex('company_locations')
      .where({
        company_id: companyId,
        tenant: context.tenant
      })
      .orderBy('is_default', 'desc')
      .orderBy('location_name', 'asc');

    return locations;
  }

  /**
   * Create company location
   */
  async createLocation(
    companyId: string, 
    data: CreateCompanyLocationData, 
    context: ServiceContext
  ): Promise<ICompanyLocation> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Verify company exists
      const company = await trx('companies')
        .where({ company_id: companyId, tenant: context.tenant })
        .first();

      if (!company) {
        throw new Error('Company not found');
      }

      const locationData = {
        location_id: knex.raw('gen_random_uuid()'),
        company_id: companyId,
        ...data,
        tenant: context.tenant,
        created_at: knex.raw('now()'),
        updated_at: knex.raw('now()')
      };

      const [location] = await trx('company_locations')
        .insert(locationData)
        .returning('*');

      return location as ICompanyLocation;
    });
  }

  /**
   * Update company location
   */
  async updateLocation(
    companyId: string,
    locationId: string,
    data: UpdateCompanyLocationData,
    context: ServiceContext
  ): Promise<ICompanyLocation> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const updateData = {
        ...data,
        updated_at: knex.raw('now()')
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if (updateData[key as keyof UpdateCompanyLocationData] === undefined) {
          delete updateData[key as keyof UpdateCompanyLocationData];
        }
      });

      const [location] = await trx('company_locations')
        .where({
          location_id: locationId,
          company_id: companyId,
          tenant: context.tenant
        })
        .update(updateData)
        .returning('*');

      if (!location) {
        throw new Error('Location not found or permission denied');
      }

      return location as ICompanyLocation;
    });
  }

  /**
   * Delete company location
   */
  async deleteLocation(
    companyId: string,
    locationId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const result = await trx('company_locations')
        .where({
          location_id: locationId,
          company_id: companyId,
          tenant: context.tenant
        })
        .delete();

      if (result === 0) {
        throw new Error('Location not found or permission denied');
      }
    });
  }

  /**
   * Get company statistics
   */
  async getCompanyStats(context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const [
      totalStats,
      billingCycleStats,
      clientTypeStats,
      creditStats
    ] = await Promise.all([
      // Total and active/inactive counts
      knex('companies')
        .where('tenant', context.tenant)
        .select(
          knex.raw('COUNT(*) as total_companies'),
          knex.raw('COUNT(CASE WHEN is_inactive = false THEN 1 END) as active_companies'),
          knex.raw('COUNT(CASE WHEN is_inactive = true THEN 1 END) as inactive_companies')
        )
        .first(),

      // Companies by billing cycle
      knex('companies')
        .where('tenant', context.tenant)
        .groupBy('billing_cycle')
        .select('billing_cycle', knex.raw('COUNT(*) as count')),

      // Companies by client type
      knex('companies')
        .where('tenant', context.tenant)
        .whereNotNull('client_type')
        .groupBy('client_type')
        .select('client_type', knex.raw('COUNT(*) as count')),

      // Credit balance statistics
      knex('companies')
        .where('tenant', context.tenant)
        .select(
          knex.raw('SUM(credit_balance) as total_credit_balance'),
          knex.raw('AVG(credit_balance) as average_credit_balance')
        )
        .first()
    ]);

    return {
      ...totalStats,
      companies_by_billing_cycle: billingCycleStats.reduce((acc: any, row: any) => {
        acc[row.billing_cycle] = parseInt(row.count);
        return acc;
      }, {}),
      companies_by_client_type: clientTypeStats.reduce((acc: any, row: any) => {
        acc[row.client_type] = parseInt(row.count);
        return acc;
      }, {}),
      total_credit_balance: parseFloat(creditStats.total_credit_balance || '0'),
      average_credit_balance: parseFloat(creditStats.average_credit_balance || '0')
    };
  }

  /**
   * Apply company-specific filters
   */
  private applyCompanyFilters(query: Knex.QueryBuilder, filters: CompanyFilterData): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'company_name':
          query.whereILike('c.company_name', `%${value}%`);
          break;
        case 'email':
          query.whereILike('c.email', `%${value}%`);
          break;
        case 'client_type':
          query.where('c.client_type', value);
          break;
        case 'billing_cycle':
          query.where('c.billing_cycle', value);
          break;
        case 'is_inactive':
          query.where('c.is_inactive', value);
          break;
        case 'is_tax_exempt':
          query.where('c.is_tax_exempt', value);
          break;
        case 'account_manager_id':
          query.where('c.account_manager_id', value);
          break;
        case 'region_code':
          query.where('c.region_code', value);
          break;
        case 'credit_balance_min':
          query.where('c.credit_balance', '>=', value);
          break;
        case 'credit_balance_max':
          query.where('c.credit_balance', '<=', value);
          break;
        case 'has_credit_limit':
          if (value) {
            query.whereNotNull('c.credit_limit');
          } else {
            query.whereNull('c.credit_limit');
          }
          break;
        case 'industry':
          query.whereRaw("c.properties->>'industry' = ?", [value]);
          break;
        case 'company_size':
          query.whereRaw("c.properties->>'company_size' = ?", [value]);
          break;
        case 'search':
          if (this.searchableFields.length > 0) {
            query.where(subQuery => {
              this.searchableFields.forEach((field, index) => {
                if (index === 0) {
                  subQuery.whereILike(`c.${field}`, `%${value}%`);
                } else {
                  subQuery.orWhereILike(`c.${field}`, `%${value}%`);
                }
              });
            });
          }
          break;
        case 'created_from':
          query.where('c.created_at', '>=', value);
          break;
        case 'created_to':
          query.where('c.created_at', '<=', value);
          break;
        case 'updated_from':
          query.where('c.updated_at', '>=', value);
          break;
        case 'updated_to':
          query.where('c.updated_at', '<=', value);
          break;
      }
    });

    return query;
  }

  /**
   * Handle tag associations
   */
  private async handleTags(
    companyId: string,
    tags: string[],
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Remove existing tags
    await trx('company_tags')
      .where({ company_id: companyId, tenant: context.tenant })
      .delete();

    // Add new tags
    if (tags.length > 0) {
      const tagInserts = tags.map(tag => ({
        company_id: companyId,
        tag_name: tag,
        tenant: context.tenant,
        created_at: trx.raw('now()')
      }));

      await trx('company_tags').insert(tagInserts);
    }
  }
}