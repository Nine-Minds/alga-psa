import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import type { ZodTypeAny } from 'zod';

export function registerInventoryV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Inventory v1';
  const UnitParams = registry.registerSchema(
    'InventoryUnitParamsV1',
    zOpenApi.object({ unitId: zOpenApi.string().uuid() }),
  );
  const CountParams = registry.registerSchema(
    'InventoryCountParamsV1',
    zOpenApi.object({ sessionId: zOpenApi.string().uuid() }),
  );
  const PurchaseOrderParams = registry.registerSchema(
    'InventoryPurchaseOrderParamsV1',
    zOpenApi.object({ poId: zOpenApi.string().uuid() }),
  );
  const PurchaseOrderLineParams = registry.registerSchema(
    'InventoryPurchaseOrderLineParamsV1',
    zOpenApi.object({
      poId: zOpenApi.string().uuid(),
      lineId: zOpenApi.string().uuid(),
    }),
  );
  const TransferParams = registry.registerSchema(
    'InventoryTransferParamsV1',
    zOpenApi.object({ transferId: zOpenApi.string().uuid() }),
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
      location_id: zOpenApi.string().uuid().optional(),
      service_id: zOpenApi.string().uuid().optional(),
      client_id: zOpenApi.string().uuid().optional(),
      low_stock: zOpenApi.enum(['true', 'false']).optional(),
    }),
  );
  // TODO: Replace the loose inventory bodies and responses with the inventory route schemas.
  const LooseBody = registry.registerSchema(
    'InventoryLooseBodyV1',
    zOpenApi.record(zOpenApi.unknown()),
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
    method: 'get' | 'post';
    path: string;
    summary: string;
    resource: 'inventory' | 'cycle_count' | 'purchase_order' | 'stock_transfer';
    action: 'read' | 'create' | 'update';
    params?: ZodTypeAny;
    query?: ZodTypeAny;
    body?: boolean;
    successStatus?: 200 | 201;
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
    { method: 'get', path: '/api/v1/inventory/purchase-orders', summary: 'List purchase orders', resource: 'purchase_order', action: 'read', query: ListQuery },
    { method: 'get', path: '/api/v1/inventory/purchase-orders/{poId}', summary: 'Get a purchase order', resource: 'purchase_order', action: 'read', params: PurchaseOrderParams },
    { method: 'post', path: '/api/v1/inventory/purchase-orders/{poId}/lines/{lineId}/receive', summary: 'Receive a purchase-order line', resource: 'purchase_order', action: 'update', params: PurchaseOrderLineParams, body: true },
    { method: 'get', path: '/api/v1/inventory/transfers', summary: 'List stock transfers', resource: 'stock_transfer', action: 'read', query: ListQuery },
    { method: 'post', path: '/api/v1/inventory/transfers/{transferId}/receive', summary: 'Receive a stock transfer', resource: 'stock_transfer', action: 'update', params: TransferParams },
  ];

  for (const def of defs) {
    const status = def.successStatus ?? 200;
    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      request: {
        ...(def.params ? { params: def.params } : {}),
        ...(def.query ? { query: def.query } : {}),
        ...(def.body ? { body: { schema: LooseBody } } : {}),
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
