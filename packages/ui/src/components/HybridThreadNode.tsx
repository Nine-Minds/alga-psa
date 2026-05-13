'use client';

import React from 'react';
import type { CommentThreadGroup } from './CommentThreadList';
import './CommentThread.module.css';

export interface HybridThreadNodeRenderContext {
  depth: number;
  visualDepth: number;
  hasChildren: boolean;
  isSubThread: boolean;
}

export interface HybridThreadNodeProps<TComment> {
  group: CommentThreadGroup<TComment>;
  comment: TComment;
  getCommentId: (comment: TComment) => string | null | undefined;
  renderComment: (comment: TComment, context: HybridThreadNodeRenderContext) => React.ReactNode;
  renderThreadBar?: (params: {
    comment: TComment;
    children: TComment[];
    depth: number;
    visualDepth: number;
    isSubThread: boolean;
    isExpanded: boolean;
    onToggleCollapse: () => void;
    onOpenPanel?: () => void;
  }) => React.ReactNode;
  onOpenPanel?: (commentId: string) => void;
  depth?: number;
}

const MAX_VISUAL_DEPTH = 4;

function defaultThreadBar<TComment>({
  children,
  visualDepth,
  isSubThread,
  isExpanded,
  onToggleCollapse,
  onOpenPanel,
}: {
  children: TComment[];
  visualDepth: number;
  isSubThread: boolean;
  isExpanded: boolean;
  onToggleCollapse: () => void;
  onOpenPanel?: () => void;
}) {
  return (
    <div
      className={[
        'comment-thread-bar',
        `depth-${visualDepth}`,
        isSubThread ? 'comment-thread-bar-subthread' : null,
      ].filter(Boolean).join(' ')}
    >
      <span>{children.length} {children.length === 1 ? 'reply' : 'replies'}</span>
      <button type="button" className="comment-thread-bar-action" onClick={onToggleCollapse}>
        {isExpanded ? 'Collapse' : 'Expand'}
      </button>
      {!isExpanded && onOpenPanel && (
        <button type="button" className="comment-thread-bar-action" onClick={onOpenPanel}>
          Open in drawer
        </button>
      )}
    </div>
  );
}

export function HybridThreadNode<TComment>({
  group,
  comment,
  getCommentId,
  renderComment,
  renderThreadBar = defaultThreadBar,
  onOpenPanel,
  depth = 0,
}: HybridThreadNodeProps<TComment>): React.ReactElement | null {
  const [isExpanded, setIsExpanded] = React.useState(true);
  const commentId = getCommentId(comment);
  if (!commentId) {
    return null;
  }

  const children = group.childrenByParentId.get(commentId) ?? [];
  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH);
  const childVisualDepth = Math.min(depth + 1, MAX_VISUAL_DEPTH);
  const hasChildren = children.length > 0;
  const isSubThread = depth > 0;

  return (
    <div className={['hybrid-thread-node', `depth-${visualDepth}`].join(' ')}>
      {renderComment(comment, {
        depth,
        visualDepth,
        hasChildren,
        isSubThread,
      })}
      {hasChildren && (
        <>
          {renderThreadBar({
            comment,
            children,
            depth,
            visualDepth,
            isSubThread,
            isExpanded,
            onToggleCollapse: () => setIsExpanded((current) => !current),
            onOpenPanel: onOpenPanel ? () => onOpenPanel(commentId) : undefined,
          })}
          {isExpanded && (
            <div
              className={[
                'thread-children',
                `depth-${childVisualDepth}`,
                isSubThread ? 'thread-children-subthread' : null,
              ].filter(Boolean).join(' ')}
            >
              {children.map((child) => {
                const childId = getCommentId(child);
                return (
                  <HybridThreadNode
                    key={childId ?? `${commentId}-${group.comments.indexOf(child)}`}
                    group={group}
                    comment={child}
                    getCommentId={getCommentId}
                    renderComment={renderComment}
                    renderThreadBar={renderThreadBar}
                    onOpenPanel={onOpenPanel}
                    depth={depth + 1}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default HybridThreadNode;
