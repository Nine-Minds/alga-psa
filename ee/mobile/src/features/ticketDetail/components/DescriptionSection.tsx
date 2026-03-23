import React, { useState, type RefObject } from "react";
import { Pressable, Text, View } from "react-native";
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
import { ActionChip } from "./ActionChip";
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
      <Text accessibilityRole="header" style={{ ...typography.caption, color: colors.textSecondary }}>
        {t("description.label")}
      </Text>
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
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }}>
              {t("description.characters", { count: draftPlainText.length })}
            </Text>
            {error ? (
              <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
              <ActionChip label={t("common:cancel")} onPress={onCancelEditing} disabled={saving} />
              <View style={{ width: spacing.sm }} />
              <ActionChip label={saving ? t("common:saving") : t("common:save")} onPress={onSave} disabled={saving} loading={saving} />
            </View>
          </>
        ) : description && !isMalformedRichEditorContent(description) ? (
          <>
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
            {needsExpansion ? (
              <Pressable
                onPress={() => setExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={expanded ? t("comments.seeLess") : t("comments.seeMore")}
                style={{ paddingTop: spacing.xs }}
              >
                <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                  {expanded ? t("comments.seeLess") : t("comments.seeMore")}
                </Text>
              </Pressable>
            ) : null}
            <View style={{ marginTop: spacing.sm }}>
              <ActionChip label={t("description.edit")} onPress={onStartEditing} />
            </View>
          </>
        ) : (
          <>
            <Text style={{ ...typography.body, color: colors.text }}>
              {description ? extractPlainTextFromSerializedRichEditorContent(description) : draftPlainText || "—"}
            </Text>
            <View style={{ marginTop: spacing.sm }}>
              <ActionChip label={t("description.add")} onPress={onStartEditing} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}
