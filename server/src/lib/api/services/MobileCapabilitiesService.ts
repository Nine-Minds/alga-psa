import {
  BaseService,
  type ServiceContext,
} from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { resolveDateFormatCountry } from '@alga-psa/clients/lib/tenantDefaultCountry';
import {
  countryDateFormat,
  SYSTEM_DATE_FORMAT,
  type CountryDateFormat,
} from '@alga-psa/core/i18n/countryDateFormat';
import { getTenantProduct } from '@/lib/productAccess';

export interface MobileFeatureCapabilities {
  features: {
    inventory: boolean;
    opportunities: boolean;
    opportunitiesCreate: boolean;
  };
  /**
   * How this user's dates are written, resolved from their country exactly as
   * the web layouts resolve it. The device locale must not decide this: a
   * technician with a UK phone working for a US MSP reads the MSP's dates.
   */
  formatting: CountryDateFormat;
}

export class MobileCapabilitiesService extends BaseService<never> {
  constructor() {
    super({
      tableName: 'users',
      primaryKey: 'user_id',
      tenantColumn: 'tenant',
    });
  }

  private async getFormatting(context: ServiceContext): Promise<CountryDateFormat> {
    try {
      const knex = await this.getDbForContext(context);
      const country = await resolveDateFormatCountry(knex, context.tenant, context.user);
      return countryDateFormat(country?.code ?? null);
    } catch {
      return SYSTEM_DATE_FORMAT;
    }
  }

  async getMyCapabilities(context: ServiceContext): Promise<MobileFeatureCapabilities> {
    const formatting = await this.getFormatting(context);
    const productCode = await getTenantProduct(context.tenant);
    if (productCode !== 'psa') {
      return {
        features: {
          inventory: false,
          opportunities: false,
          opportunitiesCreate: false,
        },
        formatting,
      };
    }

    const knex = await this.getDbForContext(context);
    const [inventory, opportunities, opportunitiesCreate] = await Promise.all([
      hasPermission(context.user, 'inventory', 'read', knex),
      hasPermission(context.user, 'opportunities', 'read', knex),
      hasPermission(context.user, 'opportunities', 'create', knex),
    ]);

    return {
      features: {
        inventory,
        opportunities,
        opportunitiesCreate,
      },
      formatting,
    };
  }
}
