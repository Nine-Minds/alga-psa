import { describe, expect, it, vi } from "vitest";
import { addTicketMaterial, getTicketMaterials, listProducts } from "./materials";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("materials api", () => {
  it("calls GET /api/v1/tickets/{id}/materials", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await getTicketMaterials(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/tickets/ticket-1/materials",
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("calls POST /api/v1/tickets/{id}/materials", async () => {
    const client = mockClient({ ok: true, data: { data: { ticket_material_id: "mat-1" } } });

    await addTicketMaterial(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      data: {
        service_id: "service-1",
        quantity: 2,
        rate: 7500,
        currency_code: "USD",
      },
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/tickets/ticket-1/materials",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        service_id: "service-1",
        quantity: 2,
        rate: 7500,
        currency_code: "USD",
      },
    });
  });

  it("passes unit_id through for a serialized install", async () => {
    const client = mockClient({ ok: true, data: { data: { ticket_material_id: "mat-2" } } });

    await addTicketMaterial(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      data: {
        service_id: "service-1",
        quantity: 1,
        rate: 129900,
        currency_code: "USD",
        unit_id: "unit-9",
      },
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ unit_id: "unit-9" }),
      }),
    );
  });

  it("calls GET /api/v1/products for product search", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await listProducts(client, {
      apiKey: "api-key-1",
      search: "ssd",
      limit: 12,
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/products",
      query: {
        limit: 12,
        sort: "service_name",
        order: "asc",
        is_active: true,
        search: "ssd",
      },
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });
});

describe("setProductBarcode", () => {
  it("PUTs the barcode to /api/v1/products/{id}", async () => {
    const client = { request: vi.fn().mockResolvedValue({ ok: true, data: { data: {} } }) } as never;
    const { setProductBarcode } = await import("./materials");
    await setProductBarcode(client, { apiKey: "api-key-1", productId: "svc-3", barcode: "0123456789012" });
    expect((client as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/api/v1/products/svc-3",
        body: { barcode: "0123456789012" },
      }),
    );
  });
});
