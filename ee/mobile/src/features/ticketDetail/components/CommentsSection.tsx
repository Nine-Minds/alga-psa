import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import EmojiPicker from "rn-emoji-keyboard";
import type { AggregatedReaction, TicketComment } from "../../../api/tickets";
import { createApiClient } from "../../../api";
import { toggleCommentReaction, updateTicketComment } from "../../../api/tickets";
import { useAuth } from "../../../auth/AuthContext";
import { useTheme } from "../../../ui/ThemeContext";
import { Avatar } from "../../../ui/components/Avatar";
import { Badge } from "../../../ui/components/Badge";
import { getAppConfig } from "../../../config/appConfig";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";
import { useModeration } from "../../moderation/useModeration";
import {
  extractPlainTextFromRichEditorJson,
  extractPlainTextFromSerializedRichEditorContent,
  isMalformedRichEditorContent,
  serializeRichEditorJson,
} from "../../ticketRichText/helpers";
import { TicketRichTextEditor } from "../../ticketRichText/TicketRichTextEditor";
import {
  buildCommentThreadGroups,
  flattenThreadGroups,
  type FlattenedThreadNode,
} from "../commentThreads";
import { ExpandableComment } from "./ExpandableComment";

const QUICK_EMOJIS = ['👍', '👎', '❤️', '😂', '🎉', '👀'];
const THREAD_INDENT_STEP = 14;

type ReplySubmit = (params: {
  parentCommentId: string;
  serializedDraft: string;
  text: string;
}) => Promise<boolean>;

