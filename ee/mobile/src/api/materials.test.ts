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
