import { describe, expect, it, vi } from "vitest";
import { updateTicketContact } from "./tickets";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("updateTicketContact", () => {
  it("calls PUT /api/v1/tickets/{id} with contact_name_id", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });

    await updateTicketContact(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      contact_name_id: "contact-42",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "PUT",
      path: "/api/v1/tickets/ticket-1",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        contact_name_id: "contact-42",
      },
    });
  });

  it("sends null contact_name_id to remove contact", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });

    await updateTicketContact(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      contact_name_id: null,
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "PUT",
      path: "/api/v1/tickets/ticket-1",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        contact_name_id: null,
      },
    });
  });

  it("includes audit headers when provided", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });

    await updateTicketContact(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      contact_name_id: "contact-1",
      auditHeaders: { "x-device": "mobile", "x-session": "sess-1" },
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "PUT",
      path: "/api/v1/tickets/ticket-1",
      headers: {
        "x-api-key": "api-key-1",
        "x-device": "mobile",
        "x-session": "sess-1",
      },
      body: {
        contact_name_id: "contact-1",
      },
    });
  });
});
