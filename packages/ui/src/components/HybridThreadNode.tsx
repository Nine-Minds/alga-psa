'use client';

import React from 'react';
import { ChevronDown, ChevronUp, ExternalLink, MessageCircle } from 'lucide-react';
import { useTranslation } from '../lib/i18n/client';
import type { CommentThreadGroup } from './CommentThreadList';
import './CommentThread.css';

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

interface DefaultThreadBarProps<TComment> {
  children: TComment[];
  visualDepth: number;
  isSubThread: boolean;
  isExpanded: boolean;
  onToggleCollapse: () => void;
  onOpenPanel?: () => void;
}

function DefaultThreadBar<TComment>({
  children,
  visualDepth,
  isSubThread,
  isExpanded,
  onToggleCollapse,
  onOpenPanel,
}: DefaultThreadBarProps<TComment>) {
  const { t } = useTranslation('common');
  const iconProps = { 'aria-hidden': true, focusable: false } as const;
  const replyCount = children.length;
  const repliesLabel = t('commentThread.replies', {
    count: replyCount,
    defaultValue: replyCount === 1 ? `${replyCount} reply` : `${replyCount} replies`,
  });
  const toggleLabel = isExpanded
    ? t('commentThread.collapse', 'Collapse')
    : t('commentThread.expand', 'Expand');
  const showInDrawerLabel = t('commentThread.showInDrawer', 'Show in drawer');
  return (
    <div
      className={[
        'comment-thread-bar',
        `depth-${visualDepth}`,
        isSubThread ? 'comment-thread-bar-subthread' : null,
      ].filter(Boolean).join(' ')}
    >
      <span className="comment-thread-bar-pill comment-thread-bar-count">
        <MessageCircle size={12} strokeWidth={2} {...iconProps} />
        {repliesLabel}
      </span>
      <button
        type="button"
        className="comment-thread-bar-pill comment-thread-bar-pill-button"
        onClick={onToggleCollapse}
      >
        {isExpanded ? (
          <ChevronUp size={12} strokeWidth={2} {...iconProps} />
        ) : (
          <ChevronDown size={12} strokeWidth={2} {...iconProps} />
        )}
        {toggleLabel}
      </button>
      {!isExpanded && onOpenPanel && (
        <button
          type="button"
          className="comment-thread-bar-pill comment-thread-bar-pill-button"
          onClick={onOpenPanel}
        >
          <ExternalLink size={12} strokeWidth={2} {...iconProps} />
          {showInDrawerLabel}
        </button>
      )}
    </div>
  );
}

function defaultThreadBar<TComment>(params: DefaultThreadBarProps<TComment>) {
  return <DefaultThreadBar<TComment> {...params} />;
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
  const children = commentId ? group.childrenByParentId.get(commentId) ?? [] : [];
  const prevChildCountRef = React.useRef(children.length);
  React.useEffect(() => {
    if (children.length > prevChildCountRef.current) {
      setIsExpanded(true);
    }
    prevChildCountRef.current = children.length;
  }, [children.length]);
  if (!commentId) {
    return null;
  }
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
