import { describe, expect, it, vi } from "vitest";
import { createInteraction, listInteractionTypes, listInteractions } from "./interactions";
import type { ApiClient } from "./client";

function mockClient(response: unknown = { ok: true, data: { data: [] } }): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

const apiKey = "api-key-1";

describe("interactions api", () => {
  it("types calls GET /api/v1/interaction-types", async () => {
    const client = mockClient();
    await listInteractionTypes(client, { apiKey });
    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/interaction-types",
      signal: undefined,
      headers: { "x-api-key": apiKey },
    });
  });

  it("list filters by opportunity", async () => {
    const client = mockClient();
    await listInteractions(client, { apiKey, page: 1, limit: 50, opportunityId: "opp-1" });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/interactions",
        query: expect.objectContaining({ opportunity_id: "opp-1" }),
      }),
    );
  });

  it("create posts a Call interaction linked to opportunity, client and contact", async () => {
    const client = mockClient();
    await createInteraction(client, {
      apiKey,
      data: {
        type_id: "call-type",
        title: "Called Marisol",
        notes: "Discussed renewal",
        duration: 12,
        opportunity_id: "opp-1",
        client_id: "cl-1",
        contact_name_id: "ct-1",
      },
    });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/interactions",
        body: expect.objectContaining({
          type_id: "call-type",
          opportunity_id: "opp-1",
          client_id: "cl-1",
          contact_name_id: "ct-1",
          duration: 12,
        }),
      }),
    );
  });
});
