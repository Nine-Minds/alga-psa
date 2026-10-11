import { describe, expect, it, vi } from "vitest";
import { createClient, createClientLocation, getClient, getClientContacts, getClientLocations, listClients, updateClient, updateClientLocation } from "./clients";
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

describe("client writes", () => {
  it("creates a client with the monthly billing cycle the API requires", async () => {
    const client = mockClient({ ok: true, data: { data: { client_id: "client-9" } } });

    await createClient(client, { apiKey: "key-123", data: { client_name: "Acme", client_type: "company" }, auditHeaders: { "x-device": "ios" } });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/clients",
      signal: undefined,
      headers: { "x-api-key": "key-123", "x-device": "ios" },
      body: { billing_cycle: "monthly", client_name: "Acme", client_type: "company" },
    });
  });

  it("creates and updates the client's location through the locations routes", async () => {
    const client = mockClient({ ok: true, data: { data: { location_id: "loc-1" } } });

    await createClientLocation(client, {
      apiKey: "key-123",
      clientId: "client-1",
      data: { address_line1: "1 Main St", city: "Springfield", country_code: "US", country_name: "United States", phone: "+13202521658" },
    });
    await updateClientLocation(client, { apiKey: "key-123", clientId: "client-1", locationId: "loc-1", data: { email: "ops@acme.test" } });

    expect(client.request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: "POST",
      path: "/api/v1/clients/client-1/locations",
      body: expect.objectContaining({ country_code: "US", phone: "+13202521658" }),
    }));
    expect(client.request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: "PUT",
      path: "/api/v1/clients/client-1/locations/loc-1",
      body: { email: "ops@acme.test" },
    }));
  });
});
