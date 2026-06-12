import { describe, expect, it, vi } from "vitest";
import { listClients, listContacts } from "./referenceData";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("listClients", () => {
  it("calls /api/v1/clients excluding inactive clients", async () => {
    const okResponse = { ok: true, data: { data: [] } };
    const client = mockClient(okResponse);

    const result = await listClients(client, { apiKey: "key-123" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/clients",
      query: {
        limit: 50,
        sort: "client_name",
        order: "asc",
        is_inactive: "false",
      },
      headers: { "x-api-key": "key-123" },
      signal: undefined,
    });
    expect(result).toEqual(okResponse);
  });

  it("keeps is_inactive=false when search is provided", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await listClients(client, { apiKey: "key-123", search: "acme", limit: 10 });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ is_inactive: "false", search: "acme", limit: 10 }),
      }),
    );
  });
});

describe("listContacts", () => {
  it("calls /api/v1/contacts excluding inactive contacts", async () => {
    const okResponse = { ok: true, data: { data: [] } };
    const client = mockClient(okResponse);

    const result = await listContacts(client, { apiKey: "key-123" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/contacts",
      query: {
        limit: 50,
        sort: "full_name",
        order: "asc",
        is_inactive: "false",
      },
      headers: { "x-api-key": "key-123" },
      signal: undefined,
    });
    expect(result).toEqual(okResponse);
  });

  it("keeps is_inactive=false when clientId and search are provided", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await listContacts(client, { apiKey: "key-123", clientId: "client-1", search: "jane" });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          is_inactive: "false",
          client_id: "client-1",
          search: "jane",
        }),
      }),
    );
  });
});
