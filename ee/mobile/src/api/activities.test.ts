import { describe, expect, it, vi } from "vitest";
import {
  moveActivityToGroup,
  removeActivityFromGroups,
  reorderActivitiesInGroup,
} from "./activities";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("moveActivityToGroup", () => {
  it("POSTs the activity ref, target group and sort order", async () => {
    const client = mockClient({ ok: true, status: 200, data: { data: { moved: true } } });

    await moveActivityToGroup(client, {
      apiKey: "api-key-1",
      activityId: "tk-1",
      activityType: "ticket",
      groupId: "grp-9",
      sortOrder: 2,
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/activities/groups/items",
      headers: { "x-api-key": "api-key-1" },
      body: { activityId: "tk-1", activityType: "ticket", groupId: "grp-9", sortOrder: 2 },
    });
  });

  it("passes the API result through unchanged", async () => {
    const failure = { ok: false, status: 404, error: { kind: "http", message: "Target group not found", status: 404 } };
    const client = mockClient(failure);
    const res = await moveActivityToGroup(client, {
      apiKey: "k",
      activityId: "a",
      activityType: "ticket",
      groupId: "missing",
      sortOrder: 0,
    });
    expect(res).toBe(failure);
  });
});

describe("removeActivityFromGroups", () => {
  it("DELETEs with the activity ref as the body", async () => {
    const client = mockClient({ ok: true, status: 200, data: { data: { removed: true } } });

    await removeActivityFromGroups(client, {
      apiKey: "api-key-1",
      activityId: "tk-1",
      activityType: "projectTask",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/v1/activities/groups/items",
      headers: { "x-api-key": "api-key-1" },
      body: { activityId: "tk-1", activityType: "projectTask" },
    });
  });
});

describe("reorderActivitiesInGroup", () => {
  it("PATCHes the group's full ordered membership", async () => {
    const client = mockClient({ ok: true, status: 200, data: { data: { reordered: true } } });
    const items = [
      { activityId: "b", activityType: "ticket", sortOrder: 0 },
      { activityId: "a", activityType: "ticket", sortOrder: 1 },
    ];

    await reorderActivitiesInGroup(client, { apiKey: "api-key-1", groupId: "grp-9", items });

    expect(client.request).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/api/v1/activities/groups/grp-9/items",
      headers: { "x-api-key": "api-key-1" },
      body: { items },
    });
  });
});
