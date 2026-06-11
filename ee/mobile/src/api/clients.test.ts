import { describe, expect, it, vi } from "vitest";
import { getClient, getClientContacts, getClientLocations, listClients, updateClient } from "./clients";
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

describe("updateClient", () => {
  it("sends a PUT with the account manager id and api key", async () => {
    const okResponse = { ok: true, data: { data: { client_id: "client-1" } } };
    const client = mockClient(okResponse);

    const result = await updateClient(client, {
      apiKey: "key-123",
      clientId: "client-1",
      data: { account_manager_id: "user-9" },
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "PUT",
      path: "/api/v1/clients/client-1",
      signal: undefined,
      headers: { "x-api-key": "key-123" },
      body: { account_manager_id: "user-9" },
    });
    expect(result).toEqual(okResponse);
  });

  it("merges audit headers into the request", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });

    await updateClient(client, {
      apiKey: "key-123",
      clientId: "client-1",
      data: { account_manager_id: "user-9" },
      auditHeaders: { "x-device-id": "device-1" },
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "x-api-key": "key-123", "x-device-id": "device-1" },
      }),
    );
  });
});

describe("getClientContacts", () => {
  it("requests the client contacts with pagination", async () => {
    const okResponse = { ok: true, data: { data: [], pagination: { page: 1, total: 0 } } };
    const client = mockClient(okResponse);

    const result = await getClientContacts(client, { apiKey: "key-123", clientId: "client-1", page: 1, limit: 20 });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/clients/client-1/contacts",
      signal: undefined,
      query: { page: 1, limit: 20 },
      headers: { "x-api-key": "key-123" },
    });
    expect(result).toEqual(okResponse);
  });

  it("forwards the abort signal", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });
    const controller = new AbortController();

    await getClientContacts(client, {
      apiKey: "key-123",
      clientId: "client-1",
      page: 2,
      limit: 20,
      signal: controller.signal,
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal, query: { page: 2, limit: 20 } }),
    );
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
