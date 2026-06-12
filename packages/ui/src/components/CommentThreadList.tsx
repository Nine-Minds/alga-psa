'use client';

import React, { useMemo } from 'react';

export interface CommentThreadGroup<TComment> {
  threadId: string;
  root: TComment;
  comments: TComment[];
  childrenByParentId: Map<string, TComment[]>;
  lastActivityAt: number;
  replyCount: number;
}

export interface CommentThreadListProps<TComment> {
  comments: TComment[];
  getCommentId: (comment: TComment) => string | null | undefined;
  getThreadId: (comment: TComment) => string | null | undefined;
  getParentCommentId: (comment: TComment) => string | null | undefined;
  getCreatedAt: (comment: TComment) => string | Date | null | undefined;
  getThreadLastActivityAt?: (comments: TComment[]) => string | Date | null | undefined;
  newestFirst?: boolean;
  emptyState?: React.ReactNode;
  renderThreadGroup: (group: CommentThreadGroup<TComment>) => React.ReactNode;
}

function toTimestamp(value: string | Date | null | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildCommentThreadGroups<TComment>(
  props: Pick<
    CommentThreadListProps<TComment>,
    | 'comments'
    | 'getCommentId'
    | 'getThreadId'
    | 'getParentCommentId'
    | 'getCreatedAt'
    | 'getThreadLastActivityAt'
    | 'newestFirst'
  >
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

export function CommentThreadList<TComment>({
  comments,
  emptyState = null,
  renderThreadGroup,
  ...groupingProps
}: CommentThreadListProps<TComment>): React.ReactElement | null {
  const groups = useMemo(
    () => buildCommentThreadGroups({ comments, ...groupingProps }),
    [comments, groupingProps]
  );

  if (groups.length === 0) {
    return emptyState ? <>{emptyState}</> : null;
  }

  return <>{groups.map((group) => (
    <React.Fragment key={group.threadId}>{renderThreadGroup(group)}</React.Fragment>
  ))}</>;
}

export default CommentThreadList;
