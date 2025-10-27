import { ApiBaseController } from './ApiBaseController';
import { ServiceCatalogService } from '@product/api/services/ServiceCatalogService';
import {
  createServiceSchema,
  updateServiceSchema,
  serviceListQuerySchema
} from '@product/api/schemas/serviceSchemas';

export class ApiServiceController extends ApiBaseController {
  constructor() {
    const serviceCatalogService = new ServiceCatalogService();

    super(serviceCatalogService, {
      resource: 'service',
      createSchema: createServiceSchema,
      updateSchema: updateServiceSchema,
      querySchema: serviceListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
  }
}
