import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
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
import {
  extractPlainTextFromSerializedRichEditorContent,
  isMalformedRichEditorContent,
  serializeRichEditorJson,
} from "../../ticketRichText/helpers";
import { TicketRichTextEditor } from "../../ticketRichText/TicketRichTextEditor";
import { ExpandableComment } from "./ExpandableComment";

const QUICK_EMOJIS = ['👍', '👎', '❤️', '😂', '🎉', '👀'];

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
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const { session } = useAuth();
  // Sort order: "newest" shows latest first, "oldest" shows oldest first (API default)
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  const sorted = useMemo(
    () => sortOrder === "newest" ? [...comments].reverse() : comments,
    [comments, sortOrder],
  );
  const visible = sorted.slice(0, visibleCount);
  const remainingCount = Math.max(0, sorted.length - visibleCount);

  // Local reactions state (initialized from comment data, updated optimistically)
  const [reactionsOverrides, setReactionsOverrides] = useState<Record<string, AggregatedReaction[]>>({});
  const [emojiPickerCommentId, setEmojiPickerCommentId] = useState<string | null>(null);
  const [fullEmojiPickerCommentId, setFullEmojiPickerCommentId] = useState<string | null>(null);

  // Expansion state — keyed by comment_id.  The toggle ref stores the
  // ExpandableComment's toggle function; the `expanded` map is state so
  // that flipping it re-renders this component (fixing the stale-ref bug).
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const toggleRef = useRef<Record<string, () => void>>({});

  // Collapse state
  const [collapsed, setCollapsed] = useState(false);

  // Comment editing state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const meUserId = session?.user?.id;

  const startEditing = (comment: TicketComment) => {
    setEditingCommentId(comment.comment_id ?? null);
    setEditDraft(comment.comment_text);
    setEditError(null);
  };

  const cancelEditing = () => {
    setEditingCommentId(null);
    setEditError(null);
  };

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
          {visible.map((c, idx) => {
            const kind = c.kind;
            const eventType = c.event_type;
            const isSystemEvent = kind === "event" || typeof eventType === "string";
            const isOptimistic = Boolean(c.optimistic);
            const canEdit = !isSystemEvent && !isOptimistic && Boolean(meUserId && c.created_by === meUserId);
            const isEditingThis = editingCommentId === c.comment_id;
            const commentPlainText = extractPlainTextFromSerializedRichEditorContent(c.comment_text);
            const eventText = c.event_text ?? (eventType ? `${eventType}: ${commentPlainText}` : commentPlainText);
            const badgeLabel = isSystemEvent ? t("comments.event") : isOptimistic ? t("comments.sending") : c.is_internal ? t("comments.internal") : t("comments.public");
            const accessibilityLabel = `${badgeLabel}. ${c.created_by_name ?? t("common:unknown")}. ${formatDateTimeWithRelative(c.created_at)}. ${
              isSystemEvent ? eventText : commentPlainText || t("comments.richComment")
            }`;

            return (
              <View
                key={c.comment_id ?? String(idx)}
                accessible
                accessibilityLabel={accessibilityLabel}
                style={{ marginTop: idx === 0 ? 0 : spacing.md, opacity: isOptimistic ? 0.75 : 1 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {!isSystemEvent ? (
                    <Avatar
                      name={c.created_by_name ?? undefined}
                      imageUri={c.created_by_avatar_url && baseUrl ? `${baseUrl}${c.created_by_avatar_url}` : undefined}
                      authToken={session?.accessToken}
                      size="sm"
                    />
                  ) : null}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flex: 1, marginLeft: isSystemEvent ? 0 : spacing.sm }}>
                    <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                      {c.created_by_name ?? t("common:unknown")} • {formatDateTimeWithRelative(c.created_at)}
                    </Text>
                    <View style={{ width: spacing.sm }} />
                    {isSystemEvent ? (
                      <Badge label={t("comments.event")} tone="neutral" />
                    ) : isOptimistic ? (
                      <Badge label={t("comments.sending")} tone="neutral" />
                    ) : (
                      <Badge label={c.is_internal ? t("comments.internal") : t("comments.public")} tone={c.is_internal ? "warning" : "info"} />
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
                  ) : canEdit ? (
                    <Pressable
                      onPress={() => startEditing(c)}
                      accessibilityRole="button"
                      accessibilityLabel={t("comments.editComment")}
                      style={{ padding: spacing.xs }}
                    >
                      <Feather name="edit-2" size={16} color={colors.textSecondary} />
                    </Pressable>
                  ) : null}
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
                ) : isSystemEvent ? (
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
                {/* Reactions (left) + see more (right) — two-column row */}
                {!isSystemEvent && c.comment_id ? (
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
