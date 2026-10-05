import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import { taskCommentToTicketComment } from "../../api/projectTaskComments";
import { commentDraftKey, createCommentApi, taskTarget, ticketTarget } from "./commentTarget";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("comment targets", () => {
  it("keeps separate offline drafts per thread kind", () => {
    expect(commentDraftKey(ticketTarget("t1"), "u1")).toBe("alga.mobile.ticketDraft.u1.t1");
    expect(commentDraftKey(taskTarget("k1"), null)).toBe("alga.mobile.taskDraft.anonymous.k1");
  });

  it("maps a task comment onto the shared comment shape as an internal note", () => {
    const mapped = taskCommentToTicketComment({
      task_comment_id: "c1",
      task_id: "k1",
      thread_id: "th1",
      parent_comment_id: null,
      user_id: "u1",
      note: '[{"type":"paragraph"}]',
      created_at: "2026-10-02T10:00:00Z",
      author: { user_id: "u1", first_name: "Sam", last_name: "Lee", avatar_url: "/a.png" },
      reactions: [{ emoji: "👍", count: 1, userIds: ["u2"], currentUserReacted: false }],
    });
    expect(mapped).toMatchObject({
      comment_id: "c1",
      comment_text: '[{"type":"paragraph"}]',
      is_internal: true,
      created_by: "u1",
      created_by_name: "Sam Lee",
      created_by_avatar_url: "/a.png",
      thread_id: "th1",
      reactions: [{ emoji: "👍", count: 1 }],
    });
    expect(taskCommentToTicketComment({ task_comment_id: "c2", task_id: "k1", user_id: "u1", note: "x", created_at: "", deleted_at: "2026-10-02" }).comment_text).toBe("[deleted]");
  });

  it("routes task comment calls to the task endpoints and unwraps to the shared shape", async () => {
    const api = createCommentApi(taskTarget("k1"));
    expect(api.supportsVisibility).toBe(false);
    expect(api.remove).toBeTypeOf("function");
    expect(api.cancelScheduled).toBeUndefined();

    const client = mockClient({ ok: true, status: 200, data: { data: [{ task_comment_id: "c1", task_id: "k1", user_id: "u1", note: "n", created_at: "now" }] } });
    const listed = await api.list(client, { apiKey: "k" });
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/api/v1/projects/tasks/k1/comments" }));
    expect(listed.ok && listed.data.data[0].comment_id).toBe("c1");

    const adder = mockClient({ ok: true, status: 201, data: { data: { task_comment_id: "c9", task_id: "k1", user_id: "u1", note: "n", created_at: "now", parent_comment_id: "c1" } } });
    const added = await api.add(adder, { apiKey: "k", comment_text: "n", is_internal: true, parent_comment_id: "c1" });
    expect(adder.request).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/api/v1/projects/tasks/k1/comments", body: { note: "n", parent_comment_id: "c1" } }));
    expect(added.ok && added.data.data.parent_comment_id).toBe("c1");

    const reactor = mockClient({ ok: true, status: 200, data: { data: { added: true } } });
    await api.toggleReaction(reactor, { apiKey: "k", commentId: "c1", emoji: "👍" });
    expect(reactor.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/projects/tasks/k1/comments/c1/reactions", body: { emoji: "👍" } }));
  });

  it("keeps ticket comment calls on the ticket endpoints", async () => {
    const api = createCommentApi(ticketTarget("t1"));
    expect(api.supportsVisibility).toBe(true);
    const client = mockClient({ ok: true, status: 200, data: { data: [] } });
    await api.list(client, { apiKey: "k" });
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/tickets/t1/comments" }));
  });
});
