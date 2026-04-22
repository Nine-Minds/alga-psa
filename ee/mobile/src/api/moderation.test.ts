import { describe, expect, it, vi } from "vitest";
import { listMutedUsers, muteUser, reportContent, unmuteUser } from "./moderation";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("moderation api", () => {
  it("reportContent POSTs the report body to /api/v1/mobile/moderation/report with a 10s timeout", async () => {
    const client = mockClient({ ok: true, data: { ok: true } });
    const signal = new AbortController().signal;

    await reportContent(
      client,
      {
        contentType: "ticket_comment",
        contentId: "comment-uuid",
        contentAuthorUserId: "11111111-2222-3333-4444-555555555555",
        reason: "spam",
      },
      signal,
    );

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/mobile/moderation/report",
      body: {
        contentType: "ticket_comment",
        contentId: "comment-uuid",
        contentAuthorUserId: "11111111-2222-3333-4444-555555555555",
        reason: "spam",
      },
      signal,
      timeoutMs: 10_000,
    });
  });

  it("listMutedUsers GETs /api/v1/mobile/moderation/mutes", async () => {
    const client = mockClient({ ok: true, data: { mutedUserIds: ["a", "b"] } });
    const signal = new AbortController().signal;

    const result = await listMutedUsers(client, signal);

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/mobile/moderation/mutes",
      signal,
      timeoutMs: 10_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.mutedUserIds).toEqual(["a", "b"]);
  });

  it("muteUser POSTs the user id to the mutes collection", async () => {
    const client = mockClient({ ok: true, data: { ok: true } });

    await muteUser(client, { mutedUserId: "user-uuid" });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/mobile/moderation/mutes",
      body: { mutedUserId: "user-uuid" },
      signal: undefined,
      timeoutMs: 10_000,
    });
  });

  it("unmuteUser DELETEs the mute resource and URL-encodes the user id", async () => {
    const client = mockClient({ ok: true, data: { ok: true } });

    await unmuteUser(client, "weird/id with space");

    const call = vi.mocked(client.request).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.method).toBe("DELETE");
    expect(call.path).toBe(
      `/api/v1/mobile/moderation/mutes/${encodeURIComponent("weird/id with space")}`,
    );
    // No body for DELETE.
    expect(call).not.toHaveProperty("body");
    expect(call.timeoutMs).toBe(10_000);
  });
});
