import { describe, expect, it, vi } from "vitest";
import {
  addTicketTag,
  dedupeTagSuggestions,
  getTicketTags,
  removeTicketTag,
  searchTagSuggestions,
} from "./tags";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("getTicketTags", () => {
  it("calls GET /api/v1/tags/entity/ticket/{id}", async () => {
    const client = mockClient({ ok: true, status: 200, data: { data: { tags: [] } } });

    await getTicketTags(client, { apiKey: "api-key-1", ticketId: "ticket-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/tags/entity/ticket/ticket-1",
      signal: undefined,
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });
});

describe("addTicketTag", () => {
  it("calls POST with entity_id, entity_type and tags array", async () => {
    const client = mockClient({ ok: true, status: 201, data: { data: { tags: [] } } });

    await addTicketTag(client, { apiKey: "api-key-1", ticketId: "ticket-1", tagText: "vip" });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/tags/entity/ticket/ticket-1",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        entity_id: "ticket-1",
        entity_type: "ticket",
        tags: ["vip"],
      },
    });
  });

  it("includes audit headers when provided", async () => {
    const client = mockClient({ ok: true, status: 201, data: { data: { tags: [] } } });

    await addTicketTag(client, {
      apiKey: "api-key-1",
      ticketId: "ticket-1",
      tagText: "vip",
      auditHeaders: { "x-device": "mobile" },
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          "x-api-key": "api-key-1",
          "x-device": "mobile",
        },
      }),
    );
  });
});

describe("removeTicketTag", () => {
  it("calls DELETE with entity_id, entity_type and tag_ids", async () => {
    const client = mockClient({ ok: true, status: 200, data: { data: { removed_count: 1 } } });

    await removeTicketTag(client, { apiKey: "api-key-1", ticketId: "ticket-1", tagId: "tag-9" });

    expect(client.request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/v1/tags/entity/ticket/ticket-1",
      headers: {
        "x-api-key": "api-key-1",
      },
      body: {
        entity_id: "ticket-1",
        entity_type: "ticket",
        tag_ids: ["tag-9"],
      },
    });
  });
});

describe("searchTagSuggestions", () => {
  it("uses the tag cloud endpoint for an empty search", async () => {
    const client = mockClient({
      ok: true,
      status: 200,
      data: { data: { tags: [{ tag_text: "vip", background_color: "#FF0000", text_color: null }] } },
    });

    const res = await searchTagSuggestions(client, { apiKey: "api-key-1", search: "  " });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/tags/cloud",
      signal: undefined,
      query: {
        entity_type: "ticket",
        limit: 50,
      },
      headers: {
        "x-api-key": "api-key-1",
      },
    });
    expect(res).toEqual({
      ok: true,
      status: 200,
      data: [{ tag_text: "vip", background_color: "#FF0000", text_color: null }],
    });
  });

  it("uses the search endpoint with search_term for a non-empty search", async () => {
    const client = mockClient({
      ok: true,
      status: 200,
      data: { data: [{ tag_id: "m1", tag_text: "urgent", background_color: null, text_color: null }] },
    });

    const res = await searchTagSuggestions(client, { apiKey: "api-key-1", search: " urg ", limit: 10 });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/tags/search",
      signal: undefined,
      query: {
        search_term: "urg",
        entity_type: "ticket",
        limit: 10,
      },
      headers: {
        "x-api-key": "api-key-1",
      },
    });
    expect(res).toEqual({
      ok: true,
      status: 200,
      data: [{ tag_text: "urgent", background_color: null, text_color: null }],
    });
  });

  it("passes through errors unchanged", async () => {
    const failure = { ok: false, status: 403, error: { kind: "permission", message: "nope", status: 403 } };
    const client = mockClient(failure);

    const res = await searchTagSuggestions(client, { apiKey: "api-key-1", search: "x" });

    expect(res).toBe(failure);
  });
});

describe("dedupeTagSuggestions", () => {
  it("dedupes case-insensitively keeping the first entry's colors", () => {
    const result = dedupeTagSuggestions([
      { tag_text: "VIP", background_color: "#FF0000", text_color: "#FFFFFF" },
      { tag_text: "vip", background_color: "#00FF00", text_color: null },
      { tag_text: "billing" },
    ]);

    expect(result).toEqual([
      { tag_text: "billing", background_color: null, text_color: null },
      { tag_text: "VIP", background_color: "#FF0000", text_color: "#FFFFFF" },
    ]);
  });

  it("drops blank or non-string tag texts and trims whitespace", () => {
    const result = dedupeTagSuggestions([
      { tag_text: "  spaced  " },
      { tag_text: "   " },
      { tag_text: undefined },
      { tag_text: 42 as unknown as string },
    ]);

    expect(result).toEqual([{ tag_text: "spaced", background_color: null, text_color: null }]);
  });

  it("sorts suggestions alphabetically", () => {
    const result = dedupeTagSuggestions([
      { tag_text: "zeta" },
      { tag_text: "Alpha" },
      { tag_text: "mid" },
    ]);

    expect(result.map((s) => s.tag_text)).toEqual(["Alpha", "mid", "zeta"]);
  });
});
