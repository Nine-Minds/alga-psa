'use client';

import React, { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { PartialBlock } from '@blocknote/core';
import { Activity, AlertTriangle, ArrowDownUp, CheckCircle, Clock, CornerDownRight, Lock, MessageSquare, MessagesSquare } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import RichTextEditorSkeleton from '@alga-psa/ui/components/skeletons/RichTextEditorSkeleton';
import { buildCommentThreadGroups, type CommentThreadGroup } from '@alga-psa/ui/components';
import CommentThreadDrawer from '@alga-psa/ui/components/CommentThreadDrawer';
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
import { resolveCommentAuthor, type CommentUserAuthor, type CommentContactAuthor } from '../../../lib/commentAuthorResolution';
import { parseTicketRichTextContent } from '../../../lib/ticketRichText';
import type { TicketReactionsBootstrap } from '../../../lib/ticketScreenBootstrap';
import { BentoTile, BentoTileEmpty } from './BentoTile';

const TextEditor = dynamic(() => import('@alga-psa/ui/editor').then((mod) => mod.TextEditor), {
  loading: () => <RichTextEditorSkeleton height="120px" title="Reply editor" />,
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

const LANE_FILTERS: { value: LaneFilter; label: string }[] = [
  { value: 'everything', label: 'Everything' },
  { value: 'reply', label: 'Replies' },
  { value: 'time', label: 'Time' },
  { value: 'system', label: 'System' },
  { value: 'alert', label: 'Alerts' },
];

interface BentoTimelineTileProps {
  id: string;
  ticketId: string;
  conversations: IComment[];
  userMap: Record<string, CommentUserAuthor>;
  contactMap: Record<string, CommentContactAuthor>;
  contactFirstName?: string | null;
  ticketCreatedAt?: string | null;
  /** Bumped by the parent whenever a save/comment lands so the stream refetches. */
  refreshKey?: number;
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

/** Compact one-line description of a system (activity) entry. */
function describeSystemEntry(entry: TicketTimelineEntry): string {
  const activity = entry.activity;
  if (!activity) return 'Ticket updated';
  const actor = activity.actor_display_name || 'System';
  const changes = activity.changes ?? {};
  const changeLines = Object.entries(changes).map(([field, change]) => {
    const from = change?.oldLabel ?? null;
    const to = change?.newLabel ?? null;
    const fieldName = field.replace(/_id$/, '').replace(/_/g, ' ');
    if (to != null) return from != null ? `${fieldName}: ${from} → ${to}` : `${fieldName} set to ${to}`;
    return fieldName;
  });
  const eventName = activity.event_type
    .replace(/^TICKET_/, '')
    .toLowerCase()
    .replace(/_/g, ' ');
  return changeLines.length > 0 ? `${actor} changed ${changeLines.join(', ')}` : `${actor} · ${eventName}`;
}

/** Lane border-color classes for a comment (client / internal / resolution). */
function commentAccentClasses(comment: IComment | undefined): string {
  if (!comment) return '';
  if (comment.is_resolution) return 'border-green-400 dark:border-green-500/50';
  if (comment.is_internal) return 'border-amber-400 dark:border-amber-500/50';
  return 'border-[rgb(var(--color-secondary-400))]';
}

/** Best-effort plain text of a comment's rich-text note, for quote snippets. */
function commentPlainText(comment: IComment | undefined): string {
  if (!comment?.note) return '';
  try {
    const blocks = parseTicketRichTextContent(comment.note, { onParseError: () => undefined });
    const parts: string[] = [];
    const walk = (items: unknown): void => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        if (typeof record.text === 'string') parts.push(record.text);
        walk(record.content);
        walk(record.children);
      }
    };
    walk(blocks as unknown);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function truncateSnippet(text: string, max = 56): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
  // Threading: which comment's thread is open in the drawer (also the reply
  // target), and which card is flash-highlighted after a quote-chip jump.
  const [openThreadCommentId, setOpenThreadCommentId] = useState<string | null>(null);
  const [flashCommentId, setFlashCommentId] = useState<string | null>(null);

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
        // Comments render from the richer local `conversations` payload; the
        // action's comment entries would duplicate them.
        setSystemEntries(entries.filter((entry) => entry.type !== 'comment'));
        setFetchError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : 'Could not load the timeline');
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, refreshKey]);

  const nodes = useMemo<TimelineNode[]>(() => {
    const commentNodes: TimelineNode[] = conversations.map((comment) => ({
      key: `comment-${comment.comment_id}`,
      lane: 'reply',
      occurredAt:
        typeof comment.created_at === 'string'
          ? comment.created_at
          : new Date(comment.created_at as unknown as string).toISOString(),
      sortId: comment.comment_id ?? '',
      comment,
    }));

    const entryNodes: TimelineNode[] = systemEntries.map((entry) => ({
      key: `${entry.type}-${entry.sortId}`,
      lane: laneForEntryType(entry.type),
      occurredAt: entry.occurredAt,
      sortId: entry.sortId,
      entry,
    }));

    return sortTimelineNodes([...commentNodes, ...entryNodes], order);
  }, [conversations, systemEntries, order]);

  const counts = useMemo(() => laneCounts(nodes), [nodes]);

  const visible = filterByLane(nodes, filter);

  // ---- Threading (flat spine + one-level indent + drawer for full trees) ----
  const commentById = useMemo(() => {
    const map = new Map<string, IComment>();
    for (const comment of conversations) {
      if (comment.comment_id) map.set(comment.comment_id, comment);
    }
    return map;
  }, [conversations]);

  const threadGroups = useMemo(
    () =>
      buildCommentThreadGroups<IComment>({
        comments: conversations,
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

  const openThread = useCallback((commentId: string) => setOpenThreadCommentId(commentId), []);
  const closeThread = useCallback(() => setOpenThreadCommentId(null), []);

  // Quote-chip jump: scroll to the parent's card and flash it. If the parent
  // isn't rendered (lane filter), fall back to opening the thread drawer.
  const jumpToComment = useCallback(
    (commentId: string) => {
      const el = document.getElementById(`${id}-comment-${commentId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFlashCommentId(commentId);
        window.setTimeout(() => {
          setFlashCommentId((current) => (current === commentId ? null : current));
        }, 1600);
      } else {
        openThread(commentId);
      }
    },
    [id, openThread],
  );

  const openThreadGroup = openThreadCommentId
    ? groupByCommentId.get(openThreadCommentId) ?? null
    : null;
  const openThreadComment = openThreadCommentId && openThreadGroup
    ? openThreadGroup.comments.find((comment) => comment.comment_id === openThreadCommentId) ?? openThreadGroup.root
    : null;

  const toggleOrder = useCallback(() => {
    const next = order === 'asc' ? 'desc' : 'asc';
    setOrder(next);
    // Fire-and-forget persistence; the toggle already applied locally.
    void setTicketLayoutPreference({ timelineOrder: next }).catch(() => undefined);
  }, [order]);

  const handleSend = useCallback(async () => {
    const success = await onAddNewComment(composerLane === 'internal', composerLane === 'resolution');
    if (success) {
      setHasDraft(false);
      composeUploadSession.resetDraftTracking();
    }
    return success;
  }, [onAddNewComment, composerLane, composeUploadSession]);

  const composer = (
    <div
      id={`${id}-composer`}
      className="mt-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3"
    >
      <p className="text-xs font-medium text-[rgb(var(--color-text-500))] mb-1.5">
        {contactFirstName ? `Reply to ${contactFirstName}` : 'Write a reply'}
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
          aria-label="Reply visibility"
          className="inline-flex items-center gap-0.5 rounded-lg bg-[rgb(var(--color-border-100))] p-0.5 text-xs font-medium"
        >
          {(
            [
              { value: 'client', label: 'Client' },
              { value: 'internal', label: 'Internal' },
              { value: 'resolution', label: 'Resolution' },
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
          {isSubmitting ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );

  let lastDay: string | null = null;

  return (
    <BentoTile
      id={id}
      title="Timeline"
      subtitle="Replies, time, and system changes in one place"
      icon={<Activity className="h-4 w-4" />}
      error={fetchError}
      className={className}
      action={
        <button
          id={`${id}-order-toggle`}
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]"
          onClick={toggleOrder}
          aria-label="Toggle sort order"
        >
          <ArrowDownUp className="h-3.5 w-3.5" />
          {order === 'asc' ? 'Oldest first' : 'Newest first'}
        </button>
      }
    >
      <div id={`${id}-filters`} className="flex flex-wrap gap-1.5 mb-3">
        {LANE_FILTERS.map((laneFilter) => {
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
            ? `Nothing yet. The ticket was opened ${ticketCreatedAt ? dayLabel(ticketCreatedAt) : 'recently'}.`
            : 'Nothing in this lane yet.'}
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
                      className={`relative z-10 w-6 h-6 rounded-full ring-1 flex items-center justify-center flex-shrink-0 ${v.pin}`}
                    >
                      {v.icon}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 pb-1.5">
                    {node.lane === 'reply' && node.comment ? (() => {
                      const comment = node.comment;
                      if (!comment) return null;
                      const commentId = comment.comment_id ?? '';
                      const parentId = comment.parent_comment_id || null;
                      const parent = parentId ? commentById.get(parentId) : undefined;
                      const parentAuthor = parent
                        ? resolveCommentAuthor(parent, { userMap, contactMap }).displayName
                        : null;
                      const parentText = commentPlainText(parent);
                      const group = commentId ? groupByCommentId.get(commentId) : undefined;
                      const isThreadRoot = Boolean(
                        group && group.replyCount > 0 && group.root.comment_id === commentId,
                      );
                      return (
                        <div
                          className={
                            parentId
                              ? "relative ml-5 before:content-[''] before:absolute before:-left-3.5 before:-top-2 before:h-7 before:w-3 before:rounded-bl-lg before:border-l-2 before:border-b-2 before:border-[rgb(var(--color-border-200))]"
                              : undefined
                          }
                        >
                          {parentId && parent ? (
                            <button
                              id={`${id}-comment-${commentId}-parent-ref`}
                              type="button"
                              onClick={() => jumpToComment(parentId)}
                              title={parentText ? `Replying to ${parentAuthor}: ${parentText}` : `Replying to ${parentAuthor}`}
                              className="mb-1 flex max-w-full items-center gap-1 rounded-full bg-[rgb(var(--color-border-100))] px-2.5 py-0.5 text-[11px] text-[rgb(var(--color-text-500))] hover:bg-[rgb(var(--color-border-200))]"
                            >
                              <CornerDownRight className="h-3 w-3 flex-shrink-0" />
                              <span className="flex-shrink-0 font-semibold text-[rgb(var(--color-text-700))]">
                                {(parentAuthor || 'Unknown').split(' ')[0]}
                              </span>
                              {parentText ? (
                                <span className="min-w-0 truncate">· “{truncateSnippet(parentText)}”</span>
                              ) : null}
                            </button>
                          ) : null}
                          <div
                            className={
                              flashCommentId === commentId
                                ? 'rounded-lg ring-2 ring-[rgb(var(--color-primary-400))] transition-shadow'
                                : undefined
                            }
                          >
                            <CommentItem
                              variant="compact"
                              accentBorderClassName={v.accent || undefined}
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
                                  ? () => openThread(commentId)
                                  : undefined
                              }
                              uploadFile={editUploadSession.uploadFile}
                              reactions={reactionsMap[commentId] || []}
                              onToggleReaction={handleToggleReaction}
                              userNames={reactionUserNames}
                              canViewCommentMetadataDebug={canViewCommentMetadataDebug}
                            />
                          </div>
                          {isThreadRoot && group ? (
                            <button
                              id={`${id}-comment-${commentId}-thread-pill`}
                              type="button"
                              onClick={() => openThread(commentId)}
                              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-400)/0.15)] px-2.5 py-0.5 text-xs font-semibold text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))] hover:bg-[rgb(var(--color-primary-100))] dark:hover:bg-[rgb(var(--color-primary-400)/0.25)]"
                            >
                              <MessagesSquare className="h-3 w-3" />
                              Thread · {group.replyCount} {group.replyCount === 1 ? 'reply' : 'replies'}
                            </button>
                          ) : null}
                        </div>
                      );
                    })() : (
                      <TimelineNodeView id={`${id}-node`} node={node} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {composer}

      {/* Full thread tree (existing hybrid nesting + reply composer). Opened
          from a root's "Thread · N replies" pill or any card's Reply action. */}
      <CommentThreadDrawer<IComment>
        id={`${id}-thread-drawer`}
        isOpen={Boolean(openThreadGroup)}
        onClose={closeThread}
        group={openThreadGroup}
        getCommentId={(comment) => comment.comment_id}
        renderComment={(comment) => (
          <CommentItem
            variant="compact"
            accentBorderClassName={commentAccentClasses(comment) || undefined}
            id={`${id}-drawer-comment-${comment.comment_id ?? 'unknown'}`}
            conversation={comment}
            currentUserId={currentUser?.id}
            isEditing={isEditing && currentComment?.comment_id === comment.comment_id}
            currentComment={currentComment}
            ticketId={ticketId}
            userMap={userMap}
            contactMap={contactMap}
            onContentChange={onContentChange}
            onSave={onSaveComment}
            onClose={onCloseEdit}
            onEdit={() => onEditComment(comment)}
            onDelete={onDeleteComment}
            uploadFile={editUploadSession.uploadFile}
            reactions={reactionsMap[comment.comment_id || ''] || []}
            onToggleReaction={handleToggleReaction}
            userNames={reactionUserNames}
            canViewCommentMetadataDebug={canViewCommentMetadataDebug}
          />
        )}
        replyParentCommentId={openThreadCommentId}
        replyRoomName={(parentCommentId) => `ticket-${ticketId}-reply-${parentCommentId}`}
        initialInternal={Boolean(openThreadComment?.is_internal)}
        showInternalToggle={false}
        isSubmitting={isSubmitting}
        onSubmitReply={async ({ content, parentCommentId, isInternal }) => {
          const success = await onAddReplyComment?.(content, parentCommentId, isInternal);
          if (success) {
            closeThread();
          }
        }}
      />
    </BentoTile>
  );
}

// Compact single-line rows for the non-comment lanes. The lane icon is drawn
// by the spine pin in the gutter, so these render just the text + timestamp.
function TimelineNodeView({ id, node }: { id: string; node: TimelineNode }) {
  if (node.lane === 'time' && node.entry?.timeEntry) {
    const timeEntry = node.entry.timeEntry;
    return (
      <div id={`${id}-${node.sortId}`} className="flex gap-2.5 items-baseline pt-1">
        <p className="text-sm text-[rgb(var(--color-text-600))] min-w-0">
          <span className="font-semibold text-[rgb(var(--color-text-800))]">
            {timeEntry.user_display_name || 'Someone'}
          </span>{' '}
          logged{' '}
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
            {alert.device_name || 'Monitoring'}
          </span>
          {alert.message ? <> — {alert.message}</> : null}
          {alert.occurrence_count && alert.occurrence_count > 1 ? (
            <span className="text-xs text-[rgb(var(--color-text-400))]"> (occurrence {alert.occurrence_count})</span>
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
        {node.entry ? describeSystemEntry(node.entry) : 'Ticket updated'}
      </p>
      <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
        {formatClock(node.occurredAt)}
      </span>
    </div>
  );
}

export default BentoTimelineTile;
