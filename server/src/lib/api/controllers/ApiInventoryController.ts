import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiBaseController } from './ApiBaseController';
import { InventoryService } from '../services/InventoryService';
import { runWithTenant } from '../../db';
import {
  createPaginatedResponse,
  createSuccessResponse,
  handleApiError,
  NotFoundError,
  ValidationError,
  type AuthenticatedApiRequest,
} from '../middleware/apiMiddleware';
import {
  inventoryAdjustmentSchema,
  inventoryCountListQuerySchema,
  inventoryCountRecordSchema,
  inventoryCountStartSchema,
  inventoryIdParamsSchema,
  inventoryLookupQuerySchema,
  inventoryPoLineReceiveSchema,
  inventoryPurchaseOrderListQuerySchema,
  inventoryReceiptSchema,
  inventoryStockListQuerySchema,
  inventoryTransferListQuerySchema,
  inventoryUnitListQuerySchema,
} from '../schemas/inventorySchemas';

export type InventoryApiResource = 'inventory' | 'purchase_order' | 'cycle_count' | 'stock_transfer';

export class ApiInventoryController extends ApiBaseController {
  private inventoryService: InventoryService;

  constructor(resource: InventoryApiResource = 'inventory') {
    const inventoryService = new InventoryService();
    super(inventoryService, {
      resource,
      permissions: {
        create: 'create',
        read: 'read',
        list: 'read',
        update: 'update',
      },
    });
    this.inventoryService = inventoryService;
  }

  private execute(
    action: 'create' | 'read' | 'update',
    handler: (request: AuthenticatedApiRequest) => Promise<NextResponse>,
  ) {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, action);
          return handler(apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  private async routeId(
    req: AuthenticatedApiRequest,
    key: 'unitId' | 'sessionId' | 'poId' | 'lineId' | 'transferId',
  ): Promise<string> {
    try {
      const params = await req.params;
      const parsed = inventoryIdParamsSchema.parse(params ?? {});
      const id = parsed[key];
      if (!id) throw new ValidationError(`${key} is required`);
      return id;
    } catch (error) {
      if (error instanceof ZodError) throw new ValidationError('Invalid route parameter', error.errors);
      throw error;
    }
  }

  lookup() {
    return this.execute('read', async (request) => {
      const query = this.validateQuery(request, inventoryLookupQuerySchema);
      const result = await this.inventoryService.lookup(query.code, request.context);
      return createSuccessResponse(result, 200, undefined, request);
    });
  }

  listStock() {
    return this.execute('read', async (request) => {
      const query = this.validateQuery(request, inventoryStockListQuerySchema);
      const result = await this.inventoryService.listStock(query, request.context);
      const { page, limit, ...filters } = query;
      return createPaginatedResponse(result.data, result.total, page, limit, { filters }, request);
    });
  }

  listLocations() {
    return this.execute('read', async (request) => createSuccessResponse(
      await this.inventoryService.listLocations(request.context),
      200,
      undefined,
      request,
    ));
  }

  listUnits() {
    return this.execute('read', async (request) => {
      const query = this.validateQuery(request, inventoryUnitListQuerySchema);
      const result = await this.inventoryService.listUnits(query, request.context);
      const { page, limit, ...filters } = query;
      return createPaginatedResponse(result.data, result.total, page, limit, { filters }, request);
    });
  }

  getUnit() {
    return this.execute('read', async (request) => {
      const unit = await this.inventoryService.getUnit(await this.routeId(request, 'unitId'), request.context);
      if (!unit) throw new NotFoundError('Stock unit not found');
      return createSuccessResponse(unit, 200, undefined, request);
    });
  }

  receiveStock() {
    return this.execute('create', async (request) => {
      const data = await this.validateData(request, inventoryReceiptSchema);
      return createSuccessResponse(
        await this.inventoryService.receiveStock(data, request.context),
        201,
        undefined,
        request,
      );
    });
  }

  adjustStock() {
    return this.execute('update', async (request) => {
      const data = await this.validateData(request, inventoryAdjustmentSchema);
      return createSuccessResponse(
        await this.inventoryService.adjustStock(data, request.context),
        200,
        undefined,
        request,
      );
    });
  }

  listCounts() {
    return this.execute('read', async (request) => {
      const query = this.validateQuery(request, inventoryCountListQuerySchema);
      const result = await this.inventoryService.listCounts(query, request.context);
      const { page, limit, ...filters } = query;
      return createPaginatedResponse(result.data, result.total, page, limit, { filters }, request);
    });
  }

  startCount() {
    return this.execute('create', async (request) => {
      const data = await this.validateData(request, inventoryCountStartSchema);
      return createSuccessResponse(
        await this.inventoryService.startCount(data.location_id, request.context),
        201,
        undefined,
        request,
      );
    });
  }

  getCount() {
    return this.execute('read', async (request) => {
      const count = await this.inventoryService.getCount(await this.routeId(request, 'sessionId'), request.context);
      if (!count) throw new NotFoundError('Count session not found');
      return createSuccessResponse(count, 200, undefined, request);
    });
  }

  recordCount() {
    return this.execute('update', async (request) => {
      const sessionId = await this.routeId(request, 'sessionId');
      const data = await this.validateData(request, inventoryCountRecordSchema);
      return createSuccessResponse(
        await this.inventoryService.recordCount(sessionId, data, request.context),
        200,
        undefined,
        request,
      );
    });
  }

  submitCount() {
    return this.execute('update', async (request) => createSuccessResponse(
      await this.inventoryService.submitCount(await this.routeId(request, 'sessionId'), request.context),
      200,
      undefined,
      request,
    ));
  }

  listPurchaseOrders() {
    return this.execute('read', async (request) => {
      const query = this.validateQuery(request, inventoryPurchaseOrderListQuerySchema);
      const result = await this.inventoryService.listPurchaseOrders(query, request.context);
      const { page, limit, ...filters } = query;
      return createPaginatedResponse(result.data, result.total, page, limit, { filters }, request);
    });
  }

  getPurchaseOrder() {
    return this.execute('read', async (request) => {
      const po = await this.inventoryService.getPurchaseOrder(await this.routeId(request, 'poId'), request.context);
      if (!po) throw new NotFoundError('Purchase order not found');
      return createSuccessResponse(po, 200, undefined, request);
    });
  }

  receivePurchaseOrderLine() {
    return this.execute('update', async (request) => {
      const [poId, lineId] = await Promise.all([
        this.routeId(request, 'poId'),
        this.routeId(request, 'lineId'),
      ]);
      const data = await this.validateData(request, inventoryPoLineReceiveSchema);
      return createSuccessResponse(
        await this.inventoryService.receivePurchaseOrderLine(poId, lineId, data, request.context),
        200,
        undefined,
        request,
      );
    });
  }

  listTransfers() {
    return this.execute('read', async (request) => {
      const query = this.validateQuery(request, inventoryTransferListQuerySchema);
      const result = await this.inventoryService.listTransfers(query, request.context);
      const { page, limit, ...filters } = query;
      return createPaginatedResponse(result.data, result.total, page, limit, { filters }, request);
    });
  }

  receiveTransfer() {
    return this.execute('update', async (request) => createSuccessResponse(
      await this.inventoryService.receiveTransfer(await this.routeId(request, 'transferId'), request.context),
      200,
      undefined,
      request,
    ));
  }
}
