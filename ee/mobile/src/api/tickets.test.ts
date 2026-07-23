import { describe, expect, it, vi } from "vitest";
import { getTicketAssets, listTickets } from "./tickets";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("tickets api", () => {
  it("getTicketAssets GETs /api/v1/tickets/{id}/assets", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });
    await getTicketAssets(client, { apiKey: "k", ticketId: "tk-1" });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/tickets/tk-1/assets",
        headers: { "x-api-key": "k" },
      }),
    );
  });

  it("listTickets forwards the client_id filter into the query", async () => {
    const client = mockClient({ ok: true, data: { data: [], pagination: {} } });
    await listTickets(client, {
      apiKey: "k",
      page: 1,
      limit: 50,
      filters: { is_open: true, client_id: "cl-1" },
    });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/tickets",
        query: expect.objectContaining({ is_open: true, client_id: "cl-1" }),
      }),
    );
  });
});
