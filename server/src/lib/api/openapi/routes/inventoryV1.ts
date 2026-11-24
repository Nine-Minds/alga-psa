import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import type { ZodTypeAny } from 'zod';
import {
  inventoryVendorCreateSchema,
  inventoryVendorProductUpsertSchema,
  inventoryVendorUpdateSchema,
} from '../../schemas/inventorySchemas';

export function registerInventoryV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Inventory v1';
  const UnitParams = registry.registerSchema(
    'InventoryUnitParamsV1',
    zOpenApi.object({ unitId: zOpenApi.string().guid() }),
  );
  const CountParams = registry.registerSchema(
    'InventoryCountParamsV1',
    zOpenApi.object({ sessionId: zOpenApi.string().guid() }),
  );
  const PurchaseOrderParams = registry.registerSchema(
    'InventoryPurchaseOrderParamsV1',
    zOpenApi.object({ poId: zOpenApi.string().guid() }),
  );
  const PurchaseOrderLineParams = registry.registerSchema(
    'InventoryPurchaseOrderLineParamsV1',
    zOpenApi.object({
      poId: zOpenApi.string().guid(),
      lineId: zOpenApi.string().guid(),
    }),
  );
  const TransferParams = registry.registerSchema(
    'InventoryTransferParamsV1',
    zOpenApi.object({ transferId: zOpenApi.string().guid() }),
  );
  const VendorParams = registry.registerSchema(
    'InventoryVendorParamsV1',
    zOpenApi.object({ vendorId: zOpenApi.string().guid() }),
  );
  const VendorProductParams = registry.registerSchema(
    'InventoryVendorProductParamsV1',
    zOpenApi.object({
      vendorId: zOpenApi.string().guid(),
      serviceId: zOpenApi.string().guid(),
    }),
  );
  const VendorListQuery = registry.registerSchema(
    'InventoryVendorListQueryV1',
    zOpenApi.object({
      page: zOpenApi.coerce.number().int().min(1).optional(),
      limit: zOpenApi.coerce.number().int().min(1).max(100).optional(),
      search: zOpenApi.string().optional(),
      include_inactive: zOpenApi.enum(['true', 'false']).optional(),
    }),
  );
  const VendorCreateBody = registry.registerSchema('InventoryVendorCreateBodyV1', inventoryVendorCreateSchema);
  const VendorUpdateBody = registry.registerSchema('InventoryVendorUpdateBodyV1', inventoryVendorUpdateSchema);
  const VendorProductUpsertBody = registry.registerSchema(
    'InventoryVendorProductUpsertBodyV1',
    inventoryVendorProductUpsertSchema,
  );
  const LookupQuery = registry.registerSchema(
    'InventoryLookupQueryV1',
    zOpenApi.object({ code: zOpenApi.string().min(1) }),
  );
  const ListQuery = registry.registerSchema(
    'InventoryListQueryV1',
    zOpenApi.object({
      page: zOpenApi.coerce.number().int().min(1).optional(),
      limit: zOpenApi.coerce.number().int().min(1).max(100).optional(),
      search: zOpenApi.string().optional(),
      status: zOpenApi.string().optional(),
      location_id: zOpenApi.string().guid().optional(),
      service_id: zOpenApi.string().guid().optional(),
      client_id: zOpenApi.string().guid().optional(),
      low_stock: zOpenApi.enum(['true', 'false']).optional(),
    }),
  );
  // TODO: Replace the loose inventory bodies and responses with the inventory route schemas.
  const LooseBody = registry.registerSchema(
    'InventoryLooseBodyV1',
    zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()),
  );
  const LooseSuccess = registry.registerSchema(
    'InventoryLooseSuccessV1',
    zOpenApi.object({ data: zOpenApi.unknown() }),
  );
  const ApiError = registry.registerSchema(
    'InventoryApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  type Def = {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    summary: string;
    resource: 'inventory' | 'cycle_count' | 'purchase_order' | 'stock_transfer' | 'vendor';
    action: 'read' | 'create' | 'update';
    params?: ZodTypeAny;
    query?: ZodTypeAny;
    /** A request body schema; `true` is the loose body for routes not yet typed. */
    body?: true | ZodTypeAny;
    successStatus?: 200 | 201;
    /** Optional prose for operations whose behavior is not obvious from the summary. */
    description?: string;
  };

  const defs: Def[] = [
    { method: 'get', path: '/api/v1/inventory/lookup', summary: 'Look up an inventory barcode or identifier', resource: 'inventory', action: 'read', query: LookupQuery },
    { method: 'get', path: '/api/v1/inventory/stock', summary: 'List stock levels', resource: 'inventory', action: 'read', query: ListQuery },
    { method: 'get', path: '/api/v1/inventory/stock-locations', summary: 'List stock locations', resource: 'inventory', action: 'read' },
    { method: 'get', path: '/api/v1/inventory/units', summary: 'List serialized stock units', resource: 'inventory', action: 'read', query: ListQuery },
    { method: 'get', path: '/api/v1/inventory/units/{unitId}', summary: 'Get a serialized stock unit', resource: 'inventory', action: 'read', params: UnitParams },
    { method: 'post', path: '/api/v1/inventory/receipts', summary: 'Receive stock manually', resource: 'inventory', action: 'update', body: true, successStatus: 201 },
    { method: 'post', path: '/api/v1/inventory/adjustments', summary: 'Adjust stock', resource: 'inventory', action: 'update', body: true },
    { method: 'get', path: '/api/v1/inventory/counts', summary: 'List cycle count sessions', resource: 'cycle_count', action: 'read', query: ListQuery },
    { method: 'post', path: '/api/v1/inventory/counts', summary: 'Start a cycle count session', resource: 'cycle_count', action: 'create', body: true, successStatus: 201 },
    { method: 'get', path: '/api/v1/inventory/counts/{sessionId}', summary: 'Get a cycle count session', resource: 'cycle_count', action: 'read', params: CountParams },
    { method: 'post', path: '/api/v1/inventory/counts/{sessionId}/records', summary: 'Record a cycle count quantity', resource: 'cycle_count', action: 'update', params: CountParams, body: true },
    { method: 'post', path: '/api/v1/inventory/counts/{sessionId}/submit', summary: 'Submit a cycle count session', resource: 'cycle_count', action: 'update', params: CountParams },
    { method: 'post', path: '/api/v1/inventory/counts/{sessionId}/cancel', summary: 'Cancel a cycle count session', resource: 'cycle_count', action: 'update', params: CountParams, description: 'Cancels an in-progress cycle count and returns the cancelled session. Quantities already recorded against the session stay on it but are never applied to stock levels, since only approval posts them. Cancelling an already-cancelled session returns it unchanged; an approved session cannot be cancelled.' },
    { method: 'get', path: '/api/v1/inventory/purchase-orders', summary: 'List purchase orders', resource: 'purchase_order', action: 'read', query: ListQuery },
    { method: 'get', path: '/api/v1/inventory/purchase-orders/{poId}', summary: 'Get a purchase order', resource: 'purchase_order', action: 'read', params: PurchaseOrderParams },
    { method: 'post', path: '/api/v1/inventory/purchase-orders/{poId}/lines/{lineId}/receive', summary: 'Receive a purchase-order line', resource: 'purchase_order', action: 'update', params: PurchaseOrderLineParams, body: true },
    { method: 'get', path: '/api/v1/inventory/vendors', summary: 'List vendors', resource: 'vendor', action: 'read', query: VendorListQuery, description: 'Paginated; `search` matches the vendor name; inactive vendors are excluded unless include_inactive=true.' },
    { method: 'post', path: '/api/v1/inventory/vendors', summary: 'Create a vendor', resource: 'vendor', action: 'create', body: VendorCreateBody, successStatus: 201, description: 'Vendor names are unique per tenant after trimming and case-folding; a clash returns 409 naming the existing vendor.' },
    { method: 'get', path: '/api/v1/inventory/vendors/{vendorId}', summary: 'Get a vendor', resource: 'vendor', action: 'read', params: VendorParams },
    { method: 'put', path: '/api/v1/inventory/vendors/{vendorId}', summary: 'Update a vendor', resource: 'vendor', action: 'update', params: VendorParams, body: VendorUpdateBody, description: 'Send is_active=true to reactivate a vendor.' },
    { method: 'post', path: '/api/v1/inventory/vendors/{vendorId}/deactivate', summary: 'Deactivate a vendor', resource: 'vendor', action: 'update', params: VendorParams, description: 'Idempotent: an already-inactive vendor is returned unchanged. An active vendor with open purchase orders (draft, open, partially received) returns 409.' },
    { method: 'get', path: '/api/v1/inventory/vendors/{vendorId}/products', summary: 'List a vendor price list', resource: 'vendor', action: 'read', params: VendorParams, description: 'Price list entries with product name and SKU. unit_cost is in integer minor units of cost_currency.' },
    { method: 'put', path: '/api/v1/inventory/vendors/{vendorId}/products/{serviceId}', summary: 'Create or update a vendor price list entry', resource: 'vendor', action: 'update', params: VendorProductParams, body: VendorProductUpsertBody, description: 'Upsert keyed on vendor and product. unit_cost is in integer minor units. An omitted cost_currency resolves as in the MSP UI. Marking an entry preferred clears the preferred flag on the product\'s other vendors.' },
    { method: 'delete', path: '/api/v1/inventory/vendors/{vendorId}/products/{serviceId}', summary: 'Delete a vendor price list entry', resource: 'vendor', action: 'update', params: VendorProductParams },
    { method: 'get', path: '/api/v1/inventory/transfers', summary: 'List stock transfers', resource: 'stock_transfer', action: 'read', query: ListQuery },
    { method: 'post', path: '/api/v1/inventory/transfers/{transferId}/receive', summary: 'Receive a stock transfer', resource: 'stock_transfer', action: 'update', params: TransferParams },
  ];

  for (const def of defs) {
    const status = def.successStatus ?? 200;
    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      ...(def.description ? { description: def.description } : {}),
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      request: {
        ...(def.params ? { params: def.params } : {}),
        ...(def.query ? { query: def.query } : {}),
        ...(def.body ? { body: { schema: def.body === true ? LooseBody : def.body } } : {}),
      },
      responses: {
        [status]: { description: 'Operation succeeded.', schema: LooseSuccess },
        400: { description: 'Validation or request parsing failure.', schema: ApiError },
        401: { description: 'API key missing or invalid.', schema: ApiError },
        403: { description: 'Product access, RBAC, or location scope denied.', schema: ApiError },
        404: { description: 'Inventory resource not found.', schema: ApiError },
        409: { description: 'Inventory state or uniqueness conflict.', schema: ApiError },
        500: { description: 'Unexpected controller or service failure.', schema: ApiError },
      },
      extensions: {
        'x-tenant-scoped': true,
        'x-auth-mechanism': 'x-api-key validated in ApiBaseController.authenticate()',
        'x-rbac-resource': def.resource,
        'x-rbac-action': def.action,
      },
      edition: 'both',
    });
  }
}
