import {
  BaseService,
  type ServiceContext,
} from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getTenantProduct } from '@/lib/productAccess';

export interface MobileFeatureCapabilities {
  features: {
    inventory: boolean;
    opportunities: boolean;
    opportunitiesCreate: boolean;
  };
}

export class MobileCapabilitiesService extends BaseService<never> {
  constructor() {
    super({
      tableName: 'users',
      primaryKey: 'user_id',
      tenantColumn: 'tenant',
    });
  }

  async getMyCapabilities(context: ServiceContext): Promise<MobileFeatureCapabilities> {
    const productCode = await getTenantProduct(context.tenant);
    if (productCode !== 'psa') {
      return {
        features: {
          inventory: false,
          opportunities: false,
          opportunitiesCreate: false,
        },
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
    };
  }
}
