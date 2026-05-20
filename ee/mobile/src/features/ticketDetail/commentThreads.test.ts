import { describe, expect, it } from "vitest";
import {
  buildCommentThreadGroups,
  flattenThreadGroups,
  MAX_VISUAL_DEPTH,
  type BuildCommentThreadGroupsOptions,
} from "./commentThreads";

// Minimal native-comment-like shape (mirrors the relevant TicketComment fields
// without depending on the in-flight tickets.ts edit).
type TestComment = {
  comment_id?: string;
  thread_id?: string | null;
  parent_comment_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  kind?: "comment" | "event";
  event_type?: string | null;
};

function accessors(
  comments: TestComment[],
  newestFirst?: boolean,
): BuildCommentThreadGroupsOptions<TestComment> {
  return {
    comments,
    getCommentId: (c) => c.comment_id,
    getThreadId: (c) => c.thread_id,
    getParentCommentId: (c) => c.parent_comment_id,
    getCreatedAt: (c) => c.created_at,
    newestFirst,
  };
}

function ids<T extends { comment: TestComment }>(nodes: T[]): (string | undefined)[] {
  return nodes.map((n) => n.comment.comment_id);
}

describe("buildCommentThreadGroups", () => {
  it("T011: one group per thread_id, root is the parentless comment", () => {
    const comments: TestComment[] = [
      { comment_id: "r1", thread_id: "t1", parent_comment_id: null, created_at: "2026-05-18T10:00:00Z" },
      { comment_id: "c1", thread_id: "t1", parent_comment_id: "r1", created_at: "2026-05-18T10:05:00Z" },
      { comment_id: "r2", thread_id: "t2", parent_comment_id: null, created_at: "2026-05-18T11:00:00Z" },
    ];

    const groups = buildCommentThreadGroups(accessors(comments));

    expect(groups).toHaveLength(2);
    const t1 = groups.find((g) => g.threadId === "t1")!;
    const t2 = groups.find((g) => g.threadId === "t2")!;
    expect(t1.root.comment_id).toBe("r1");
    expect(t1.comments).toHaveLength(2);
    expect(t2.root.comment_id).toBe("r2");
    expect(t2.comments).toHaveLength(1);
  });

  it("T011: last parentless comment wins as root (mirrors web edge handling)", () => {
    const comments: TestComment[] = [
      { comment_id: "p1", thread_id: "t1", parent_comment_id: null, created_at: "2026-05-18T10:00:00Z" },
      { comment_id: "p2", thread_id: "t1", parent_comment_id: null, created_at: "2026-05-18T10:01:00Z" },
    ];

    const [group] = buildCommentThreadGroups(accessors(comments));
    // chronological order => p1 then p2; the later parentless wins.
    expect(group.root.comment_id).toBe("p2");
  });

  it("T012: childrenByParentId is correct and replies are chronological", () => {
    const comments: TestComment[] = [
      { comment_id: "r1", thread_id: "t1", parent_comment_id: null, created_at: "2026-05-18T10:00:00Z" },
      // Provided out of order; sorted by created_at then comment_id tiebreak.
      { comment_id: "c3", thread_id: "t1", parent_comment_id: "r1", created_at: "2026-05-18T10:30:00Z" },
      { comment_id: "c1", thread_id: "t1", parent_comment_id: "r1", created_at: "2026-05-18T10:10:00Z" },
      { comment_id: "c2", thread_id: "t1", parent_comment_id: "r1", created_at: "2026-05-18T10:20:00Z" },
      { comment_id: "g1", thread_id: "t1", parent_comment_id: "c1", created_at: "2026-05-18T10:15:00Z" },
    ];

    const [group] = buildCommentThreadGroups(accessors(comments));

    expect(group.comments.map((c) => c.comment_id)).toEqual(["r1", "c1", "g1", "c2", "c3"]);
    expect(group.childrenByParentId.get("r1")!.map((c) => c.comment_id)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    expect(group.childrenByParentId.get("c1")!.map((c) => c.comment_id)).toEqual(["g1"]);
    expect(group.childrenByParentId.get("g1")).toEqual([]);
  });

  it("T012: comment_id tiebreak when created_at is identical", () => {
    const comments: TestComment[] = [
      { comment_id: "r1", thread_id: "t1", parent_comment_id: null, created_at: "2026-05-18T10:00:00Z" },
      { comment_id: "b", thread_id: "t1", parent_comment_id: "r1", created_at: "2026-05-18T10:10:00Z" },
      { comment_id: "a", thread_id: "t1", parent_comment_id: "r1", created_at: "2026-05-18T10:10:00Z" },
    ];

    const [group] = buildCommentThreadGroups(accessors(comments));
    expect(group.childrenByParentId.get("r1")!.map((c) => c.comment_id)).toEqual(["a", "b"]);
  });

  it("T013: lastActivityAt = max(created_at), edits do not reorder", () => {
    const comments: TestComment[] = [
      {
        comment_id: "r1",
        thread_id: "t1",
        parent_comment_id: null,
        created_at: "2026-05-18T10:00:00Z",
      },
      {
        comment_id: "c1",
        thread_id: "t1",
        parent_comment_id: "r1",
        created_at: "2026-05-18T10:05:00Z",
        // updated_at is intentionally later than any created_at, but edits
        // must not bump the thread's lastActivityAt.
        updated_at: "2026-05-18T12:00:00Z",
      },
      {
        comment_id: "c2",
        thread_id: "t1",
        parent_comment_id: "r1",
        created_at: "2026-05-18T11:00:00Z",
      },
    ];

    const [group] = buildCommentThreadGroups(accessors(comments));

    expect(group.replyCount).toBe(2);
    expect(group.lastActivityAt).toBe(new Date("2026-05-18T11:00:00Z").getTime());
  });

  it("T014: newestFirst orders an older root w/ newer reply ahead of a more-recent standalone; oldest is inverse; in-thread order unchanged", () => {
    const comments: TestComment[] = [
      // Thread A: old root, but a very recent reply.
      { comment_id: "a_root", thread_id: "tA", parent_comment_id: null, created_at: "2026-05-18T08:00:00Z" },
      { comment_id: "a_reply", thread_id: "tA", parent_comment_id: "a_root", created_at: "2026-05-18T15:00:00Z" },
      // Thread B: a single standalone comment, more recent than A's root but older than A's reply.
      { comment_id: "b_only", thread_id: "tB", parent_comment_id: null, created_at: "2026-05-18T12:00:00Z" },
    ];

    const newest = buildCommentThreadGroups(accessors(comments, true));
    expect(newest.map((g) => g.threadId)).toEqual(["tA", "tB"]);
    // In-thread chronological order is preserved regardless of sort direction.
    expect(newest[0].comments.map((c) => c.comment_id)).toEqual(["a_root", "a_reply"]);

    const oldest = buildCommentThreadGroups(accessors(comments, false));
    expect(oldest.map((g) => g.threadId)).toEqual(["tB", "tA"]);
    expect(oldest[1].comments.map((c) => c.comment_id)).toEqual(["a_root", "a_reply"]);
  });

  it("T018: comments lacking thread_id/parent become singleton groups keyed by comment_id; kind:'event' is a singleton", () => {
    const comments: TestComment[] = [
      { comment_id: "flat1", thread_id: null, parent_comment_id: null, created_at: "2026-05-18T10:00:00Z" },
      { comment_id: "flat2", created_at: "2026-05-18T11:00:00Z" },
      {
        comment_id: "evt1",
        thread_id: null,
        parent_comment_id: null,
        kind: "event",
        event_type: "status_change",
        created_at: "2026-05-18T12:00:00Z",
      },
    ];

    const groups = buildCommentThreadGroups(accessors(comments));

    expect(groups).toHaveLength(3);
    const flat1 = groups.find((g) => g.threadId === "flat1")!;
    const flat2 = groups.find((g) => g.threadId === "flat2")!;
    const evt = groups.find((g) => g.threadId === "evt1")!;
    expect(flat1.comments).toHaveLength(1);
    expect(flat1.root.comment_id).toBe("flat1");
    expect(flat1.replyCount).toBe(0);
    expect(flat2.comments).toHaveLength(1);
    expect(evt.comments).toHaveLength(1);
    expect(evt.root.kind).toBe("event");
    expect(evt.replyCount).toBe(0);
  });

  it("returns an empty array for empty input", () => {
    expect(buildCommentThreadGroups(accessors([]))).toEqual([]);
  });
});

describe("flattenThreadGroups", () => {
  const flattenOpts = { getCommentId: (c: TestComment) => c.comment_id };

  it("T015: emits root then descendants in tree order with correct data depth", () => {
    const comments: TestComment[] = [
      { comment_id: "r1", thread_id: "t1", parent_comment_id: null, created_at: "2026-05-18T10:00:00Z" },
      { comment_id: "c1", thread_id: "t1", parent_comment_id: "r1", created_at: "2026-05-18T10:10:00Z" },
      { comment_id: "g1", thread_id: "t1", parent_comment_id: "c1", created_at: "2026-05-18T10:15:00Z" },
      { comment_id: "c2", thread_id: "t1", parent_comment_id: "r1", created_at: "2026-05-18T10:20:00Z" },
    ];

    const groups = buildCommentThreadGroups(accessors(comments));
    const flat = flattenThreadGroups(groups, flattenOpts);

    expect(ids(flat)).toEqual(["r1", "c1", "g1", "c2"]);
    expect(flat.map((n) => n.depth)).toEqual([0, 1, 2, 1]);
    expect(flat.map((n) => n.isRoot)).toEqual([true, false, false, false]);
  });

  it("T016: clamps visualDepth at 4 for a deep chain while data depth keeps increasing", () => {
    const comments: TestComment[] = [
      { comment_id: "d0", thread_id: "t1", parent_comment_id: null, created_at: "2026-05-18T10:00:00Z" },
      { comment_id: "d1", thread_id: "t1", parent_comment_id: "d0", created_at: "2026-05-18T10:01:00Z" },
      { comment_id: "d2", thread_id: "t1", parent_comment_id: "d1", created_at: "2026-05-18T10:02:00Z" },
      { comment_id: "d3", thread_id: "t1", parent_comment_id: "d2", created_at: "2026-05-18T10:03:00Z" },
      { comment_id: "d4", thread_id: "t1", parent_comment_id: "d3", created_at: "2026-05-18T10:04:00Z" },
      { comment_id: "d5", thread_id: "t1", parent_comment_id: "d4", created_at: "2026-05-18T10:05:00Z" },
      { comment_id: "d6", thread_id: "t1", parent_comment_id: "d5", created_at: "2026-05-18T10:06:00Z" },
    ];

    const groups = buildCommentThreadGroups(accessors(comments));
    const flat = flattenThreadGroups(groups, flattenOpts);

    expect(MAX_VISUAL_DEPTH).toBe(4);
    expect(ids(flat)).toEqual(["d0", "d1", "d2", "d3", "d4", "d5", "d6"]);
    expect(flat.map((n) => n.depth)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(flat.map((n) => n.visualDepth)).toEqual([0, 1, 2, 3, 4, 4, 4]);
  });

  it("T017: a root in collapsedRootIds omits descendants but keeps the root", () => {
    const comments: TestComment[] = [
      { comment_id: "r1", thread_id: "t1", parent_comment_id: null, created_at: "2026-05-18T10:00:00Z" },
      { comment_id: "c1", thread_id: "t1", parent_comment_id: "r1", created_at: "2026-05-18T10:10:00Z" },
      { comment_id: "g1", thread_id: "t1", parent_comment_id: "c1", created_at: "2026-05-18T10:15:00Z" },
      // second, expanded thread to prove only the collapsed thread is pruned
      { comment_id: "r2", thread_id: "t2", parent_comment_id: null, created_at: "2026-05-18T11:00:00Z" },
      { comment_id: "c2", thread_id: "t2", parent_comment_id: "r2", created_at: "2026-05-18T11:10:00Z" },
    ];

    const groups = buildCommentThreadGroups(accessors(comments));
    const flat = flattenThreadGroups(groups, {
      ...flattenOpts,
      collapsedRootIds: new Set(["r1"]),
    });

    expect(ids(flat)).toEqual(["r1", "r2", "c2"]);
    const r1Node = flat.find((n) => n.comment.comment_id === "r1")!;
    expect(r1Node.isRoot).toBe(true);
    expect(r1Node.depth).toBe(0);
  });

  it("returns an empty array when there are no groups", () => {
    expect(flattenThreadGroups([], flattenOpts)).toEqual([]);
  });
});
