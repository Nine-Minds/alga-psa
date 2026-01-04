import { ApiBaseController } from './ApiBaseController';
import { ProductCatalogService } from '../services/ProductCatalogService';
import {
  createProductSchema,
  updateProductSchema,
  productListQuerySchema
} from '../schemas/productSchemas';

export class ApiProductController extends ApiBaseController {
  constructor() {
    const productCatalogService = new ProductCatalogService();

    super(productCatalogService, {
      // Use the existing 'service' RBAC resource (products are a catalog subset).
      resource: 'service',
      createSchema: createProductSchema,
      updateSchema: updateProductSchema,
      querySchema: productListQuerySchema,
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

