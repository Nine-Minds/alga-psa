// Framework-agnostic comment threading utilities for the native ticket detail
// screen. Ported from the web `buildCommentThreadGroups`
// (packages/ui/src/components/CommentThreadList.tsx). Pure TypeScript: no
// React / React Native imports so it is unit testable under ee/mobile vitest.

export interface CommentThreadGroup<TComment> {
  threadId: string;
  root: TComment;
  comments: TComment[];
  childrenByParentId: Map<string, TComment[]>;
  lastActivityAt: number;
  replyCount: number;
}

export interface BuildCommentThreadGroupsOptions<TComment> {
  comments: TComment[];
  getCommentId: (comment: TComment) => string | null | undefined;
  getThreadId: (comment: TComment) => string | null | undefined;
  getParentCommentId: (comment: TComment) => string | null | undefined;
  getCreatedAt: (comment: TComment) => string | Date | null | undefined;
  getThreadLastActivityAt?: (comments: TComment[]) => string | Date | null | undefined;
  newestFirst?: boolean;
}

export interface FlattenedThreadNode<TComment> {
  comment: TComment;
  group: CommentThreadGroup<TComment>;
  depth: number;
  visualDepth: number;
  isRoot: boolean;
}

// Visual indent cap. Matches the web app's HybridThreadNode MAX_VISUAL_DEPTH
// (4); data depth is unbounded.
export const MAX_VISUAL_DEPTH = 4;

function toTimestamp(value: string | Date | null | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildCommentThreadGroups<TComment>(
  props: BuildCommentThreadGroupsOptions<TComment>
): CommentThreadGroup<TComment>[] {
  const groupsByThreadId = new Map<string, TComment[]>();

  for (const comment of props.comments) {
    const commentId = props.getCommentId(comment);
    const threadId = props.getThreadId(comment) || commentId;
    if (!threadId) {
      continue;
    }

    const groupComments = groupsByThreadId.get(threadId) ?? [];
    groupComments.push(comment);
    groupsByThreadId.set(threadId, groupComments);
  }

  const groups: CommentThreadGroup<TComment>[] = [];

  for (const [threadId, groupComments] of groupsByThreadId.entries()) {
    const chronologicalComments = [...groupComments].sort((a, b) => {
      const createdDiff = toTimestamp(props.getCreatedAt(a)) - toTimestamp(props.getCreatedAt(b));
      if (createdDiff !== 0) {
        return createdDiff;
      }

      return String(props.getCommentId(a) ?? '').localeCompare(String(props.getCommentId(b) ?? ''));
    });

    const childrenByParentId = new Map<string, TComment[]>();
    let root = chronologicalComments[0];
    let activityTimestamp = toTimestamp(props.getThreadLastActivityAt?.(chronologicalComments));

    for (const comment of chronologicalComments) {
      const commentId = props.getCommentId(comment);
      const parentId = props.getParentCommentId(comment);
      if (!parentId) {
        root = comment;
      } else {
        const children = childrenByParentId.get(parentId) ?? [];
        children.push(comment);
        childrenByParentId.set(parentId, children);
      }

      activityTimestamp = Math.max(
        activityTimestamp,
        toTimestamp(props.getCreatedAt(comment))
      );

      if (commentId && !childrenByParentId.has(commentId)) {
        childrenByParentId.set(commentId, []);
      }
    }

    groups.push({
      threadId,
      root,
      comments: chronologicalComments,
      childrenByParentId,
      lastActivityAt: activityTimestamp,
      replyCount: Math.max(chronologicalComments.length - 1, 0),
    });
  }

  return groups.sort((a, b) =>
    props.newestFirst ? b.lastActivityAt - a.lastActivityAt : a.lastActivityAt - b.lastActivityAt
  );
}

export interface FlattenThreadGroupsOptions<TComment> {
  getCommentId: (comment: TComment) => string | null | undefined;
  collapsedRootIds?: ReadonlySet<string>;
}

export function flattenThreadGroups<TComment>(
  groups: CommentThreadGroup<TComment>[],
  options: FlattenThreadGroupsOptions<TComment>
): FlattenedThreadNode<TComment>[] {
  const { getCommentId, collapsedRootIds } = options;
  const flattened: FlattenedThreadNode<TComment>[] = [];

  for (const group of groups) {
    const rootId = getCommentId(group.root);
    const rootIdKey = rootId == null ? group.threadId : rootId;

    flattened.push({
      comment: group.root,
      group,
      depth: 0,
      visualDepth: 0,
      isRoot: true,
    });

    if (collapsedRootIds?.has(rootIdKey)) {
      continue;
    }

    const walk = (parentId: string | null | undefined, depth: number): void => {
      if (parentId == null) {
        return;
      }
      const children = group.childrenByParentId.get(parentId) ?? [];
      for (const child of children) {
        flattened.push({
          comment: child,
          group,
          depth,
          visualDepth: Math.min(depth, MAX_VISUAL_DEPTH),
          isRoot: false,
        });
        walk(getCommentId(child), depth + 1);
      }
    };

    walk(rootId, 1);
  }

  return flattened;
}
