import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import type { ApiClient } from "../../../api";
import type { TicketComment } from "../../../api/tickets";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  updateTicketStatus: vi.fn(),
  getSecureJson: vi.fn(),
  setSecureJson: vi.fn(),
  deleteItem: vi.fn(),
  invalidate: vi.fn(),
  operationalOnly: false,
}));

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));
vi.mock("../../../cache/ticketsCache", () => ({
  invalidateTicketsListCache: mocks.invalidate,
}));
vi.mock("../../../api/tickets", () => ({
  updateTicketStatus: mocks.updateTicketStatus,
}));
vi.mock("../../comments/commentTarget", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../comments/commentTarget")>();
  return { ...original, createCommentApi: () => ({ add: mocks.add }) };
});
vi.mock("../../../storage/secureStorage", () => ({
  getSecureJson: mocks.getSecureJson,
  setSecureJson: mocks.setSecureJson,
  secureStorage: { deleteItem: mocks.deleteItem },
}));
vi.mock("../../../capabilities/CapabilitiesContext", () => ({
  useOperationalOnly: () => mocks.operationalOnly,
}));

import { useCommentDraft } from "./useCommentDraft";
import { taskTarget } from "../../comments/commentTarget";
import { MAX_COMMENT_LENGTH } from "../types";

const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = { accessToken: "tok-1", user: { id: "u1", name: "Tech One" } };
const DRAFT_KEY = "alga.mobile.ticketDraft.u1.t-1";
const VIS_KEY = "alga.mobile.ticketComment.visibility.u1";

type HookReturn = ReturnType<typeof useCommentDraft>;

async function renderDraftHook(opts?: {
  client?: ApiClient | null;
  session?: any;
  isOffline?: boolean;
  target?: ReturnType<typeof taskTarget>;
  initialComments?: TicketComment[];
}) {
  const showToast = vi.fn();
  const fetchTicket = vi.fn().mockResolvedValue(undefined);
  const fetchComments = vi.fn().mockResolvedValue(undefined);
  const t = (key: string) => key;
  const latest: { current: HookReturn; comments: TicketComment[] } = {
    current: undefined as unknown as HookReturn,
    comments: opts?.initialComments ?? [],
  };

  function Wrapper() {
    const [comments, setComments] = React.useState<TicketComment[]>(opts?.initialComments ?? []);
    latest.comments = comments;
    latest.current = useCommentDraft({
      client: opts?.client !== undefined ? opts.client : fakeClient,
      session: opts?.session !== undefined ? opts.session : (fakeSession as any),
      ticketId: "t-1",
      showToast,
      t,
      isOffline: opts?.isOffline ?? false,
      fetchTicket,
      fetchComments,
      setComments,
      target: opts?.target,
    });
    return null;
  }

  await act(async () => {
    create(React.createElement(Wrapper));
  });

  return {
    get result() {
      return latest.current;
    },
    get comments() {
      return latest.comments;
    },
    showToast,
    fetchTicket,
    fetchComments,
  };
}

const okAdd = (data: Partial<TicketComment> = {}) => ({
  ok: true,
  status: 201,
  data: { data: { comment_id: "c-new", comment_text: "hello", ...data } },
});

async function typeDraft(h: { result: HookReturn }, text: string) {
  await act(async () => {
    h.result.setCommentDraft(text);
    h.result.setCommentDraftPlainText(text);
  });
}