export function CommentsSection({
  comments,
  visibleCount,
  onLoadMore,
  error,
  onLinkPress,
  imageAuth,
  baseUrl,
  ticketId,
  onCommentUpdated,
  onSubmitReply,
}: {
  comments: TicketComment[];
  visibleCount: number;
  onLoadMore: () => void;
  error: string | null;
  onLinkPress?: (url: string) => void;
  imageAuth?: { baseUrl: string; apiKey: string };
  baseUrl?: string | null;
  ticketId: string;
  onCommentUpdated?: () => void;
  onSubmitReply?: ReplySubmit;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const { session } = useAuth();
  const moderation = useModeration();
  // Sort order: "newest" shows latest-active threads first, "oldest" oldest
  // first. Ordering is now at the thread level (by last activity); replies
  // inside a thread are always chronological.
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  const meUserId = session?.user?.id;

  const isSystemEvent = useCallback(
    (c: TicketComment) => c.kind === "event" || typeof c.event_type === "string",
    [],
  );
  const isDeleted = useCallback(
    (c: TicketComment) => Boolean(c.deleted_at) || c.comment_text === "[deleted]",
    [],
  );

  // Group all comments (including muted/deleted) so the tree stays well-formed;
  // visibility is decided per-node at render time so children never orphan.
  const threadGroups = useMemo(
    () =>
      buildCommentThreadGroups<TicketComment>({
        comments,
        getCommentId: (c) => c.comment_id,
        getThreadId: (c) => c.thread_id,
        getParentCommentId: (c) => c.parent_comment_id,
        getCreatedAt: (c) => c.created_at,
        newestFirst: sortOrder === "newest",
      }),
    [comments, sortOrder],
  );

  // Per-thread collapse, keyed by the root's comment_id (threadId fallback) —
  // the same key flattenThreadGroups uses. Independent of the global collapse.
  const [collapsedRootIds, setCollapsedRootIds] = useState<Set<string>>(new Set());

  // Classify a node for moderation: 'visible' renders normally, 'hidden'
  // renders a [hidden] placeholder (muted author but has children — keep the
  // subtree), 'drop' removes it entirely (muted leaf/standalone — today's
  // behavior). System events and optimistic rows are never muted.
  const mutedState = useCallback(
    (node: FlattenedThreadNode<TicketComment>): "visible" | "hidden" | "drop" => {
      const c = node.comment;
      if (isSystemEvent(c) || c.optimistic) return "visible";
      if (!moderation.isMuted(c.created_by ?? null)) return "visible";
      const childCount = c.comment_id
        ? node.group.childrenByParentId.get(c.comment_id)?.length ?? 0
        : 0;
      return childCount > 0 ? "hidden" : "drop";
    },
    [isSystemEvent, moderation],
  );

  const renderable = useMemo(() => {
    const flat = flattenThreadGroups<TicketComment>(threadGroups, {
      getCommentId: (c) => c.comment_id,
      collapsedRootIds,
    });
    return flat.filter((node) => mutedState(node) !== "drop");
  }, [threadGroups, collapsedRootIds, mutedState]);

  const visible = renderable.slice(0, visibleCount);
  const remainingCount = Math.max(0, renderable.length - visibleCount);

  // Local reactions state (initialized from comment data, updated optimistically)
  const [reactionsOverrides, setReactionsOverrides] = useState<Record<string, AggregatedReaction[]>>({});
  const [emojiPickerCommentId, setEmojiPickerCommentId] = useState<string | null>(null);
  const [fullEmojiPickerCommentId, setFullEmojiPickerCommentId] = useState<string | null>(null);

  // Expansion state — keyed by comment_id.  The toggle ref stores the
  // ExpandableComment's toggle function; the `expanded` map is state so
  // that flipping it re-renders this component (fixing the stale-ref bug).
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const toggleRef = useRef<Record<string, () => void>>({});

  // Collapse state (global collapse-all; independent of per-thread collapse)
  const [collapsed, setCollapsed] = useState(false);

  // Comment editing state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Inline reply composer state (one active reply at a time)
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyPlainText, setReplyPlainText] = useState("");
  const [replySaving, setReplySaving] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const startEditing = (comment: TicketComment) => {
    setEditingCommentId(comment.comment_id ?? null);
    setEditDraft(comment.comment_text);
    setEditError(null);
  };

  const cancelEditing = () => {
    setEditingCommentId(null);
    setEditError(null);
  };

  const startReplying = (comment: TicketComment) => {
    setReplyingToCommentId(comment.comment_id ?? null);
    setReplyDraft("");
    setReplyPlainText("");
    setReplyError(null);
  };

  const cancelReplying = () => {
    setReplyingToCommentId(null);
    setReplyError(null);
  };

  const toggleThreadCollapsed = (rootKey: string) => {
    setCollapsedRootIds((prev) => {
      const next = new Set(prev);
      if (next.has(rootKey)) next.delete(rootKey);
      else next.add(rootKey);
      return next;
    });
  };

  const submitReply = async (parentCommentId: string) => {
    if (!onSubmitReply || replySaving) return;
    if (!replyPlainText.trim()) {
      setReplyError(t("comments.errors.empty"));
      return;
    }
    setReplySaving(true);
    setReplyError(null);
    try {
      const ok = await onSubmitReply({
        parentCommentId,
        serializedDraft: replyDraft,
        text: replyPlainText,
      });
      if (ok) {
        cancelReplying();
      } else {
        setReplyError(t("comments.errors.generic"));
      }
    } finally {
      setReplySaving(false);
    }
  };

  const confirmReport = useCallback(
    (comment: TicketComment) => {
      if (!comment.comment_id) return;
      void (async () => {
        const ok = await moderation.report({
          contentType: "ticket_comment",
          contentId: comment.comment_id,
          contentAuthorUserId: comment.created_by ?? undefined,
        });
        Alert.alert(
          ok ? t("comments.moderation.reportedTitle") : t("comments.moderation.reportFailedTitle"),
          ok
            ? t("comments.moderation.reportedBody")
            : t("comments.moderation.reportFailedBody"),
          [{ text: t("common:ok") }],
        );
      })();
    },
    [moderation, t],
  );

  const confirmMute = useCallback(
    (comment: TicketComment) => {
      const authorId = comment.created_by;
      const authorName = comment.created_by_name ?? t("common:unknown");
      if (!authorId) return;
      Alert.alert(
        t("comments.moderation.muteTitle", { name: authorName }),
        t("comments.moderation.muteBody"),
        [
          { text: t("common:cancel"), style: "cancel" },
          {
            text: t("comments.moderation.muteConfirm"),
            style: "destructive",
            onPress: () => {
              void moderation.mute(authorId);
            },
          },
        ],
      );
    },
    [moderation, t],
  );

  const openModerationMenu = useCallback(
    (comment: TicketComment) => {
      const authorId = comment.created_by;
      const isOwn = Boolean(meUserId && authorId === meUserId);

      const options: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [
        {
          text: t("comments.moderation.reportAction"),
          onPress: () => {
            Alert.alert(
              t("comments.moderation.reportConfirmTitle"),
              t("comments.moderation.reportConfirmBody"),
              [
                { text: t("common:cancel"), style: "cancel" },
                {
                  text: t("comments.moderation.reportConfirm"),
                  style: "destructive",
                  onPress: () => confirmReport(comment),
                },
              ],
            );
          },
        },
      ];

      if (!isOwn && authorId) {
        options.push({
          text: t("comments.moderation.muteAction"),
          onPress: () => confirmMute(comment),
        });
      }

      options.push({ text: t("common:cancel"), style: "cancel" });

      Alert.alert(
        t("comments.moderation.menuTitle"),
        undefined,
        options.map((o) => ({ text: o.text, style: o.style, onPress: o.onPress })),
      );
    },
    [confirmReport, confirmMute, meUserId, t],
  );

  const saveComment = async (commentId: string) => {
    if (!client || !session || !editDraft.trim()) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketComment(client, {
        apiKey: session.accessToken,
        ticketId,
        commentId,
        comment_text: editDraft,
        auditHeaders,
      });
      if (!res.ok) {
        setEditError(res.error.kind === "permission" ? t("comments.errors.permission") : t("comments.errors.generic"));
        return;
      }
      setEditingCommentId(null);
      onCommentUpdated?.();
    } finally {
      setEditSaving(false);
    }
  };

  const config = getAppConfig();
  const client = useMemo(() => {
    if (!config.ok) return null;
    return createApiClient({ baseUrl: config.baseUrl, getUserAgentTag: () => "mobile" });
  }, [config]);

  const getReactions = useCallback(
    (commentId: string | undefined): AggregatedReaction[] => {
      if (!commentId) return [];
      if (reactionsOverrides[commentId]) return reactionsOverrides[commentId];
      const comment = comments.find((c) => c.comment_id === commentId);
      return comment?.reactions ?? [];
    },
    [comments, reactionsOverrides],
  );

  const handleToggleReaction = useCallback(
    async (commentId: string, emoji: string) => {
      if (!client || !session) return;

      const userId = session.user?.id ?? "";

      // Optimistic update
      setReactionsOverrides((prev) => {
        const current = prev[commentId] ?? comments.find((c) => c.comment_id === commentId)?.reactions ?? [];
        const existing = current.find((r) => r.emoji === emoji);
        if (existing?.currentUserReacted) {
          const updated = existing.count === 1
            ? current.filter((r) => r.emoji !== emoji)
            : current.map((r) => r.emoji === emoji ? { ...r, count: r.count - 1, currentUserReacted: false, userIds: r.userIds.filter((id) => id !== userId) } : r);
          return { ...prev, [commentId]: updated };
        }
        if (existing) {
          return { ...prev, [commentId]: current.map((r) => r.emoji === emoji ? { ...r, count: r.count + 1, currentUserReacted: true, userIds: [...r.userIds, userId] } : r) };
        }
        return { ...prev, [commentId]: [...current, { emoji, count: 1, userIds: [userId], currentUserReacted: true }] };
      });

      setEmojiPickerCommentId(null);

      // Fire-and-forget: the next comments refresh will sync server state.
      void toggleCommentReaction(client, {
        apiKey: session.accessToken,
        ticketId,
        commentId,
        emoji,
      });
    },
    [client, session, ticketId, comments],
  );

  // Clear overrides when comments refresh (server data is now authoritative)
  useEffect(() => {
    setReactionsOverrides({});
  }, [comments.map((c) => c.comment_id).join(",")]);

  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text accessibilityRole="header" style={{ ...typography.caption, color: colors.textSecondary }}>
            {t("comments.label")}
          </Text>
          {comments.length > 0 ? (
            <Badge label={String(comments.length)} tone="neutral" />
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {!collapsed && comments.length > 1 ? (
            <Pressable
              onPress={() => setSortOrder((v) => v === "newest" ? "oldest" : "newest")}
              accessibilityRole="button"
              accessibilityLabel={sortOrder === "newest" ? t("comments.sortOldest") : t("comments.sortNewest")}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.85 : 1 })}
            >
              <View style={{ alignItems: "center", justifyContent: "center", height: 16 }}>
                <Feather name="arrow-up" size={10} color={colors.primary} style={{ marginBottom: -3 }} />
                <Feather name="arrow-down" size={10} color={colors.primary} style={{ marginTop: -3 }} />
              </View>
              <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                {sortOrder === "newest" ? t("comments.newest") : t("comments.oldest")}
              </Text>
            </Pressable>
          ) : null}
          {comments.length > 0 ? (
            <Pressable
              onPress={() => setCollapsed((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={collapsed ? t("comments.expand") : t("comments.collapse")}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.85 : 1 })}
            >
              <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                {collapsed ? t("comments.expand") : t("comments.collapse")}
              </Text>
              <Feather name={collapsed ? "chevron-down" : "chevron-up"} size={14} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {error ? (
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.danger }}>{error}</Text>
      ) : null}

      {collapsed ? null : comments.length === 0 ? (
        <Text style={{ ...typography.body, marginTop: spacing.sm, color: colors.textSecondary }}>{t("comments.noComments")}</Text>
      ) : (
        <View style={{ marginTop: spacing.sm }}>
          {visible.map((node, idx) => {
            const c = node.comment;
            const indent = node.visualDepth * THREAD_INDENT_STEP;
            const isReplyNode = !node.isRoot;
            const rootKey = node.group.root.comment_id ?? node.group.threadId;
            const threadCollapsed = collapsedRootIds.has(rootKey);
            const kind = c.kind;
            const eventType = c.event_type;
            const isSystemEventComment = kind === "event" || typeof eventType === "string";
            const isOptimistic = Boolean(c.optimistic);
            const deleted = isDeleted(c);
            const hidden = mutedState(node) === "hidden";
            const isEditingThis = editingCommentId === c.comment_id;
            const isReplyingThis = replyingToCommentId === c.comment_id;
            const canEdit = !isSystemEventComment && !isOptimistic && !deleted && !hidden && Boolean(meUserId && c.created_by === meUserId);
            const canReply = Boolean(onSubmitReply) && !isSystemEventComment && !isOptimistic && !deleted && !hidden && !isEditingThis;
            const commentPlainText = extractPlainTextFromSerializedRichEditorContent(c.comment_text);
            const eventText = c.event_text ?? (eventType ? `${eventType}: ${commentPlainText}` : commentPlainText);
            const badgeLabel = isSystemEventComment ? t("comments.event") : isOptimistic ? t("comments.sending") : c.is_resolution ? t("comments.resolution") : c.is_internal ? t("comments.internal") : t("comments.client");
            const accessibilityLabel = `${badgeLabel}. ${c.created_by_name ?? t("common:unknown")}. ${formatDateTimeWithRelative(c.created_at)}. ${
              isSystemEventComment ? eventText : commentPlainText || t("comments.richComment")
            }`;

            // Connector rail is an explicit absolutely-positioned element: a
            // left CSS border is ~invisible against the dark card and RN does
            // not render a dashed single-side border on a content view. The
            // inter-comment gap is paddingTop (inside the wrapper) so the rail
            // spans it and consecutive replies read as one continuous line.
            const nodeWrapperStyle = {
              marginLeft: indent,
              opacity: isOptimistic ? 0.75 : 1,
              ...(isReplyNode
                ? {
                    position: "relative" as const,
                    paddingLeft: 12,
                    paddingTop: idx === 0 ? 0 : spacing.md,
                  }
                : { marginTop: idx === 0 ? 0 : spacing.md }),
            } as const;

            // Direct replies (data depth 1) get a solid rail; nested
            // sub-threads (depth >= 2) get a dashed rail, mirroring the web's
            // dashed sub-thread rail. colors.textSecondary is the same gray as
            // the timestamp text — guaranteed visible on the dark card.
            // RN's borderStyle:'dashed' is unreliable on a single-side border
            // (renders nothing on iOS), so the dashed sub-thread rail is built
            // from real stacked segments clipped to the node height — this
            // always renders. Depth-1 rail is a plain solid bar.
            const railEl = !isReplyNode ? null : node.depth >= 2 ? (
              <View
                pointerEvents="none"
                style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, overflow: "hidden" }}
              >
                {Array.from({ length: 120 }).map((_, i) => (
                  <View
                    key={i}
                    style={{ width: 2, height: 4, marginBottom: 4, backgroundColor: colors.textSecondary }}
                  />
                ))}
              </View>
            ) : (
              <View
                pointerEvents="none"
                style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, backgroundColor: colors.textSecondary }}
              />
            );

            // Deleted / moderation-hidden placeholder: keep position + subtree.
            if (deleted || hidden) {
              return (
                <React.Fragment key={c.comment_id ?? String(idx)}>
                  <View style={nodeWrapperStyle}>
                    {railEl}
                    <Text
                      style={{ ...typography.caption, color: colors.textSecondary, fontStyle: "italic" }}
                    >
                      {deleted ? t("comments.deletedPlaceholder") : t("comments.hiddenPlaceholder")}
                    </Text>
                  </View>
                  {node.isRoot && node.group.replyCount > 0 ? (
                    <Pressable
                      onPress={() => toggleThreadCollapsed(rootKey)}
                      accessibilityRole="button"
                      accessibilityLabel={threadCollapsed ? t("comments.expand") : t("comments.collapse")}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        marginTop: spacing.xs,
                        marginLeft: indent,
                        opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                        {t("comments.repliesCount", { count: node.group.replyCount })}
                      </Text>
                      <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                        {threadCollapsed ? t("comments.expand") : t("comments.collapse")}
                      </Text>
                      <Feather name={threadCollapsed ? "chevron-down" : "chevron-up"} size={12} color={colors.primary} />
                    </Pressable>
                  ) : null}
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={c.comment_id ?? String(idx)}>
              <View
                accessible
                accessibilityLabel={accessibilityLabel}
                style={nodeWrapperStyle}
              >
                {railEl}
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {!isSystemEventComment ? (
                    <Avatar
                      name={c.created_by_name ?? undefined}
                      imageUri={c.created_by_avatar_url && baseUrl ? `${baseUrl}${c.created_by_avatar_url}` : undefined}
                      authToken={session?.accessToken}
                      size="sm"
                    />
                  ) : null}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flex: 1, marginLeft: isSystemEventComment ? 0 : spacing.sm }}>
                    <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                      {c.created_by_name ?? t("common:unknown")} • {formatDateTimeWithRelative(c.created_at)}
                    </Text>
                    <View style={{ width: spacing.sm }} />
                    {isSystemEventComment ? (
                      <Badge label={t("comments.event")} tone="neutral" />
                    ) : isOptimistic ? (
                      <Badge label={t("comments.sending")} tone="neutral" />
                    ) : (
                      <>
                        <Badge label={c.is_internal ? t("comments.internal") : t("comments.client")} tone={c.is_internal ? "warning" : "info"} />
                        {c.is_resolution ? (
                          <>
                            <View style={{ width: spacing.xs }} />
                            <Badge label={t("comments.resolution")} tone="success" />
                          </>
                        ) : null}
                      </>
                    )}
                  </View>
                  {isEditingThis ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                      <Pressable
                        onPress={cancelEditing}
                        disabled={editSaving}
                        accessibilityRole="button"
                        style={{ padding: spacing.xs, opacity: editSaving ? 0.4 : 1 }}
                      >
                        <Feather name="x" size={18} color={colors.textSecondary} />
                      </Pressable>
                      <Pressable
                        onPress={() => void saveComment(c.comment_id!)}
                        disabled={editSaving}
                        accessibilityRole="button"
                        style={{ padding: spacing.xs, opacity: editSaving ? 0.4 : 1 }}
                      >
                        {editSaving ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Feather name="check" size={18} color={colors.primary} />
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      {canReply ? (
                        <Pressable
                          onPress={() => startReplying(c)}
                          accessibilityRole="button"
                          accessibilityLabel={t("comments.reply")}
                          style={{ padding: spacing.xs }}
                        >
                          <Feather name="corner-up-left" size={16} color={colors.textSecondary} />
                        </Pressable>
                      ) : null}
                      {canEdit ? (
                        <Pressable
                          onPress={() => startEditing(c)}
                          accessibilityRole="button"
                          accessibilityLabel={t("comments.editComment")}
                          style={{ padding: spacing.xs }}
                        >
                          <Feather name="edit-2" size={16} color={colors.textSecondary} />
                        </Pressable>
                      ) : null}
                      {!isSystemEventComment && !isOptimistic ? (
                        <Pressable
                          onPress={() => openModerationMenu(c)}
                          accessibilityRole="button"
                          accessibilityLabel={t("comments.moderation.menuAccessibility")}
                          style={{ padding: spacing.xs }}
                        >
                          <Feather name="more-vertical" size={16} color={colors.textSecondary} />
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
                {isEditingThis ? (
                  <>
                    <View style={{ marginTop: spacing.xs }}>
                      <TicketRichTextEditor
                        content={editDraft}
                        editable={!editSaving}
                        showToolbar
                        height={180}
                        loadingLabel={t("comments.loadingCommentEditor")}
                        onContentChange={({ json }) => {
                          setEditDraft(serializeRichEditorJson(json));
                        }}
                      />
                    </View>
                    {editError ? (
                      <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.xs }}>
                        {editError}
                      </Text>
                    ) : null}
                  </>
                ) : isSystemEventComment ? (
                  <Text style={{ ...typography.body, color: colors.text, marginTop: 2, fontStyle: "italic" }}>
                    {eventText}
                  </Text>
                ) : (
                  isMalformedRichEditorContent(c.comment_text) ? (
                    <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>
                      {commentPlainText || "—"}
                    </Text>
                  ) : (
                    <ExpandableComment
                      content={c.comment_text}
                      loadingLabel={t("comments.loadingComment")}
                      onLinkPress={onLinkPress}
                      imageAuth={imageAuth}
                      colors={colors}
                      typography={typography}
                      spacing={spacing}
                      t={(key: string) => t(key)}
                      renderFooter={({ needsExpansion, expanded, toggle }) => {
                        const cid = c.comment_id ?? "";
                        if (needsExpansion) {
                          toggleRef.current[cid] = () => {
                            toggle();
                            setExpandedMap((m) => ({ ...m, [cid]: !m[cid] }));
                          };
                          // Sync initial needsExpansion into state (only once)
                          if (expandedMap[cid] === undefined && !expanded) {
                            // Use a microtask to avoid setState-during-render warning
                            queueMicrotask(() => setExpandedMap((m) => (m[cid] === undefined ? { ...m, [cid]: false } : m)));
                          }
                        } else {
                          delete toggleRef.current[cid];
                        }
                        return null;
                      }}
                    />
                  )
                )}
                {/* Inline reply composer */}
                {isReplyingThis ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <TicketRichTextEditor
                      content={replyDraft}
                      editable={!replySaving}
                      showToolbar
                      height={140}
                      loadingLabel={t("comments.loadingCommentEditor")}
                      onContentChange={({ json }) => {
                        setReplyDraft(serializeRichEditorJson(json));
                        setReplyPlainText(extractPlainTextFromRichEditorJson(json));
                      }}
                    />
                    {replyError ? (
                      <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.xs }}>
                        {replyError}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.md, marginTop: spacing.sm }}>
                      <Pressable
                        onPress={cancelReplying}
                        disabled={replySaving}
                        accessibilityRole="button"
                        accessibilityLabel={t("common:cancel")}
                        style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, opacity: replySaving ? 0.4 : 1 }}
                      >
                        <Text style={{ ...typography.caption, color: colors.textSecondary, fontWeight: "600" }}>
                          {t("common:cancel")}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void submitReply(c.comment_id!)}
                        disabled={replySaving || replyPlainText.trim().length === 0}
                        accessibilityRole="button"
                        accessibilityLabel={t("comments.reply")}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingVertical: spacing.xs,
                          paddingHorizontal: spacing.md,
                          borderRadius: 8,
                          backgroundColor: colors.primary,
                          opacity: replySaving || replyPlainText.trim().length === 0 ? 0.5 : 1,
                        }}
                      >
                        {replySaving ? (
                          <ActivityIndicator size="small" color={colors.background} />
                        ) : null}
                        <Text style={{ ...typography.caption, color: colors.background, fontWeight: "600" }}>
                          {replySaving ? t("comments.sending") : t("comments.reply")}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                {/* Reactions (left) + see more (right) — two-column row */}
                {!isSystemEventComment && c.comment_id ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.xs }}>
                    {/* Left: reaction pills + add button */}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flex: 1, gap: 4 }}>
                      {getReactions(c.comment_id).map((r) => (
                        <Pressable
                          key={r.emoji}
                          onPress={() => void handleToggleReaction(c.comment_id!, r.emoji)}
                          accessibilityRole="button"
                          accessibilityLabel={`${r.emoji} ${r.count}${r.currentUserReacted ? ", you reacted" : ""}`}
                          style={({ pressed }) => ({
                            flexDirection: "row",
                            alignItems: "center",
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: r.currentUserReacted ? colors.primary : colors.border,
                            backgroundColor: r.currentUserReacted ? `${colors.primary}18` : colors.background,
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <Text style={{ fontSize: 14 }}>{r.emoji}</Text>
                          <Text style={{ fontSize: 12, marginLeft: 3, color: r.currentUserReacted ? colors.primary : colors.textSecondary, fontWeight: r.currentUserReacted ? "600" : "400" }}>
                            {r.count}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        onPress={() => setEmojiPickerCommentId(emojiPickerCommentId === c.comment_id ? null : c.comment_id!)}
                        accessibilityRole="button"
                        accessibilityLabel="Add reaction"
                        style={({ pressed }) => ({
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ fontSize: 14 }}>+</Text>
                      </Pressable>
                    </View>
                    {/* Right: see more / see less */}
                    {expandedMap[c.comment_id] !== undefined ? (
                      <Pressable
                        onPress={toggleRef.current[c.comment_id]}
                        accessibilityRole="button"
                        accessibilityLabel={expandedMap[c.comment_id] ? t("comments.seeLess") : t("comments.seeMore")}
                        style={{ paddingHorizontal: 8, paddingVertical: 2, marginLeft: spacing.xs }}
                      >
                        <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                          {expandedMap[c.comment_id] ? t("comments.seeLess") : t("comments.seeMore")}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {/* Quick emoji picker */}
                {emojiPickerCommentId === c.comment_id ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, gap: 2, backgroundColor: colors.background, borderRadius: 16, padding: 4, borderWidth: 1, borderColor: colors.border, alignSelf: "flex-start" }}>
                    {QUICK_EMOJIS.map((emoji) => (
                      <Pressable
                        key={emoji}
                        onPress={() => void handleToggleReaction(c.comment_id!, emoji)}
                        accessibilityRole="button"
                        accessibilityLabel={`React with ${emoji}`}
                        style={({ pressed }) => ({ padding: 4, borderRadius: 8, opacity: pressed ? 0.5 : 1 })}
                      >
                        <Text style={{ fontSize: 20 }}>{emoji}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => {
                        setEmojiPickerCommentId(null);
                        setFullEmojiPickerCommentId(c.comment_id!);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="More emojis"
                      style={({ pressed }) => ({ padding: 4, borderRadius: 8, opacity: pressed ? 0.5 : 1 })}
                    >
                      <Text style={{ fontSize: 16, color: colors.textSecondary }}>...</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
              {/* Per-thread bar (root with replies) */}
              {node.isRoot && node.group.replyCount > 0 ? (
                <Pressable
                  onPress={() => toggleThreadCollapsed(rootKey)}
                  accessibilityRole="button"
                  accessibilityLabel={threadCollapsed ? t("comments.expand") : t("comments.collapse")}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    marginTop: spacing.xs,
                    marginLeft: indent,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                    {t("comments.repliesCount", { count: node.group.replyCount })}
                  </Text>
                  <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                    {threadCollapsed ? t("comments.expand") : t("comments.collapse")}
                  </Text>
                  <Feather name={threadCollapsed ? "chevron-down" : "chevron-up"} size={12} color={colors.primary} />
                </Pressable>
              ) : null}
              </React.Fragment>
            );
          })}

          {remainingCount > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <Pressable
                onPress={onLoadMore}
                accessibilityRole="button"
                accessibilityLabel={t("comments.loadMoreAccessibility")}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              >
                <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                  {t("comments.loadMore", { count: remainingCount })}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}

      <EmojiPicker
        onEmojiSelected={(emojiObject) => {
          if (fullEmojiPickerCommentId) {
            void handleToggleReaction(fullEmojiPickerCommentId, emojiObject.emoji);
          }
          setFullEmojiPickerCommentId(null);
        }}
        open={fullEmojiPickerCommentId !== null}
        onClose={() => setFullEmojiPickerCommentId(null)}
      />
    </View>
  );
}
