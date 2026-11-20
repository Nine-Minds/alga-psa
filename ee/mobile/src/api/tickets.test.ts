import { describe, expect, it, vi } from "vitest";
import { addTicketComment, getTicketAssets, listTickets, updateTicketStatus } from "./tickets";
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

  it("forwards both notification suppression levels on a ticket update", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });
    await updateTicketStatus(client, {
      apiKey: "k",
      ticketId: "tk-1",
      status_id: "closed",
      notificationSuppression: {
        suppressContactNotifications: true,
        suppressInternalNotifications: true,
      },
    });
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "PUT",
      path: "/api/v1/tickets/tk-1/status",
      body: {
        status_id: "closed",
        suppressContactNotifications: true,
        suppressInternalNotifications: true,
      },
    }));
  });

  it("forwards propagateToChildren only when supplied", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });

    await updateTicketStatus(client, {
      apiKey: "k",
      ticketId: "tk-1",
      status_id: "closed",
      propagateToChildren: false,
    });
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "PUT",
      path: "/api/v1/tickets/tk-1/status",
      body: { status_id: "closed", propagateToChildren: false },
    }));
  });
});

describe("addTicketComment", () => {
  it("sends the collaboration audience only when one is chosen (older servers reject unknown keys)", async () => {
    const client = mockClient({ ok: true, data: { data: {} } });
    await addTicketComment(client, { apiKey: "k", ticketId: "t1", comment_text: "hi", is_internal: true, collaboration_audience: "shared_it" });
    await addTicketComment(client, { apiKey: "k", ticketId: "t1", comment_text: "hi", is_internal: true });

    const bodies = (client.request as ReturnType<typeof vi.fn>).mock.calls.map(([request]) => request.body);
    expect(bodies[0]).toMatchObject({ is_internal: true, collaboration_audience: "shared_it" });
    expect(bodies[1]).not.toHaveProperty("collaboration_audience");
  });
});