describe("useCommentDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operationalOnly = false;
    mocks.getSecureJson.mockResolvedValue(null);
    mocks.setSecureJson.mockResolvedValue(undefined);
    mocks.deleteItem.mockResolvedValue(undefined);
    mocks.updateTicketStatus.mockResolvedValue({ ok: true });
  });

  describe("draft persistence", () => {
    it("restores a saved draft and its visibility", async () => {
      mocks.getSecureJson.mockImplementation(async (key: string) =>
        key === DRAFT_KEY ? { text: "Saved words", isInternal: false } : null,
      );
      const h = await renderDraftHook();
      expect(h.result.draftLoaded).toBe(true);
      expect(h.result.commentDraft).toBe("Saved words");
      expect(h.result.commentDraftPlainText).toBe("Saved words");
      expect(h.result.commentIsInternal).toBe(false);
    });

    it("extracts plain text from a saved rich-text draft", async () => {
      const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rich" }] }] };
      mocks.getSecureJson.mockImplementation(async (key: string) =>
        key === DRAFT_KEY ? { text: JSON.stringify(doc), isInternal: true } : null,
      );
      const h = await renderDraftHook();
      expect(h.result.commentDraftPlainText).toBe("Rich");
    });

    it("falls back to the stored visibility preference when there is no draft", async () => {
      mocks.getSecureJson.mockImplementation(async (key: string) => (key === VIS_KEY ? false : null));
      const h = await renderDraftHook();
      expect(h.result.commentDraft).toBe("");
      expect(h.result.commentIsInternal).toBe(false);
    });

    it("defaults to internal when nothing is stored, and keys by anonymous without a user", async () => {
      const h = await renderDraftHook({ session: { accessToken: "tok-1" } });
      expect(h.result.commentIsInternal).toBe(true);
      expect(mocks.getSecureJson).toHaveBeenCalledWith("alga.mobile.ticketDraft.anonymous.t-1");
      expect(mocks.getSecureJson).toHaveBeenCalledWith("alga.mobile.ticketComment.visibility.anonymous");
    });

    it("persists the draft and visibility preference as they change", async () => {
      const h = await renderDraftHook();
      mocks.setSecureJson.mockClear();
      await act(async () => {
        h.result.setCommentDraft("typing");
        h.result.setCommentIsInternal(false);
      });
      expect(mocks.setSecureJson).toHaveBeenCalledWith(DRAFT_KEY, { text: "typing", isInternal: false });
      expect(mocks.setSecureJson).toHaveBeenCalledWith(VIS_KEY, false);
    });

    it("does not overwrite the ticket visibility preference from a task thread", async () => {
      await renderDraftHook({ target: taskTarget("task-9") });
      expect(mocks.getSecureJson).toHaveBeenCalledWith("alga.mobile.taskDraft.u1.task-9");
      const keys = mocks.setSecureJson.mock.calls.map((c) => c[0]);
      expect(keys).toContain("alga.mobile.taskDraft.u1.task-9");
      expect(keys).not.toContain(VIS_KEY);
    });
  });

  describe("sendComment", () => {
    it("is a no-op without a client", async () => {
      const h = await renderDraftHook({ client: null });
      await typeDraft(h, "hi");
      await act(async () => {
        await h.result.sendComment();
      });
      expect(mocks.add).not.toHaveBeenCalled();
    });

    it("rejects an empty comment", async () => {
      const h = await renderDraftHook();
      await typeDraft(h, "   ");
      await act(async () => {
        await h.result.sendComment();
      });
      expect(h.result.commentSendError).toBe("comments.errors.empty");
      expect(mocks.add).not.toHaveBeenCalled();
    });

    it("rejects a comment over the length limit", async () => {
      const h = await renderDraftHook();
      await typeDraft(h, "x".repeat(MAX_COMMENT_LENGTH + 1));
      await act(async () => {
        await h.result.sendComment();
      });
      expect(h.result.commentSendError).toBe("comments.errors.tooLong");
      expect(mocks.add).not.toHaveBeenCalled();
    });

    it("keeps the draft when offline", async () => {
      const h = await renderDraftHook({ isOffline: true });
      await typeDraft(h, "later");
      await act(async () => {
        await h.result.sendComment();
      });
      expect(h.result.commentSendError).toBe("comments.errors.offlineSaved");
      expect(h.result.commentDraft).toBe("later");
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.offlineToast", tone: "info" });
      expect(mocks.add).not.toHaveBeenCalled();
    });

    it("sends an internal note, reconciles the optimistic comment and clears the draft", async () => {
      mocks.add.mockResolvedValueOnce(okAdd({ comment_text: "hello", created_by_name: undefined }));
      const h = await renderDraftHook();
      await typeDraft(h, "  hello  ");
      await act(async () => {
        await h.result.sendComment();
      });
      expect(mocks.add).toHaveBeenCalledWith(fakeClient, {
        apiKey: "tok-1",
        comment_text: "hello",
        is_internal: true,
        is_resolution: false,
        auditHeaders: { "x-device": "test" },
      });
      expect(h.comments).toHaveLength(1);
      expect(h.comments[0]).toMatchObject({ comment_id: "c-new", optimistic: false, created_by_name: "Tech One" });
      expect(h.result.commentDraft).toBe("");
      expect(h.result.commentSending).toBe(false);
      expect(mocks.deleteItem).toHaveBeenCalledWith(DRAFT_KEY);
      expect(mocks.invalidate).toHaveBeenCalled();
      expect(h.fetchTicket).toHaveBeenCalled();
      expect(h.fetchComments).toHaveBeenCalled();
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.commentSent", tone: "success" });
    });

    it("uses the rich editor's JSON when the editor is mounted", async () => {
      mocks.add.mockResolvedValueOnce(okAdd());
      const h = await renderDraftHook();
      const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "From editor" }] }] };
      (h.result.commentEditorRef as { current: unknown }).current = { getJSON: vi.fn().mockResolvedValue(doc) };
      await act(async () => {
        await h.result.sendComment();
      });
      expect(mocks.add.mock.calls[0][1].comment_text).toBe(JSON.stringify(doc));
    });

    it("sends a public comment with cc/bcc and a schedule, then resets the one-off fields", async () => {
      mocks.add.mockResolvedValueOnce(okAdd());
      const when = new Date("2026-12-01T09:00:00.000Z");
      const h = await renderDraftHook();
      await typeDraft(h, "public reply");
      await act(async () => {
        h.result.setCommentIsInternal(false);
        h.result.setCommentCc(["cc@example.com"]);
        h.result.setCommentBcc(["bcc@example.com"]);
        h.result.setCommentScheduleAt(when);
      });
      await act(async () => {
        await h.result.sendComment();
      });
      const params = mocks.add.mock.calls[0][1];
      expect(params).toMatchObject({
        is_internal: false,
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"],
        scheduled_publish_at: when.toISOString(),
      });
      expect(typeof params.scheduled_publish_tz).toBe("string");
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.commentScheduled", tone: "success" });
      expect(h.result.commentCc).toEqual([]);
      expect(h.result.commentBcc).toEqual([]);
      expect(h.result.commentScheduleAt).toBeNull();
    });

    it("never sends cc/bcc or a schedule with an internal note", async () => {
      mocks.add.mockResolvedValueOnce(okAdd());
      const h = await renderDraftHook();
      await typeDraft(h, "note");
      await act(async () => {
        h.result.setCommentCc(["cc@example.com"]);
        h.result.setCommentScheduleAt(new Date("2026-12-01T09:00:00.000Z"));
      });
      await act(async () => {
        await h.result.sendComment();
      });
      const params = mocks.add.mock.calls[0][1];
      expect(params.cc).toBeUndefined();
      expect(params.scheduled_publish_at).toBeUndefined();
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.commentSent", tone: "success" });
    });

    it("marks an operational-only seat's internal note as shared IT", async () => {
      mocks.operationalOnly = true;
      mocks.add.mockResolvedValueOnce(okAdd());
      const h = await renderDraftHook();
      await typeDraft(h, "note");
      await act(async () => {
        await h.result.sendComment();
      });
      expect(mocks.add.mock.calls[0][1].collaboration_audience).toBe("shared_it");
    });

    it("closes the ticket after a resolution comment with a close status", async () => {
      mocks.add.mockResolvedValueOnce(okAdd());
      const h = await renderDraftHook();
      await typeDraft(h, "fixed it");
      await act(async () => {
        h.result.setCommentIsResolution(true);
        h.result.setCommentCloseStatusId("s-closed");
      });
      await act(async () => {
        await h.result.sendComment({ suppressContactNotifications: true, suppressInternalNotifications: false });
      });
      expect(mocks.add.mock.calls[0][1].is_resolution).toBe(true);
      expect(mocks.updateTicketStatus).toHaveBeenCalledWith(fakeClient, {
        apiKey: "tok-1",
        ticketId: "t-1",
        status_id: "s-closed",
        auditHeaders: { "x-device": "test" },
        notificationSuppression: { suppressContactNotifications: true, suppressInternalNotifications: false },
      });
      expect(h.result.commentIsResolution).toBe(false);
      expect(h.result.commentCloseStatusId).toBeNull();
    });

    it("still reports success when the close-status update rejects", async () => {
      mocks.add.mockResolvedValueOnce(okAdd());
      mocks.updateTicketStatus.mockRejectedValueOnce(new Error("boom"));
      const h = await renderDraftHook();
      await typeDraft(h, "fixed it");
      await act(async () => {
        h.result.setCommentIsResolution(true);
        h.result.setCommentCloseStatusId("s-closed");
      });
      await act(async () => {
        await h.result.sendComment();
      });
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.commentSent", tone: "success" });
    });

    it.each([
      ["permission", { kind: "permission" }, "comments.errors.permission"],
      ["validation with message", { kind: "validation", body: { error: { message: "Too spicy" } } }, "Too spicy"],
      ["validation without message", { kind: "validation", body: {} }, "comments.errors.validation"],
      ["server", { kind: "server" }, "comments.errors.generic"],
    ])("on a %s failure removes the optimistic comment and restores the draft", async (_l, error, expected) => {
      mocks.add.mockResolvedValueOnce({ ok: false, status: 400, error });
      const h = await renderDraftHook();
      await typeDraft(h, "my words");
      await act(async () => {
        h.result.setCommentIsInternal(false);
        h.result.setCommentCc(["cc@example.com"]);
      });
      await act(async () => {
        await h.result.sendComment();
      });
      expect(h.comments).toEqual([]);
      expect(h.result.commentDraft).toBe("my words");
      expect(h.result.commentDraftPlainText).toBe("my words");
      expect(h.result.commentIsInternal).toBe(false);
      expect(h.result.commentSendError).toBe(expected);
      expect(h.result.commentCc).toEqual(["cc@example.com"]);
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.commentNotSent", tone: "error" });
      expect(mocks.deleteItem).not.toHaveBeenCalled();
    });
  });

  describe("submitCommentPayload", () => {
    it("ignores a second send while one is in flight", async () => {
      let resolve!: (v: unknown) => void;
      mocks.add.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const h = await renderDraftHook();
      const payload = {
        serializedDraft: "a",
        text: "a",
        originalDraft: "a",
        originalDraftPlainText: "a",
        originalIsInternal: true,
      };
      let first!: Promise<boolean>;
      await act(async () => {
        first = h.result.submitCommentPayload(payload);
        await Promise.resolve();
      });
      expect(h.result.commentSending).toBe(true);
      expect(h.comments[0]).toMatchObject({ optimistic: true, comment_text: "a" });
      let second!: boolean;
      await act(async () => {
        second = await h.result.submitCommentPayload(payload);
      });
      expect(second).toBe(false);
      await act(async () => {
        resolve(okAdd());
        await first;
      });
      expect(await first).toBe(true);
      expect(mocks.add).toHaveBeenCalledTimes(1);
    });

    it("always sends task comments as internal and does not touch the tickets list cache", async () => {
      mocks.add.mockResolvedValueOnce(okAdd());
      const h = await renderDraftHook({ target: taskTarget("task-9") });
      let ok!: boolean;
      await act(async () => {
        ok = await h.result.submitCommentPayload({
          serializedDraft: "x",
          text: "x",
          originalDraft: "x",
          originalDraftPlainText: "x",
          originalIsInternal: false,
          cc: ["a@b.c"],
        });
      });
      expect(ok).toBe(true);
      expect(mocks.add.mock.calls[0][1].is_internal).toBe(true);
      expect(mocks.add.mock.calls[0][1].cc).toBeUndefined();
      expect(mocks.invalidate).not.toHaveBeenCalled();
    });
  });

  describe("submitReply", () => {
    const parent: TicketComment = { comment_id: "p1", comment_text: "parent", thread_id: "th-1" } as TicketComment;

    it("returns false for empty, overlong, missing session and offline replies", async () => {
      const h = await renderDraftHook({ isOffline: true, initialComments: [parent] });
      const call = (text: string) => h.result.submitReply({ parentCommentId: "p1", serializedDraft: text, text });
      await act(async () => {
        expect(await call("  ")).toBe(false);
        expect(await call("x".repeat(MAX_COMMENT_LENGTH + 1))).toBe(false);
        expect(await call("hi")).toBe(false);
      });
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.offlineToast", tone: "info" });
      expect(mocks.add).not.toHaveBeenCalled();

      const noSession = await renderDraftHook({ session: null });
      await act(async () => {
        expect(await noSession.result.submitReply({ parentCommentId: "p1", serializedDraft: "a", text: "a" })).toBe(false);
      });
    });

    it("posts a reply under the parent thread and reconciles it", async () => {
      mocks.add.mockResolvedValueOnce(okAdd({ comment_id: "r1", comment_text: "reply", parent_comment_id: undefined, thread_id: undefined }));
      const h = await renderDraftHook({ initialComments: [parent] });
      let ok!: boolean;
      await act(async () => {
        ok = await h.result.submitReply({ parentCommentId: "p1", serializedDraft: "reply", text: "reply" });
      });
      expect(ok).toBe(true);
      expect(mocks.add).toHaveBeenCalledWith(fakeClient, {
        apiKey: "tok-1",
        comment_text: "reply",
        is_internal: false,
        parent_comment_id: "p1",
        auditHeaders: { "x-device": "test" },
      });
      expect(h.comments[1]).toMatchObject({
        comment_id: "r1",
        parent_comment_id: "p1",
        thread_id: "th-1",
        optimistic: false,
      });
      expect(mocks.invalidate).toHaveBeenCalled();
      expect(h.fetchComments).toHaveBeenCalled();
      expect(h.fetchTicket).not.toHaveBeenCalled();
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.commentSent", tone: "success" });
    });

    it.each([
      ["permission", { kind: "permission" }, "comments.errors.permission"],
      ["validation", { kind: "validation", body: { error: { message: "Nope" } } }, "Nope"],
      ["validation fallback", { kind: "validation", body: null }, "comments.errors.validation"],
      ["other", { kind: "network" }, "comments.errors.generic"],
    ])("drops the optimistic reply on a %s failure", async (_l, error, expected) => {
      mocks.add.mockResolvedValueOnce({ ok: false, error });
      const h = await renderDraftHook({ initialComments: [parent] });
      let ok!: boolean;
      await act(async () => {
        ok = await h.result.submitReply({ parentCommentId: "p1", serializedDraft: "r", text: "r" });
      });
      expect(ok).toBe(false);
      expect(h.comments).toEqual([parent]);
      expect(h.result.commentSendError).toBe(expected);
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.commentNotSent", tone: "error" });
    });

    it("drops the optimistic reply when the request throws", async () => {
      mocks.add.mockRejectedValueOnce(new Error("socket"));
      const h = await renderDraftHook({ target: taskTarget("task-9"), initialComments: [parent] });
      let ok!: boolean;
      await act(async () => {
        ok = await h.result.submitReply({ parentCommentId: "missing", serializedDraft: "r", text: "r" });
      });
      expect(ok).toBe(false);
      expect(h.comments).toEqual([parent]);
      expect(h.showToast).toHaveBeenCalledWith({ message: "comments.commentNotSent", tone: "error" });
    });
  });

  it("exposes a page size for the visible comments", async () => {
    const h = await renderDraftHook();
    expect(h.result.commentsVisibleCount).toBe(20);
    await act(async () => h.result.setCommentsVisibleCount(40));
    expect(h.result.commentsVisibleCount).toBe(40);
  });
});
