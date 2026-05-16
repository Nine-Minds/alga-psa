'use client';

import React, { useMemo } from 'react';
import type { PartialBlock } from '@blocknote/core';
import Drawer from './Drawer';
import HybridThreadNode from './HybridThreadNode';
import InlineReplyComposer from './InlineReplyComposer';
import type { CommentThreadGroup } from './CommentThreadList';

export interface CommentThreadDrawerProps<TComment> {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  group: CommentThreadGroup<TComment> | null;
  getCommentId: (comment: TComment) => string | null | undefined;
  renderComment: (comment: TComment, context: {
    depth: number;
    visualDepth: number;
    hasChildren: boolean;
    isSubThread: boolean;
  }) => React.ReactNode;
  replyParentCommentId?: string | null;
  replyRoomName: (parentCommentId: string) => string;
  initialInternal?: boolean;
  showInternalToggle?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  uploadFile?: (file: File, blockId?: string) => Promise<string>;
  searchMentions?: (query: string) => Promise<any[]>;
  onSubmitReply: (params: {
    parentCommentId: string;
    content: PartialBlock[];
    isInternal: boolean;
  }) => Promise<void> | void;
}

export function CommentThreadDrawer<TComment>({
  id = 'comment-thread-drawer',
  isOpen,
  onClose,
  group,
  getCommentId,
  renderComment,
  replyParentCommentId,
  replyRoomName,
  initialInternal = false,
  showInternalToggle = true,
  submitLabel = 'Reply',
  cancelLabel = 'Cancel',
  isSubmitting = false,
  uploadFile,
  searchMentions,
  onSubmitReply,
}: CommentThreadDrawerProps<TComment>): React.ReactElement {
  const rootCommentId = group ? getCommentId(group.root) : null;
  const composerParentId = replyParentCommentId || rootCommentId || '';
  const composerRoomName = useMemo(
    () => composerParentId ? replyRoomName(composerParentId) : `${id}-reply`,
    [composerParentId, id, replyRoomName]
  );

  return (
    <Drawer id={id} isOpen={isOpen} onClose={onClose} width="480px">
      <div className="comment-thread-drawer flex min-h-[calc(100vh-3rem)] flex-col gap-4">
        <div className="comment-thread-drawer-content flex-1">
          {group && rootCommentId && (
            <HybridThreadNode
              group={group}
              comment={group.root}
              getCommentId={getCommentId}
              renderComment={renderComment}
            />
          )}
        </div>
        {composerParentId && (
          <div className="comment-thread-drawer-composer border-t border-gray-200 pt-4">
            <InlineReplyComposer
              id={`${id}-composer`}
              parentCommentId={composerParentId}
              roomName={composerRoomName}
              initialInternal={initialInternal}
              showInternalToggle={showInternalToggle}
              submitLabel={submitLabel}
              cancelLabel={cancelLabel}
              isSubmitting={isSubmitting}
              uploadFile={uploadFile}
              searchMentions={searchMentions}
              onSubmit={onSubmitReply}
              onCancel={onClose}
            />
          </div>
        )}
      </div>
    </Drawer>
  );
}

export default CommentThreadDrawer;
