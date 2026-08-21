import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  createTicketChecklistItem,
  getTicketChecklist,
  setTicketChecklistItemCompleted,
} from "./ticketChecklist";

function mockClient(): ApiClient {
  return { request: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { data: [] } }) } as unknown as ApiClient;
}

describe("ticket checklist api", () => {
  it("lists a ticket checklist", async () => {
    const client = mockClient();
    await getTicketChecklist(client, { apiKey: "key-1", ticketId: "ticket-1" });
    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/tickets/ticket-1/checklist",
      signal: undefined,
      headers: { "x-api-key": "key-1" },
    });
  });

  it("creates a required item with audit headers", async () => {
    const client = mockClient();
    await createTicketChecklistItem(client, {
      apiKey: "key-1",
      ticketId: "ticket-1",
      itemName: "Confirm backup",
      isRequired: true,
      auditHeaders: { "x-client": "mobile" },
    });
    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/tickets/ticket-1/checklist",
      headers: { "x-api-key": "key-1", "x-client": "mobile" },
      body: { item_name: "Confirm backup", is_required: true },
    });
  });

  it("updates only completion on the ticket-bound item route", async () => {
    const client = mockClient();
    await setTicketChecklistItemCompleted(client, {
      apiKey: "key-1",
      ticketId: "ticket-1",
      itemId: "item-1",
      completed: true,
    });
    expect(client.request).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/api/v1/tickets/ticket-1/checklist/item-1",
      headers: { "x-api-key": "key-1" },
      body: { completed: true },
    });
  });
});
