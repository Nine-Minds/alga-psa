import { describe, expect, it, vi } from "vitest";
import { deleteTicketDocument, getTicketDocuments, uploadTicketDocument } from "./documents";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("documents api", () => {
  it("calls GET /api/v1/tickets/{id}/documents", async () => {
    const client = mockClient({ ok: true, data: { data: [] } });

    await getTicketDocuments(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/tickets/ticket-1/documents",
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });

  it("calls POST /api/v1/tickets/{id}/documents with multipart form data", async () => {
    const client = mockClient({ ok: true, data: { data: { document_id: "doc-1" } } });

    await uploadTicketDocument(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      file: {
        uri: "file:///tmp/example.png",
        name: "example.png",
        mimeType: "image/png",
      },
    });

    expect(client.request).toHaveBeenCalledTimes(1);
    const request = vi.mocked(client.request).mock.calls[0]?.[0];
    expect(request).toMatchObject({
      method: "POST",
      path: "/api/v1/tickets/ticket-1/documents",
      headers: {
        "x-api-key": "api-key-1",
      },
    });
    expect(request?.body).toBeInstanceOf(FormData);
  });

  it("calls DELETE /api/v1/tickets/{id}/documents/{documentId}", async () => {
    const client = mockClient({ ok: true, data: { data: null } });

    await deleteTicketDocument(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      documentId: "doc-1",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/v1/tickets/ticket-1/documents/doc-1",
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });
});
