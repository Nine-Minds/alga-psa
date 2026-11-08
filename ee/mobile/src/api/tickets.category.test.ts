import { describe, expect, it, vi } from "vitest";
import { getTicketCategories, updateTicketCategory } from "./tickets";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("getTicketCategories", () => {
  it("reads the ticket:read categories route scoped to the board", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await getTicketCategories(client, { apiKey: "api-key-1", board_id: "board-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/tickets/categories",
      query: { board_id: "board-1" },
      headers: { "x-api-key": "api-key-1" },
    });
  });

  it("omits the filter when the ticket has no board", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await getTicketCategories(client, { apiKey: "api-key-1", board_id: null });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/api/v1/tickets/categories", query: undefined }),
    );
  });
});

describe("updateTicketCategory", () => {
  it("sends both columns so a subcategory can be cleared", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });

    await updateTicketCategory(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      category_id: "network",
      subcategory_id: null,
      auditHeaders: { "x-device": "mobile" },
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "PUT",
      path: "/api/v1/tickets/ticket-1",
      headers: { "x-api-key": "api-key-1", "x-device": "mobile" },
      body: { category_id: "network", subcategory_id: null },
    });
  });

  it("passes notification suppression through", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });

    await updateTicketCategory(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      category_id: "hardware",
      subcategory_id: "laptop",
      notificationSuppression: { suppressContactNotifications: true, suppressInternalNotifications: false },
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          category_id: "hardware",
          subcategory_id: "laptop",
          suppressContactNotifications: true,
          suppressInternalNotifications: false,
        },
      }),
    );
  });
});
