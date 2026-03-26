import React, { useState, type RefObject } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TicketDetail } from "../../../api/tickets";
import { useTheme } from "../../../ui/ThemeContext";
import {
  TicketRichTextEditor,
  type TicketRichTextEditorRef,
} from "../../ticketRichText/TicketRichTextEditor";
import {
  extractPlainTextFromRichEditorJson,
  extractPlainTextFromSerializedRichEditorContent,
  isMalformedRichEditorContent,
  serializeRichEditorJson,
} from "../../ticketRichText/helpers";
import { extractDescription } from "../utils";

export function DescriptionSection({
  ticket,
  isEditing,
  draftContent,
  draftPlainText,
  saving,
  error,
  editorRef,
  onLinkPress,
  qaAutoPressFirstLink = false,
  imageAuth,
  onStartEditing,
  onCancelEditing,
  onSave,
  onDraftChange,
}: {
  ticket: TicketDetail;
  isEditing: boolean;
  draftContent: string;
  draftPlainText: string;
  saving: boolean;
  error: string | null;
  editorRef: RefObject<TicketRichTextEditorRef | null>;
  onLinkPress?: (url: string) => void;
  qaAutoPressFirstLink?: boolean;
  imageAuth?: { baseUrl: string; apiKey: string };
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSave: () => void;
  onDraftChange: (content: string, plainText: string) => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const description = extractDescription(ticket);

  const DESCRIPTION_COLLAPSED_HEIGHT = 96;
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const needsExpansion = contentHeight !== null && contentHeight > DESCRIPTION_COLLAPSED_HEIGHT;

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
          {t("description.label")}
        </Text>
        {isEditing ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Pressable
              onPress={onCancelEditing}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t("common:cancel")}
              style={{ padding: spacing.xs, opacity: saving ? 0.4 : 1 }}
            >
              <Feather name="x" size={20} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              onPress={onSave}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t("common:save")}
              style={{ padding: spacing.xs, opacity: saving ? 0.4 : 1 }}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="check" size={20} color={colors.primary} />
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
      <View style={{ marginTop: spacing.sm }}>
        {isEditing ? (
          <>
            <TicketRichTextEditor
              ref={editorRef}
              content={draftContent}
              editable={!saving}
              showToolbar
              height={220}
              loadingLabel={t("description.loadingEditor")}
              onContentChange={({ json }) => {
                onDraftChange(
                  serializeRichEditorJson(json),
                  extractPlainTextFromRichEditorJson(json),
                );
              }}
            />
            {error ? (
              <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
                {error}
              </Text>
            ) : null}
          </>
        ) : description && !isMalformedRichEditorContent(description) ? (
          <>
            <Pressable onPress={onStartEditing} accessibilityRole="button" accessibilityLabel={t("description.edit")}>
              <TicketRichTextEditor
                content={description}
                editable={false}
                height={expanded || !needsExpansion ? (contentHeight ?? DESCRIPTION_COLLAPSED_HEIGHT) : DESCRIPTION_COLLAPSED_HEIGHT}
                scrollEnabled={false}
                loadingLabel={t("description.loadingDescription")}
                onLinkPress={onLinkPress}
                qaAutoPressFirstLink={qaAutoPressFirstLink}
                imageAuth={imageAuth}
                onContentHeight={({ height }) => setContentHeight(height)}
              />
            </Pressable>
            {needsExpansion ? (
              <Pressable
                onPress={() => setExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={expanded ? t("comments.seeLess") : t("comments.seeMore")}
                style={{ paddingTop: spacing.xs, alignSelf: "flex-end" }}
              >
                <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                  {expanded ? t("comments.seeLess") : t("comments.seeMore")}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <Pressable onPress={onStartEditing} accessibilityRole="button" accessibilityLabel={t("description.add")}>
            <Text style={{ ...typography.body, color: colors.textSecondary }}>
              {description ? extractPlainTextFromSerializedRichEditorContent(description) : draftPlainText || t("description.tapToAdd")}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
