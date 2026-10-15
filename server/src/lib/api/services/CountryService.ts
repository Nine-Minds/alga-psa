import { BaseService, tenantDb, type ServiceContext } from '@alga-psa/db';

export interface CountryRecord {
  code: string;
  name: string;
  phone_code?: string | null;
}

/**
 * ISO country reference data. One global table shared by every tenant; the
 * same query the web quick-add uses (countryActions.getAllCountries), so the
 * REST and mobile pickers offer exactly the rows the web form does.
 */
export class CountryService extends BaseService<never> {
  constructor() {
    super({ tableName: 'countries', primaryKey: 'code', tenantColumn: 'tenant' });
  }

  async listActive(context: ServiceContext): Promise<CountryRecord[]> {
    const knex = await this.getDbForContext(context);
    return tenantDb(knex, context.tenant)
      .table<CountryRecord>('countries')
      .select('code', 'name', 'phone_code')
      .where('is_active', true)
      .orderBy('name');
  }
}
