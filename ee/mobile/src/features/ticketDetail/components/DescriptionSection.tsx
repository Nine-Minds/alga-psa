import React, { useEffect, useState, type RefObject } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TicketDetail } from "../../../api/tickets";
import { useTheme } from "../../../ui/ThemeContext";
import {
  TicketRichTextEditor,
  type TicketRichTextEditorRef,
} from "../../ticketRichText/TicketRichTextEditor";
import type { MentionSuggestionItem } from "../../ticketRichText/MentionSuggestionList";
import {
  extractPlainTextFromRichEditorJson,
  extractPlainTextFromSerializedRichEditorContent,
  isMalformedRichEditorContent,
  serializeRichEditorJson,
} from "../../ticketRichText/helpers";
import { extractDescription } from "../utils";
import type { TicketNotificationSuppressionOptions } from "../../../api/tickets";
import {
  activeTicketNotificationSuppression,
  DEFAULT_TICKET_NOTIFICATION_SUPPRESSION,
  TicketUpdateFooter,
} from "./TicketUpdateFooter";
import { SectionCollapseToggle } from "./SectionCollapseToggle";

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
  onMentionSearch,
  mentionBaseUrl,
  mentionAuthToken,
  initiallyCollapsed = false,
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
  onSave: (notificationSuppression?: TicketNotificationSuppressionOptions) => Promise<boolean | void> | boolean | void;
  onDraftChange: (content: string, plainText: string) => void;
  onMentionSearch?: (query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>;
  mentionBaseUrl?: string | null;
  mentionAuthToken?: string;
  initiallyCollapsed?: boolean;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const description = extractDescription(ticket);

  const DESCRIPTION_COLLAPSED_HEIGHT = 96;
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [suppression, setSuppression] = useState(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const needsExpansion = contentHeight !== null && contentHeight > DESCRIPTION_COLLAPSED_HEIGHT;

  useEffect(() => {
    if (isEditing) {
      setSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
      setCollapsed(false);
    }
  }, [isEditing]);

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
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {saving ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          {!isEditing ? (
            <SectionCollapseToggle
              collapsed={collapsed}
              onToggle={() => setCollapsed((value) => !value)}
              summary={description ? undefined : t("description.empty", "Empty")}
              sectionLabel={t("description.label")}
            />
          ) : null}
        </View>
      </View>
      {collapsed && !isEditing ? null : <View style={{ marginTop: spacing.sm }}>
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
              onMentionSearch={onMentionSearch}
              mentionBaseUrl={mentionBaseUrl}
              mentionAuthToken={mentionAuthToken}
            />
            {error ? (
              <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
                {error}
              </Text>
            ) : null}
            <TicketUpdateFooter
              suppression={suppression}
              onSuppressionChange={setSuppression}
              onCancel={() => {
                onCancelEditing();
                setSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
              }}
              onApply={() => {
                void Promise.resolve(onSave(activeTicketNotificationSuppression(suppression))).then((saved) => {
                  if (saved !== false) setSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
                });
              }}
              applyLabel={t("description.save", "Save description")}
              cancelLabel={t("description.cancel", "Cancel description editing")}
              busy={saving}
            />
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
                onContentHeight={({ height }) => setContentHeight(Math.ceil(height))}
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
      </View>}
    </View>
  );
}
