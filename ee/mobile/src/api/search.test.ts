import { describe, expect, it, vi } from "vitest";
import { routeForResult, search, searchableTypes, type SearchResult } from "./search";
import { EMPTY_FEATURE_CAPABILITIES } from "./capabilities";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

function result(type: string, id = "id-1", title = "Thing"): SearchResult {
  return { type, id, title };
}

describe("search api", () => {
  it("T087 sends types as a comma-separated list and parses results and nextCursor", async () => {
    const client = mockClient({
      ok: true,
      data: { data: { results: [result("ticket")], groups: { ticket: 1 }, totalCount: 1, nextCursor: "c-2" } },
    });

    const response = await search(client, {
      apiKey: "key-1",
      query: "flagg",
      types: ["ticket", "client"],
      limit: 10,
      cursor: "c-1",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/search",
      signal: undefined,
      query: { query: "flagg", types: "ticket,client", limit: 10, cursor: "c-1" },
      headers: { "x-api-key": "key-1" },
    });
    expect(response.ok && response.data.data.results).toHaveLength(1);
    expect(response.ok && response.data.data.nextCursor).toBe("c-2");
  });

  it("omits types entirely when none are given", async () => {
    const client = mockClient({ ok: true, data: { data: { results: [] } } });

    await search(client, { apiKey: "key-1", query: "x", types: [] });

    const [req] = (client.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(req.query.types).toBeUndefined();
  });

  it("T088 maps every supported type to its screen and returns null otherwise", () => {
    expect(routeForResult(result("ticket", "t-1"))).toEqual({
      screen: "TicketDetail",
      params: { ticketId: "t-1" },
    });
    expect(routeForResult(result("client", "c-1", "ECTS"))).toEqual({
      screen: "ClientDetail",
      params: { clientId: "c-1", clientName: "ECTS" },
    });
    expect(routeForResult(result("contact", "co-1", "Jason"))).toEqual({
      screen: "ContactDetail",
      params: { contactId: "co-1", contactName: "Jason" },
    });
    expect(routeForResult(result("asset", "a-1", "PC"))).toEqual({
      screen: "AssetDetail",
      params: { assetId: "a-1", assetName: "PC" },
    });
    expect(routeForResult(result("project", "p-1", "Move"))).toEqual({
      screen: "ProjectDetail",
      params: { projectId: "p-1", projectName: "Move" },
    });
    expect(routeForResult(result("project_task", "pt-1"))).toEqual({
      screen: "ProjectTaskDetail",
      params: { taskId: "pt-1" },
    });
    expect(routeForResult(result("invoice", "i-1"))).toBeNull();
    expect(routeForResult(result("ticket_comment", "tc-1"))).toBeNull();
  });

  it("T089 asks only for the types the capabilities can open", () => {
    expect(searchableTypes(EMPTY_FEATURE_CAPABILITIES)).toEqual(["ticket", "client", "contact"]);
    expect(searchableTypes({ ...EMPTY_FEATURE_CAPABILITIES, assets: true })).toEqual([
      "ticket",
      "client",
      "contact",
      "asset",
    ]);
    expect(searchableTypes({ ...EMPTY_FEATURE_CAPABILITIES, projects: true })).toEqual([
      "ticket",
      "client",
      "contact",
      "project",
      "project_task",
    ]);
    expect(searchableTypes({ ...EMPTY_FEATURE_CAPABILITIES, assets: true, projects: true })).toEqual([
      "ticket",
      "client",
      "contact",
      "asset",
      "project",
      "project_task",
    ]);
  });
});
