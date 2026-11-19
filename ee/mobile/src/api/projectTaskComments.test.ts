import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  addTaskComment,
  deleteTaskComment,
  getTaskComments,
  taskCommentToTicketComment,
  toggleTaskCommentReaction,
  updateTaskComment,
  type TaskCommentResource,
} from "./projectTaskComments";

function mockClient(response: unknown = { ok: true, data: { data: [] } }): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

const base: TaskCommentResource = {
  task_comment_id: "c1",
  task_id: "t1",
  user_id: "u1",
  note: "[{\"type\":\"paragraph\"}]",
  created_at: "2026-11-01T10:00:00Z",
};

describe("taskCommentToTicketComment", () => {
  it("maps an authored comment to an internal ticket comment", () => {
    const out = taskCommentToTicketComment({
      ...base,
      thread_id: "th1",
      parent_comment_id: "p1",
      author: { user_id: "u1", first_name: "Ada", last_name: "Lovelace", avatar_url: "https://a/b.png" },
      reactions: [{ emoji: "👍", count: 1, userIds: ["u1"], currentUserReacted: true } as never],
      reaction_user_names: { u1: "Ada" },
    });
    expect(out).toEqual({
      comment_id: "c1",
      comment_text: base.note,
      is_internal: true,
      created_by: "u1",
      created_by_name: "Ada Lovelace",
      created_by_avatar_url: "https://a/b.png",
      created_at: base.created_at,
      thread_id: "th1",
      parent_comment_id: "p1",
      deleted_at: null,
      reactions: [expect.objectContaining({ emoji: "👍" })],
      reaction_user_names: { u1: "Ada" },
      kind: "comment",
    });
  });

  it("falls back to the author email, then null, and masks deleted comments", () => {
    expect(taskCommentToTicketComment({ ...base, author: { user_id: "u1", email: "a@b.c" } }).created_by_name).toBe("a@b.c");
    const bare = taskCommentToTicketComment(base);
    expect(bare.created_by_name).toBeNull();
    expect(bare.created_by_avatar_url).toBeNull();
    expect(bare.thread_id).toBeNull();
    expect(bare.reactions).toEqual([]);
    expect(bare.reaction_user_names).toEqual({});
    const deleted = taskCommentToTicketComment({ ...base, deleted_at: "2026-11-02T00:00:00Z" });
    expect(deleted.comment_text).toBe("[deleted]");
    expect(deleted.deleted_at).toBe("2026-11-02T00:00:00Z");
  });
});

describe("project task comments api", () => {
  it("lists comments for a task", async () => {
    const client = mockClient();
    await getTaskComments(client, { apiKey: "k", taskId: "t1" });
    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/projects/tasks/t1/comments",
      signal: undefined,
      headers: { "x-api-key": "k" },
    });
  });

  it("adds a comment with audit headers and optional parent", async () => {
    const client = mockClient();
    await addTaskComment(client, { apiKey: "k", taskId: "t1", note: "n", auditHeaders: { "x-audit": "1" } });
    await addTaskComment(client, { apiKey: "k", taskId: "t1", note: "reply", parent_comment_id: "c0" });
    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toEqual({
      method: "POST",
      path: "/api/v1/projects/tasks/t1/comments",
      headers: { "x-api-key": "k", "x-audit": "1" },
      body: { note: "n" },
    });
    expect(calls[1][0].body).toEqual({ note: "reply", parent_comment_id: "c0" });
  });

  it("updates, deletes and toggles reactions on a comment", async () => {
    const client = mockClient();
    await updateTaskComment(client, { apiKey: "k", taskId: "t1", commentId: "c1", note: "edited" });
    await deleteTaskComment(client, { apiKey: "k", taskId: "t1", commentId: "c1", auditHeaders: { "x-audit": "d" } });
    await toggleTaskCommentReaction(client, { apiKey: "k", taskId: "t1", commentId: "c1", emoji: "🎉" });
    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toEqual({
      method: "PUT",
      path: "/api/v1/projects/tasks/t1/comments/c1",
      headers: { "x-api-key": "k" },
      body: { note: "edited" },
    });
    expect(calls[1][0]).toEqual({
      method: "DELETE",
      path: "/api/v1/projects/tasks/t1/comments/c1",
      headers: { "x-api-key": "k", "x-audit": "d" },
    });
    expect(calls[2][0]).toEqual({
      method: "POST",
      path: "/api/v1/projects/tasks/t1/comments/c1/reactions",
      headers: { "x-api-key": "k" },
      body: { emoji: "🎉" },
    });
  });
});
