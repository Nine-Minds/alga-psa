import { describe, expect, it, vi } from "vitest";
import { getClient, getClientLocations, listClients } from "./clients";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("listClients", () => {
  it("requests paginated active clients sorted by name", async () => {
    const okResponse = { ok: true, data: { data: [], pagination: { page: 1 } } };
    const client = mockClient(okResponse);

    const result = await listClients(client, { apiKey: "key-123", page: 1, limit: 25 });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/clients",
      signal: undefined,
      query: {
        page: 1,
        limit: 25,
        sort: "client_name",
        order: "asc",
        is_inactive: "false",
        client_name: undefined,
      },
      headers: { "x-api-key": "key-123" },
    });
    expect(result).toEqual(okResponse);
  });

  it("passes search as client_name and keeps is_inactive false", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await listClients(client, { apiKey: "key-123", page: 2, limit: 10, search: "acme" });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          is_inactive: "false",
          client_name: "acme",
          page: 2,
          limit: 10,
        }),
      }),
    );
  });

  it("forwards the abort signal", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });
    const controller = new AbortController();

    await listClients(client, { apiKey: "key-123", page: 1, limit: 25, signal: controller.signal });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe("getClient", () => {
  it("requests the client by id with the api key", async () => {
    const okResponse = { ok: true, data: { data: { client_id: "client-1" } } };
    const client = mockClient(okResponse);

    const result = await getClient(client, { apiKey: "key-123", clientId: "client-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/clients/client-1",
      signal: undefined,
      headers: { "x-api-key": "key-123" },
    });
    expect(result).toEqual(okResponse);
  });
});

describe("getClientLocations", () => {
  it("requests the client locations", async () => {
    const okResponse = { ok: true, data: { data: [] } };
    const client = mockClient(okResponse);

    const result = await getClientLocations(client, { apiKey: "key-123", clientId: "client-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/clients/client-1/locations",
      signal: undefined,
      headers: { "x-api-key": "key-123" },
    });
    expect(result).toEqual(okResponse);
  });
});
