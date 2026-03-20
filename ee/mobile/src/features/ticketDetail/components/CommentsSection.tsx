import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import EmojiPicker from "rn-emoji-keyboard";
import type { AggregatedReaction, TicketComment } from "../../../api/tickets";
import { createApiClient } from "../../../api";
import { toggleCommentReaction } from "../../../api/tickets";
import { useAuth } from "../../../auth/AuthContext";
import { useTheme } from "../../../ui/ThemeContext";
import { Avatar } from "../../../ui/components/Avatar";
import { Badge } from "../../../ui/components/Badge";
import { getAppConfig } from "../../../config/appConfig";
import { formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";
import {
  extractPlainTextFromSerializedRichEditorContent,
  isMalformedRichEditorContent,
} from "../../ticketRichText/helpers";
import { ExpandableComment } from "./ExpandableComment";

const QUICK_EMOJIS = ['👍', '👎', '❤️', '😂', '🎉', '👀'];

export function CommentsSection({
  comments,
  visibleCount,
  onLoadMore,
  onJumpToLatest,
  onJumpToTop,
  error,
  onLinkPress,
  imageAuth,
  baseUrl,
  ticketId,
}: {
  comments: TicketComment[];
  visibleCount: number;
  onLoadMore: () => void;
  onJumpToLatest: () => void;
  onJumpToTop: () => void;
  error: string | null;
  onLinkPress?: (url: string) => void;
  imageAuth?: { baseUrl: string; apiKey: string };
  baseUrl?: string | null;
  ticketId: string;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const { session } = useAuth();
  const startIndex = Math.max(0, comments.length - visibleCount);
  const visible = comments.slice(startIndex);

  // Local reactions state (initialized from comment data, updated optimistically)
  const [reactionsOverrides, setReactionsOverrides] = useState<Record<string, AggregatedReaction[]>>({});
  const [emojiPickerCommentId, setEmojiPickerCommentId] = useState<string | null>(null);
  const [fullEmojiPickerCommentId, setFullEmojiPickerCommentId] = useState<string | null>(null);

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
        <Text accessibilityRole="header" style={{ ...typography.caption, color: colors.textSecondary }}>
          {t("comments.label")}
        </Text>
        {comments.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {comments.length >= 30 ? (
              <>
                <Pressable
                  onPress={onJumpToTop}
                  accessibilityRole="button"
                  accessibilityLabel={t("comments.jumpToTop")}
                  style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                >
                  <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>{t("comments.top")}</Text>
                </Pressable>
                <View style={{ width: spacing.md }} />
              </>
            ) : null}
            <Pressable
              onPress={onJumpToLatest}
              accessibilityRole="button"
              accessibilityLabel={t("comments.jumpToLatest")}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>{t("comments.latest")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {error ? (
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.danger }}>{error}</Text>
      ) : null}

      {comments.length === 0 ? (
        <Text style={{ ...typography.body, marginTop: spacing.sm, color: colors.textSecondary }}>{t("comments.noComments")}</Text>
      ) : (
        <View style={{ marginTop: spacing.sm }}>
          {visible.map((c, idx) => {
            const kind = c.kind;
            const eventType = c.event_type;
            const isSystemEvent = kind === "event" || typeof eventType === "string";
            const isOptimistic = Boolean(c.optimistic);
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
                </View>
                {isSystemEvent ? (
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
                    />
                  )
                )}
                {/* Reaction pills + add button */}
                {!isSystemEvent && c.comment_id ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: spacing.xs, gap: 4 }}>
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

          {startIndex > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <Pressable
                onPress={onLoadMore}
                accessibilityRole="button"
                accessibilityLabel={t("comments.loadMoreAccessibility")}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              >
                <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                  {t("comments.loadMore", { count: startIndex })}
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
