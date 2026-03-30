import React, { type RefObject } from "react";
import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import {
  TicketRichTextEditor,
  type TicketRichTextEditorRef,
} from "../../ticketRichText/TicketRichTextEditor";
import {
  extractPlainTextFromRichEditorJson,
  serializeRichEditorJson,
} from "../../ticketRichText/helpers";
import { ActionChip } from "./ActionChip";
import { MAX_COMMENT_LENGTH } from "../types";

export function CommentComposer({
  draftContent,
  draftPlainText,
  isInternal,
  onChangeIsInternal,
  onSend,
  sending,
  offline,
  error,
  editorRef,
  onDraftChange,
  collapsed,
  onToggleCollapse,
}: {
  draftContent: string;
  draftPlainText: string;
  isInternal: boolean;
  onChangeIsInternal: (value: boolean) => void;
  onSend: () => void;
  sending: boolean;
  offline: boolean;
  error: string | null;
  editorRef: RefObject<TicketRichTextEditorRef | null>;
  onDraftChange: (content: string, plainText: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
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
      <Pressable
        onPress={onToggleCollapse}
        disabled={!onToggleCollapse}
        accessibilityRole="button"
        accessibilityLabel={collapsed ? t("comments.expandComposer") : t("comments.collapseComposer")}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: onToggleCollapse && pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t("comments.addComment")}</Text>
        {onToggleCollapse ? (
          <Feather name={collapsed ? "chevron-down" : "chevron-up"} size={14} color={colors.primary} />
        ) : null}
      </Pressable>
      {collapsed ? null : (
        <>
          <View style={{ marginTop: spacing.sm }}>
            <TicketRichTextEditor
              ref={editorRef}
              content={draftContent}
              editable={!sending}
              showToolbar
              height={180}
              loadingLabel={t("comments.loadingCommentEditor")}
              onContentChange={({ json }) => {
                onDraftChange(
                  serializeRichEditorJson(json),
                  extractPlainTextFromRichEditorJson(json),
                );
              }}
            />
          </View>
          <Text
            style={{
              ...typography.caption,
              marginTop: spacing.sm,
              color: draftPlainText.length > MAX_COMMENT_LENGTH ? colors.danger : colors.textSecondary,
            }}
          >
            {draftPlainText.length}/{MAX_COMMENT_LENGTH}
          </Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
            <ActionChip label={isInternal ? t("comments.internalChecked") : t("comments.internal")} onPress={() => onChangeIsInternal(true)} />
            <View style={{ width: spacing.sm }} />
            <ActionChip label={!isInternal ? t("comments.publicChecked") : t("comments.public")} onPress={() => onChangeIsInternal(false)} />
          </View>
          {error ? (
            <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
              {error}
            </Text>
          ) : null}
          {offline ? (
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }}>
              {t("comments.offlineDraftSaved")}
            </Text>
          ) : null}
          <View style={{ marginTop: spacing.sm }}>
            <PrimaryButton
              onPress={onSend}
              disabled={sending || offline || draftPlainText.trim().length === 0 || draftPlainText.length > MAX_COMMENT_LENGTH}
              accessibilityLabel={t("comments.sendComment")}
            >
              {sending ? t("comments.sending") : t("comments.send")}
            </PrimaryButton>
          </View>
        </>
      )}
    </View>
  );
}
