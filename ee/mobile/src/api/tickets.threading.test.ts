import { describe, expect, it, vi } from "vitest";
import { addTicketComment, type TicketComment } from "./tickets";
import type { ApiClient } from "./client";

function mockClient(): ApiClient {
  return {
    request: vi.fn().mockResolvedValue({ ok: true, data: { data: {} } }),
  } as unknown as ApiClient;
}

describe("tickets api threading contract", () => {
  it("T009: TicketComment carries thread_id / parent_comment_id / deleted_at", () => {
    const comment: TicketComment = {
      comment_text: "hello",
      thread_id: "thread-1",
      parent_comment_id: "parent-1",
      deleted_at: null,
    };
    expect(comment.thread_id).toBe("thread-1");
    expect(comment.parent_comment_id).toBe("parent-1");
    expect(comment.deleted_at).toBeNull();
  });

  it("T010: addTicketComment includes parent_comment_id in the POST body when provided", async () => {
    const client = mockClient();
    await addTicketComment(client, {
      apiKey: "k",
      ticketId: "t1",
      comment_text: "a reply",
      is_internal: false,
      parent_comment_id: "parent-1",
    });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/tickets/t1/comments",
        body: expect.objectContaining({
          comment_text: "a reply",
          is_internal: false,
          parent_comment_id: "parent-1",
        }),
      }),
    );
  });

  it("T010: addTicketComment omits parent_comment_id from the body when not provided", async () => {
    const client = mockClient();
    await addTicketComment(client, {
      apiKey: "k",
      ticketId: "t1",
      comment_text: "a top-level comment",
      is_internal: true,
    });

    const callArg = (client.request as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      body: Record<string, unknown>;
    };
    expect(callArg.body).not.toHaveProperty("parent_comment_id");
  });
});
