'use client';

import React, { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { PartialBlock } from '@blocknote/core';
import { Activity, AlertTriangle, ArrowDownUp, CheckCircle, Clock, Lock, MessageSquare } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import RichTextEditorSkeleton from '@alga-psa/ui/components/skeletons/RichTextEditorSkeleton';
import { buildCommentThreadGroups, HybridThreadNode, type CommentThreadGroup } from '@alga-psa/ui/components';
import InlineReplyComposer from '@alga-psa/ui/components/InlineReplyComposer';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { searchUsersForMentions } from '@alga-psa/user-composition/actions';
import type { IAggregatedReaction, IComment } from '@alga-psa/types';
import CommentItem from '../CommentItem';
import { DEFAULT_BLOCK } from '../TicketConversation';
import { useTicketRichTextUploadSession } from '../useTicketRichTextUploadSession';
import type { TicketTimelineEntry } from '@alga-psa/shared/lib/ticketActivity';
import { getTicketTimelineEntries } from '../../../actions/ticketActivityActions';
import { setTicketLayoutPreference } from '../../../actions/ticketLayoutPreference';
import {
  toggleCommentReaction,
  getCommentsReactionsBatch,
} from '../../../actions/comment-actions/commentReactionActions';
import type { CommentUserAuthor, CommentContactAuthor } from '../../../lib/commentAuthorResolution';
import type { TicketReactionsBootstrap } from '../../../lib/ticketScreenBootstrap';
import { filterHiddenNoiseComments } from '../../../lib/commentNoise';
import { BentoTile, BentoTileEmpty } from '@alga-psa/ui/components/bento/BentoTile';

const TextEditor = dynamic(() => import('@alga-psa/ui/editor').then((mod) => mod.TextEditor), {
  loading: () => <RichTextEditorSkeleton height="120px" />,
  ssr: false,
});

import {
  laneForEntryType,
  sortTimelineNodes,
  laneCounts,
  filterByLane,
  dayLabel,
  type Lane,
  type LaneFilter,
} from './timelineHelpers';

interface TimelineNode {
  key: string;
  lane: Lane;
  occurredAt: string;
  sortId: string;
  comment?: IComment;
  entry?: TicketTimelineEntry;
}

interface BentoTimelineTileProps {
  id: string;
  ticketId: string;
  conversations: IComment[];
  userMap: Record<string, CommentUserAuthor>;
  contactMap: Record<string, CommentContactAuthor>;
  contactFirstName?: string | null;
  ticketCreatedAt?: string | null;
  /** Bumped by the parent whenever a save/comment lands so the stream refetches. */
  refreshKey?: number | string;
  initialOrder?: 'asc' | 'desc';
  // Composer plumbing — same pipeline TicketConversation uses.
  editorKey: number;
  isSubmitting?: boolean;
  onNewCommentContentChange: (content: PartialBlock[]) => void;
  onAddNewComment: (isInternal: boolean, isResolution: boolean) => Promise<boolean>;
  /** Threaded reply pipeline (same handler the conversation view gets). */
  onAddReplyComment?: (content: PartialBlock[], parentCommentId: string, isInternal: boolean) => Promise<boolean>;
  /** Server-started non-comment timeline entries; resolved via use() so the tile suspends into its skeleton. */
  initialEntries?: Promise<TicketTimelineEntry[]>;
  /** Server-started reactions batch (decoration; resolved in an effect, never suspends). */
  initialReactions?: Promise<TicketReactionsBootstrap>;
  // Comment affordances (reactions, edit, delete) — same handlers the
  // conversation view receives from TicketDetails.
  currentUser?: { id: string; name: string; email?: string } | null;
  isEditing: boolean;
  currentComment: IComment | null;
  onContentChange: (content: PartialBlock[]) => void;
  onSaveComment: (updates: Partial<IComment>) => void;
  onCloseEdit: () => void;
  onEditComment: (comment: IComment) => void;
  onDeleteComment: (comment: IComment) => void;
  reactionRefreshVersion?: number;
  canViewCommentMetadataDebug?: boolean;
  onClipboardImageUploaded?: () => void;
  uploadTicketAttachmentAction?: (
    formData: FormData,
    params: { userId: string; ticketId: string }
  ) => Promise<any>;
  deleteDraftTicketAttachmentImagesAction?: (input: {
    ticketId: string;
    documentIds: string[];
  }) => Promise<{ deletedDocumentIds: string[]; failures: Array<{ documentId: string; reason: string }> }>;
  resolveTicketAttachmentViewUrl?: (document: { document_id?: string; file_id?: string }) => string;
  className?: string;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

type Translator = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

// English defaults for the curated ticket fields the activity log can change,
// keyed by the field name after stripping a trailing `_id`. Unknown fields fall
// back to a humanized version of the raw token so nothing ever breaks.
const TIMELINE_FIELD_LABELS: Record<string, string> = {
  title: 'title',
  status: 'status',
  priority: 'priority',
  assigned_to: 'assignee',
  assigned_team: 'team',
  board: 'board',
  category: 'category',
  subcategory: 'subcategory',
  client: 'client',
  contact_name: 'contact',
  contact: 'contact',
  due_date: 'due date',
  response_state: 'response state',
  closed_at: 'closed date',
  closed_by: 'closed by',
  url: 'URL',
};

// English defaults for the TICKET_* activity event types, keyed by the name
// after stripping the `TICKET_` prefix and lowercasing.
const TIMELINE_EVENT_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  status_changed: 'status changed',
  closed: 'closed',
  reopened: 'reopened',
  priority_changed: 'priority changed',
  assigned: 'assigned',
  unassigned: 'unassigned',
  board_moved: 'board moved',
  response_state_changed: 'response state changed',
  comment_added: 'comment added',
  comment_updated: 'comment updated',
  internal_note_added: 'internal note added',
  customer_replied: 'customer replied',
  message_added: 'message added',
  document_attached: 'document attached',
  document_removed: 'document removed',
  inbound_email_received: 'inbound email received',
  bundle_reopened: 'bundle reopened',
  checklist_item_completed: 'checklist item completed',
  checklist_item_uncompleted: 'checklist item uncompleted',
  checklist_template_applied: 'checklist template applied',
  close_rules_overridden: 'close rules overridden',
  close_rules_bypassed: 'close rules bypassed',
  auto_close_warning_sent: 'auto-close warning sent',
};

/** Localized label for a changed ticket field; humanizes unknown tokens. */
function fieldLabel(field: string, t: Translator): string {
  const normalized = field.replace(/_id$/, '');
  const known = TIMELINE_FIELD_LABELS[normalized];
  if (known) return t(`bento.timeline.field.${normalized}`, known);
  return normalized.replace(/_/g, ' ');
}

/** Localized label for a TICKET_* event type; humanizes unknown tokens. */
function eventLabel(eventType: string, t: Translator): string {
  const normalized = eventType.replace(/^TICKET_/, '').toLowerCase();
  const known = TIMELINE_EVENT_LABELS[normalized];
  if (known) return t(`bento.timeline.event.${normalized}`, known);
  return normalized.replace(/_/g, ' ');
}

/** Compact one-line description of a system (activity) entry. */
function describeSystemEntry(entry: TicketTimelineEntry, t: Translator): string {
  const activity = entry.activity;
  if (!activity) return t('bento.timeline.ticketUpdated', 'Ticket updated');
  const actor = activity.actor_display_name || t('bento.timeline.systemActor', 'System');
  const changes = activity.changes ?? {};
  const changeLines = Object.entries(changes).map(([field, change]) => {
    const from = change?.oldLabel ?? null;
    const to = change?.newLabel ?? null;
    const fieldName = fieldLabel(field, t);
    if (to != null) {
      return from != null
        ? t('bento.timeline.fieldChanged', '{{actor}} changed {{field}}: {{from}} → {{to}}', { actor, field: fieldName, from, to })
        : t('bento.timeline.fieldSet', '{{field}} set to {{to}}', { field: fieldName, to });
    }
    return t('bento.timeline.fieldCleared', 'cleared {{field}}', { field: fieldName });
  });
  const eventName = eventLabel(activity.event_type, t);
  return changeLines.length > 0
    ? changeLines.join(', ')
    : t('bento.timeline.actorEvent', '{{actor}} · {{eventName}}', { actor, eventName });
}

/** Lane border-color classes for a comment (client / internal / resolution). */
function commentAccentClasses(comment: IComment | undefined): string {
  if (!comment) return '';
  if (comment.is_resolution) return 'border-green-400 dark:border-green-500/50';
  if (comment.is_internal) return 'border-amber-400 dark:border-amber-500/50';
  return 'border-[rgb(var(--color-secondary-400))]';
}

/**
 * Per-entry spine pin + lane accent. The pin (a small ringed circle on the
 * timeline spine) carries the lane colour and icon; `accent` is border-color
 * classes passed into the comment card so its full border tints to the lane.
 */
function laneVisual(node: TimelineNode): { pin: string; icon: React.ReactNode; accent: string } {
  const iconCls = 'h-3 w-3';
  if (node.lane === 'reply') {
    const comment = node.comment;
    const accent = commentAccentClasses(comment);
    if (comment?.is_resolution) {
      return {
        pin: 'bg-green-50 dark:bg-green-500/15 ring-green-200 dark:ring-green-500/40 text-green-600 dark:text-green-400',
        icon: <CheckCircle className={iconCls} />,
        accent,
      };
    }
    if (comment?.is_internal) {
      return {
        pin: 'bg-amber-50 dark:bg-amber-500/15 ring-amber-200 dark:ring-amber-500/40 text-amber-600 dark:text-amber-400',
        icon: <Lock className={iconCls} />,
        accent,
      };
    }
    return {
      pin: 'bg-[rgb(var(--color-secondary-50))] dark:bg-[rgb(var(--color-secondary-400)/0.15)] ring-[rgb(var(--color-secondary-200))] dark:ring-[rgb(var(--color-secondary-400)/0.4)] text-[rgb(var(--color-secondary-600))] dark:text-[rgb(var(--color-secondary-300))]',
      icon: <MessageSquare className={iconCls} />,
      accent,
    };
  }
  if (node.lane === 'time') {
    return {
      pin: 'bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-400)/0.15)] ring-[rgb(var(--color-primary-200))] dark:ring-[rgb(var(--color-primary-400)/0.4)] text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))]',
      icon: <Clock className={iconCls} />,
      accent: '',
    };
  }
  if (node.lane === 'alert') {
    return {
      pin: 'bg-red-50 dark:bg-red-500/15 ring-red-200 dark:ring-red-500/40 text-red-600 dark:text-red-400',
      icon: <AlertTriangle className={iconCls} />,
      accent: '',
    };
  }
  return {
    pin: 'bg-[rgb(var(--color-border-100))] ring-[rgb(var(--color-border-200))] text-[rgb(var(--color-text-400))]',
    icon: <Activity className={iconCls} />,
    accent: '',
  };
}

export function BentoTimelineTile({
  id,
  ticketId,
  conversations,
  userMap,
  contactMap,
  contactFirstName,
  ticketCreatedAt,
  refreshKey = 0,
  initialOrder = 'asc',
  editorKey,
  isSubmitting,
  onNewCommentContentChange,
  onAddNewComment,
  onAddReplyComment,
  initialEntries,
  initialReactions,
  currentUser,
  isEditing,
  currentComment,
  onContentChange,
  onSaveComment,
  onCloseEdit,
  onEditComment,
  onDeleteComment,
  reactionRefreshVersion = 0,
  canViewCommentMetadataDebug,
  onClipboardImageUploaded,
  uploadTicketAttachmentAction,
  deleteDraftTicketAttachmentImagesAction,
  resolveTicketAttachmentViewUrl,
  className,
}: BentoTimelineTileProps) {
  const { t } = useTranslation('features/tickets');
  const laneFilters = useMemo<{ value: LaneFilter; label: string }[]>(
    () => [
      { value: 'everything', label: t('bento.timeline.filterEverything', 'Everything') },
      { value: 'reply', label: t('bento.timeline.filterReplies', 'Replies') },
      { value: 'time', label: t('bento.timeline.filterTime', 'Time') },
      { value: 'system', label: t('bento.timeline.filterSystem', 'System') },
      { value: 'alert', label: t('bento.timeline.filterAlerts', 'Alerts') },
    ],
    [t],
  );
  // Server-started entries resolve via use(): first paint streams in behind
  // the tile's <Suspense> skeleton with no client request.
  const initialSystemEntries = initialEntries ? use(initialEntries) : null;
  const [systemEntries, setSystemEntries] = useState<TicketTimelineEntry[]>(initialSystemEntries ?? []);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const skipFirstEntriesFetch = useRef(Boolean(initialEntries));
  const skipFirstReactionsFetch = useRef(Boolean(initialReactions));
  const [filter, setFilter] = useState<LaneFilter>('everything');
  const [order, setOrder] = useState<'asc' | 'desc'>(initialOrder);
  const [composerLane, setComposerLane] = useState<'client' | 'internal' | 'resolution'>('client');
  const [hasDraft, setHasDraft] = useState(false);
  const [reactionsMap, setReactionsMap] = useState<Record<string, IAggregatedReaction[]>>({});
  const [reactionUserNames, setReactionUserNames] = useState<Record<string, string>>({});
  // Threading: which comment currently has its inline reply composer open.
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null);

  const { deleteDocument } = useDocumentsCrossFeature();
  const composeUploadSession = useTicketRichTextUploadSession({
    componentLabel: 'BentoTimelineTile-compose',
    ticketId,
    userId: currentUser?.id,
    trackDraftUploads: true,
    onDocumentsChanged: onClipboardImageUploaded,
    onDiscard: () => setHasDraft(false),
    uploadDocumentAction: uploadTicketAttachmentAction,
    deleteDraftClipboardImagesAction: deleteDraftTicketAttachmentImagesAction,
    resolveDocumentViewUrl: resolveTicketAttachmentViewUrl,
    deleteDocumentFn: deleteDocument,
  });
  const editUploadSession = useTicketRichTextUploadSession({
    componentLabel: 'BentoTimelineTile',
    ticketId,
    userId: currentUser?.id,
    trackDraftUploads: false,
    onDocumentsChanged: onClipboardImageUploaded,
    onDiscard: onCloseEdit,
    uploadDocumentAction: uploadTicketAttachmentAction,
    deleteDraftClipboardImagesAction: deleteDraftTicketAttachmentImagesAction,
    resolveDocumentViewUrl: resolveTicketAttachmentViewUrl,
    deleteDocumentFn: deleteDocument,
  });

  // Reactions for all visible comments (same pattern as the conversation view).
  const commentIdsKey = useMemo(
    () => conversations.map((comment) => comment.comment_id).filter(Boolean).sort().join(','),
    [conversations],
  );
  useEffect(() => {
    if (!initialReactions) return;
    let cancelled = false;
    initialReactions.then(({ reactions, userNames }) => {
      if (cancelled) return;
      setReactionsMap(reactions);
      setReactionUserNames((prev) => ({ ...prev, ...userNames }));
    });
    return () => {
      cancelled = true;
    };
  }, [initialReactions]);

  useEffect(() => {
    if (skipFirstReactionsFetch.current) {
      skipFirstReactionsFetch.current = false;
      return;
    }
    const commentIds = commentIdsKey.split(',').filter(Boolean);
    if (commentIds.length === 0) return;
    getCommentsReactionsBatch(commentIds)
      .then(({ reactions, userNames }) => {
        setReactionsMap(reactions);
        setReactionUserNames((prev) => ({ ...prev, ...userNames }));
      })
      .catch((err) => console.error('[BentoTimelineTile] Failed to load reactions:', err));
  }, [commentIdsKey, reactionRefreshVersion]);

  const handleToggleReaction = useCallback(
    async (commentId: string, emoji: string) => {
      try {
        const { added } = await toggleCommentReaction(commentId, emoji);
        if (added && currentUser?.id && currentUser.name) {
          setReactionUserNames((prev) =>
            prev[currentUser.id] ? prev : { ...prev, [currentUser.id]: currentUser.name },
          );
        }
        setReactionsMap((prev) => {
          const existing = prev[commentId] || [];
          const idx = existing.findIndex((reaction) => reaction.emoji === emoji);
          const userId = currentUser?.id || '';
          if (idx === -1 && added) {
            return {
              ...prev,
              [commentId]: [...existing, { emoji, count: 1, userIds: [userId], currentUserReacted: true }],
            };
          }
          if (idx !== -1) {
            const reaction = existing[idx];
            if (added) {
              const updated = {
                ...reaction,
                count: reaction.count + 1,
                userIds: [...reaction.userIds, userId],
                currentUserReacted: true,
              };
              const next = [...existing];
              next[idx] = updated;
              return { ...prev, [commentId]: next };
            }
            if (reaction.count <= 1) {
              return { ...prev, [commentId]: existing.filter((_, i) => i !== idx) };
            }
            const updated = {
              ...reaction,
              count: reaction.count - 1,
              userIds: reaction.userIds.filter((id) => id !== userId),
              currentUserReacted: false,
            };
            const next = [...existing];
            next[idx] = updated;
            return { ...prev, [commentId]: next };
          }
          return prev;
        });
      } catch (err) {
        console.error('[BentoTimelineTile] Failed to toggle reaction:', err);
      }
    },
    [currentUser?.id, currentUser?.name],
  );

  useEffect(() => setOrder(initialOrder), [initialOrder]);

  useEffect(() => {
    if (skipFirstEntriesFetch.current) {
      skipFirstEntriesFetch.current = false;
      return;
    }
    let cancelled = false;
    getTicketTimelineEntries(ticketId, { order: 'asc', includeTimeEntries: true, includeAlerts: true })
      .then((entries) => {
        if (cancelled) return;
        if (isActionMessageError(entries) || isActionPermissionError(entries)) {
          setSystemEntries([]);
          setFetchError(getErrorMessage(entries));
          return;
        }
        // Comments render from the richer local `conversations` payload; the
        // action's comment entries would duplicate them.
        setSystemEntries(entries.filter((entry) => entry.type !== 'comment'));
        setFetchError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : t('bento.timeline.loadError', 'Could not load the timeline'));
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, refreshKey]);

  // ---- Threading: nested threads anchored at their root on the spine ----
  // Same noise suppression as the conversation view: empty / reply-token-only
  // inbound-email comments stay out of the timeline.
  const threadGroups = useMemo(
    () =>
      buildCommentThreadGroups<IComment>({
        comments: filterHiddenNoiseComments(conversations),
        getCommentId: (comment) => comment.comment_id,
        getThreadId: (comment) => comment.thread_id || comment.comment_id,
        getParentCommentId: (comment) => comment.parent_comment_id,
        getCreatedAt: (comment) => comment.created_at,
      }),
    [conversations],
  );

  const groupByCommentId = useMemo(() => {
    const map = new Map<string, CommentThreadGroup<IComment>>();
    for (const group of threadGroups) {
      for (const comment of group.comments) {
        if (comment.comment_id) map.set(comment.comment_id, group);
      }
    }
    return map;
  }, [threadGroups]);

  const nodes = useMemo<TimelineNode[]>(() => {
    // Only thread roots occupy the spine; replies nest under their root via
    // HybridThreadNode. Each thread anchors at its root's timestamp.
    const commentNodes: TimelineNode[] = threadGroups.map(({ root }) => ({
      key: `comment-${root.comment_id}`,
      lane: 'reply',
      occurredAt:
        typeof root.created_at === 'string'
          ? root.created_at
          : new Date(root.created_at as unknown as string).toISOString(),
      sortId: root.comment_id ?? '',
      comment: root,
    }));

    const entryNodes: TimelineNode[] = systemEntries.map((entry) => ({
      key: `${entry.type}-${entry.sortId}`,
      lane: laneForEntryType(entry.type),
      occurredAt: entry.occurredAt,
      sortId: entry.sortId,
      entry,
    }));

    return sortTimelineNodes([...commentNodes, ...entryNodes], order);
  }, [threadGroups, systemEntries, order]);

  const counts = useMemo(() => laneCounts(nodes), [nodes]);

  const visible = filterByLane(nodes, filter);

  const toggleOrder = useCallback(() => {
    const next = order === 'asc' ? 'desc' : 'asc';
    setOrder(next);
    // Fire-and-forget persistence; the toggle already applied locally.
    void setTicketLayoutPreference({ timelineOrder: next })
      .then((result) => {
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          console.warn('[BentoTimelineTile] Failed to save timeline order:', getErrorMessage(result));
        }
      })
      .catch(() => undefined);
  }, [order]);

  const handleSend = useCallback(async () => {
    const success = await onAddNewComment(composerLane === 'internal', composerLane === 'resolution');
    if (success) {
      setHasDraft(false);
      composeUploadSession.resetDraftTracking();
    }
    return success;
  }, [onAddNewComment, composerLane, composeUploadSession]);

  // A single comment card plus, when it's the active reply target, an inline
  // reply composer beneath it. Used for every node in a nested thread.
  const renderThreadComment = (comment: IComment): React.ReactNode => {
    const commentId = comment.comment_id ?? '';
    const accent = commentAccentClasses(comment);
    return (
      <>
        <CommentItem
          variant="compact"
          accentBorderClassName={accent || undefined}
          id={commentId ? `${id}-comment-${commentId}` : `${id}-comment-unknown`}
          conversation={comment}
          currentUserId={currentUser?.id}
          isEditing={isEditing && currentComment?.comment_id === commentId}
          currentComment={currentComment}
          ticketId={ticketId}
          userMap={userMap}
          contactMap={contactMap}
          onContentChange={onContentChange}
          onSave={onSaveComment}
          onClose={onCloseEdit}
          onEdit={() => onEditComment(comment)}
          onDelete={onDeleteComment}
          onReply={
            onAddReplyComment && commentId
              ? () => setReplyingToCommentId(commentId)
              : undefined
          }
          uploadFile={editUploadSession.uploadFile}
          reactions={reactionsMap[commentId] || []}
          onToggleReaction={handleToggleReaction}
          userNames={reactionUserNames}
          canViewCommentMetadataDebug={canViewCommentMetadataDebug}
        />
        {replyingToCommentId === commentId && commentId ? (
          <InlineReplyComposer
            id={`${id}-reply-${commentId}`}
            parentCommentId={commentId}
            roomName={`ticket-${ticketId}-reply-${commentId}`}
            initialInternal={Boolean(comment.is_internal)}
            showInternalToggle={false}
            isSubmitting={isSubmitting}
            uploadFile={editUploadSession.uploadFile}
            searchMentions={searchUsersForMentions}
            onSubmit={async ({ content, parentCommentId, isInternal }) => {
              const success = await onAddReplyComment?.(content, parentCommentId, isInternal);
              if (success) {
                setReplyingToCommentId(null);
              }
            }}
            onCancel={() => setReplyingToCommentId(null)}
          />
        ) : null}
      </>
    );
  };

  const composer = (
    <div
      id={`${id}-composer`}
      className="mt-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3"
    >
      <p className="text-xs font-medium text-[rgb(var(--color-text-500))] mb-1.5">
        {contactFirstName
          ? t('bento.timeline.replyTo', 'Reply to {{name}}', { name: contactFirstName })
          : t('bento.timeline.writeReply', 'Write a reply')}
      </p>
      <TextEditor
        {...withDataAutomationId({ id: `${id}-composer-editor` })}
        key={editorKey}
        roomName={`ticket-${ticketId}`}
        initialContent={DEFAULT_BLOCK}
        onContentChange={(content: PartialBlock[]) => {
          onNewCommentContentChange(content);
          setHasDraft(true);
        }}
        searchMentions={searchUsersForMentions}
        uploadFile={composeUploadSession.uploadFile}
      />
      <div className="flex items-center gap-2 mt-2">
        <div
          role="group"
          aria-label={t('bento.timeline.replyVisibility', 'Reply visibility')}
          className="inline-flex items-center gap-0.5 rounded-lg bg-[rgb(var(--color-border-100))] p-0.5 text-xs font-medium"
        >
          {(
            [
              { value: 'client', label: t('bento.timeline.modeClient', 'Client') },
              { value: 'internal', label: t('bento.timeline.modeInternal', 'Internal') },
              { value: 'resolution', label: t('bento.timeline.modeResolution', 'Resolution') },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              id={`${id}-composer-lane-${option.value}`}
              type="button"
              aria-pressed={composerLane === option.value}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                composerLane === option.value
                  ? 'bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-900))] shadow-sm'
                  : 'text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]'
              }`}
              onClick={() => setComposerLane(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button
          id={`${id}-composer-send`}
          size="sm"
          onClick={handleSend}
          disabled={isSubmitting || !hasDraft}
        >
          {isSubmitting ? t('bento.timeline.sending', 'Sending…') : t('bento.timeline.send', 'Send')}
        </Button>
      </div>
    </div>
  );

  let lastDay: string | null = null;

  return (
    <BentoTile
      id={id}
      title={t('bento.timeline.title', 'Timeline')}
      subtitle={t('bento.timeline.subtitle', 'Replies, time, and system changes in one place')}
      icon={<Activity className="h-4 w-4" />}
      error={fetchError}
      className={className}
      action={
        <button
          id={`${id}-order-toggle`}
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]"
          onClick={toggleOrder}
          aria-label={t('bento.timeline.toggleSortOrder', 'Toggle sort order')}
        >
          <ArrowDownUp className="h-3.5 w-3.5" />
          {order === 'asc'
            ? t('bento.timeline.oldestFirst', 'Oldest first')
            : t('bento.timeline.newestFirst', 'Newest first')}
        </button>
      }
    >
      <div id={`${id}-filters`} className="flex flex-wrap gap-1.5 mb-3">
        {laneFilters.map((laneFilter) => {
          const count =
            laneFilter.value === 'everything' ? nodes.length : counts[laneFilter.value as Lane];
          return (
            <button
              key={laneFilter.value}
              id={`${id}-filter-${laneFilter.value}`}
              type="button"
              aria-pressed={filter === laneFilter.value}
              className={`px-2.5 py-0.5 rounded-full border text-xs font-medium transition-colors ${
                filter === laneFilter.value
                  ? 'bg-[rgb(var(--color-primary-500))] text-white border-transparent'
                  : 'bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-500))] border-[rgb(var(--color-border-200))] hover:text-[rgb(var(--color-text-700))]'
              }`}
              onClick={() => setFilter(laneFilter.value)}
            >
              {laneFilter.label} ({count})
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>
          {nodes.length === 0
            ? t('bento.timeline.nothingYet', 'Nothing yet. The ticket was opened {{when}}.', {
                when: ticketCreatedAt ? dayLabel(ticketCreatedAt) : t('bento.timeline.recently', 'recently'),
              })
            : t('bento.timeline.nothingInLane', 'Nothing in this lane yet.')}
        </BentoTileEmpty>
      ) : (
        <ol id={`${id}-stream`} className="relative">
          {/* Continuous spine: a single line down the pin gutter (left-3 = the
              centre of the w-6 gutter), behind the coloured pins. */}
          <div
            aria-hidden
            className="absolute top-2 bottom-2 left-3 w-px bg-[rgb(var(--color-border-200))]"
          />
          {visible.map((node) => {
            const day = dayLabel(node.occurredAt);
            const showBreak = day !== lastDay;
            lastDay = day;
            const v = laneVisual(node);
            return (
              <li key={node.key}>
                {showBreak ? (
                  <div className="relative flex items-center gap-2 pl-9 pt-3 pb-1 first:pt-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] bg-[rgb(var(--color-border-100))] rounded-full px-2.5 py-0.5">
                      {day}
                    </span>
                    <div className="flex-1 h-px bg-[rgb(var(--color-border-100))]" />
                  </div>
                ) : null}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 flex justify-center pt-1">
                    <div
                      className={`relative w-6 h-6 rounded-full ring-1 flex items-center justify-center flex-shrink-0 ${v.pin}`}
                    >
                      {v.icon}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 pb-1.5">
                    {node.lane === 'reply' && node.comment ? (() => {
                      const rootComment = node.comment;
                      const rootId = rootComment.comment_id ?? '';
                      const group = rootId ? groupByCommentId.get(rootId) : undefined;
                      if (!group) {
                        return renderThreadComment(rootComment);
                      }
                      return (
                        <HybridThreadNode<IComment>
                          group={group}
                          comment={group.root}
                          getCommentId={(comment) => comment.comment_id}
                          renderComment={(comment) => renderThreadComment(comment)}
                        />
                      );
                    })() : (
                      <TimelineNodeView id={`${id}-node`} node={node} t={t} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {composer}
    </BentoTile>
  );
}

// Compact single-line rows for the non-comment lanes. The lane icon is drawn
// by the spine pin in the gutter, so these render just the text + timestamp.
function TimelineNodeView({ id, node, t }: { id: string; node: TimelineNode; t: Translator }) {
  if (node.lane === 'time' && node.entry?.timeEntry) {
    const timeEntry = node.entry.timeEntry;
    return (
      <div id={`${id}-${node.sortId}`} className="flex gap-2.5 items-baseline pt-1">
        <p className="text-sm text-[rgb(var(--color-text-600))] min-w-0">
          <span className="font-semibold text-[rgb(var(--color-text-800))]">
            {timeEntry.user_display_name || t('bento.timeline.someone', 'Someone')}
          </span>{' '}
          {t('bento.timeline.logged', 'logged')}{' '}
          <span className="inline-block rounded bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-400)/0.2)] px-1.5 text-xs font-semibold text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))]">
            {formatMinutes(timeEntry.billable_duration)}
          </span>
          {timeEntry.notes ? <> — {timeEntry.notes}</> : null}
        </p>
        <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
          {formatClock(node.occurredAt)}
        </span>
      </div>
    );
  }

  if (node.lane === 'alert' && node.entry?.alert) {
    const alert = node.entry.alert;
    return (
      <div id={`${id}-${node.sortId}`} className="flex gap-2.5 items-baseline pt-1">
        <p className="text-sm text-[rgb(var(--color-text-600))] min-w-0">
          <span className="font-semibold text-[rgb(var(--color-text-800))]">
            {alert.device_name || t('bento.timeline.monitoringActor', 'Monitoring')}
          </span>
          {alert.message ? <> — {alert.message}</> : null}
          {alert.occurrence_count && alert.occurrence_count > 1 ? (
            <span className="text-xs text-[rgb(var(--color-text-400))]"> {t('bento.timeline.occurrence', '(occurrence {{count}})', { count: alert.occurrence_count })}</span>
          ) : null}
        </p>
        <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
          {formatClock(node.occurredAt)}
        </span>
      </div>
    );
  }

  // System lane (activity rows).
  return (
    <div id={`${id}-${node.sortId}`} className="flex gap-2.5 items-baseline pt-1.5">
      <p className="text-xs text-[rgb(var(--color-text-500))] min-w-0 truncate">
        {node.entry ? describeSystemEntry(node.entry, t) : t('bento.timeline.ticketUpdated', 'Ticket updated')}
      </p>
      <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
        {formatClock(node.occurredAt)}
      </span>
    </div>
  );
}

export default BentoTimelineTile;
