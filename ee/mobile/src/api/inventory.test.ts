import { describe, expect, it, vi } from "vitest";
import {
  adjustStock,
  getCountSession,
  getPurchaseOrder,
  getStockUnit,
  listCountSessions,
  listPurchaseOrders,
  listStockLevels,
  listStockLocations,
  listStockUnits,
  listTransfers,
  lookupInventoryCode,
  receivePurchaseOrderLine,
  receiveStock,
  receiveTransfer,
  recordCount,
  startCountSession,
  submitCountSession,
} from "./inventory";
import type { ApiClient } from "./client";

function mockClient(response: unknown = { ok: true, data: { data: [] } }): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

const apiKey = "api-key-1";

describe("inventory api", () => {
  it("lookup calls GET /api/v1/inventory/lookup with the code", async () => {
    const client = mockClient();
    await lookupInventoryCode(client, { apiKey, code: "036000291452" });
    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/inventory/lookup",
      signal: undefined,
      query: { code: "036000291452" },
      headers: { "x-api-key": apiKey },
    });
  });

  it("stock levels pass filters and pagination", async () => {
    const client = mockClient();
    await listStockLevels(client, {
      apiKey,
      page: 2,
      limit: 25,
      search: "phone",
      locationId: "loc-1",
      lowStock: true,
    });
    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/inventory/stock",
      signal: undefined,
      query: {
        page: 2,
        limit: 25,
        search: "phone",
        location_id: "loc-1",
        service_id: undefined,
        low_stock: "true",
      },
      headers: { "x-api-key": apiKey },
    });
  });

  it("stock locations calls GET /api/v1/inventory/stock-locations", async () => {
    const client = mockClient();
    await listStockLocations(client, { apiKey });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/inventory/stock-locations" }),
    );
  });

  it("units list passes search/status filters; unit detail hits /units/{id}", async () => {
    const client = mockClient();
    await listStockUnits(client, { apiKey, page: 1, limit: 20, search: "SN123", status: "in_stock" });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/v1/inventory/units",
        query: expect.objectContaining({ search: "SN123", status: "in_stock" }),
      }),
    );
    await getStockUnit(client, { apiKey, unitId: "unit-9" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/inventory/units/unit-9" }),
    );
  });

  it("receive posts serials to /api/v1/inventory/receipts", async () => {
    const client = mockClient();
    await receiveStock(client, {
      apiKey,
      data: {
        service_id: "svc-1",
        location_id: "loc-1",
        quantity: 2,
        serials: [{ serial_number: "A1" }, { serial_number: "A2", mac_address: "AA:BB:CC:00:11:22" }],
      },
    });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/inventory/receipts",
        body: expect.objectContaining({ quantity: 2, serials: expect.any(Array) }),
      }),
    );
  });

  it("adjust posts delta and reason to /api/v1/inventory/adjustments", async () => {
    const client = mockClient();
    await adjustStock(client, {
      apiKey,
      data: { service_id: "svc-1", location_id: "loc-1", quantity_delta: -3, reason: "damaged" },
    });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/inventory/adjustments",
        body: { service_id: "svc-1", location_id: "loc-1", quantity_delta: -3, reason: "damaged" },
      }),
    );
  });

  it("count lifecycle hits the counts endpoints", async () => {
    const client = mockClient();
    await listCountSessions(client, { apiKey, page: 1, limit: 20 });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/inventory/counts" }),
    );
    await startCountSession(client, { apiKey, data: { location_id: "loc-1" } });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "POST", path: "/api/v1/inventory/counts", body: { location_id: "loc-1" } }),
    );
    await getCountSession(client, { apiKey, sessionId: "cs-1" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/v1/inventory/counts/cs-1" }),
    );
    await recordCount(client, { apiKey, sessionId: "cs-1", data: { service_id: "svc-1", counted_quantity: 7 } });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/inventory/counts/cs-1/records",
        body: { service_id: "svc-1", counted_quantity: 7 },
      }),
    );
    await submitCountSession(client, { apiKey, sessionId: "cs-1" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "POST", path: "/api/v1/inventory/counts/cs-1/submit" }),
    );
  });

  it("purchase orders: list filters by status, receive line posts qty + serials", async () => {
    const client = mockClient();
    await listPurchaseOrders(client, { apiKey, page: 1, limit: 20, status: "open,partially_received" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/api/v1/inventory/purchase-orders",
        query: expect.objectContaining({ status: "open,partially_received" }),
      }),
    );
    await getPurchaseOrder(client, { apiKey, poId: "po-1" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "/api/v1/inventory/purchase-orders/po-1" }),
    );
    await receivePurchaseOrderLine(client, {
      apiKey,
      poId: "po-1",
      lineId: "line-2",
      data: { quantity: 3, serials: [{ serial_number: "S1" }, { serial_number: "S2" }, { serial_number: "S3" }] },
    });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/inventory/purchase-orders/po-1/lines/line-2/receive",
        body: expect.objectContaining({ quantity: 3 }),
      }),
    );
  });

  it("transfers: list dispatched and receive by id", async () => {
    const client = mockClient();
    await listTransfers(client, { apiKey, page: 1, limit: 20, status: "dispatched" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/api/v1/inventory/transfers",
        query: expect.objectContaining({ status: "dispatched" }),
      }),
    );
    await receiveTransfer(client, { apiKey, transferId: "tr-1" });
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "POST", path: "/api/v1/inventory/transfers/tr-1/receive" }),
    );
  });
});
