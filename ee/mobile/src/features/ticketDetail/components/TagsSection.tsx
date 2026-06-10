import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TicketTag } from "../../../api/tags";
import { Card } from "../../../ui/components/Card";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { useTheme } from "../../../ui/ThemeContext";
import { ActionChip } from "./ActionChip";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function getReadableTextColor(backgroundHex: string): string {
  const r = parseInt(backgroundHex.slice(1, 3), 16);
  const g = parseInt(backgroundHex.slice(3, 5), 16);
  const b = parseInt(backgroundHex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1F2937" : "#FFFFFF";
}

export function getTagChipColors(
  tag: Pick<TicketTag, "background_color" | "text_color">,
  fallback: { bg: string; text: string; border: string },
): { backgroundColor: string; textColor: string; borderColor: string } {
  const background = typeof tag.background_color === "string" && HEX_COLOR.test(tag.background_color)
    ? tag.background_color
    : null;
  if (!background) {
    return { backgroundColor: fallback.bg, textColor: fallback.text, borderColor: fallback.border };
  }
  const text = typeof tag.text_color === "string" && HEX_COLOR.test(tag.text_color)
    ? tag.text_color
    : getReadableTextColor(background);
  return { backgroundColor: background, textColor: text, borderColor: background };
}

export function TagsSection({
  tags,
  loading,
  hidden,
  error,
  actionError,
  updating,
  onAddPress,
  onRemoveTag,
}: {
  tags: TicketTag[];
  loading: boolean;
  hidden: boolean;
  error: string | null;
  actionError: string | null;
  updating: boolean;
  onAddPress: () => void;
  onRemoveTag: (tag: TicketTag) => void;
}) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();

  if (hidden) return null;

  const fallbackChip = colors.badge.neutral;

  return (
    <Card accessibilityLabel={t("tags.title", { defaultValue: "Tags" })}>
      <SectionHeader
        title={t("tags.title", { defaultValue: "Tags" })}
        action={(
          <ActionChip
            label={t("tags.addTag", { defaultValue: "Add tag" })}
            disabled={updating}
            onPress={onAddPress}
          />
        )}
      />

      {error ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}

      {loading ? (
        <View style={{ marginTop: spacing.md, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : tags.length === 0 ? (
        !error ? (
          <Text style={{ ...typography.body, color: colors.textSecondary, marginTop: spacing.md }}>
            {t("tags.empty", { defaultValue: "No tags." })}
          </Text>
        ) : null
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
          {tags.map((tag) => {
            const chip = getTagChipColors(tag, fallbackChip);
            return (
              <View
                key={tag.tag_id}
                accessibilityLabel={t("tags.tagAccessibility", { tag: tag.tag_text, defaultValue: "Tag {{tag}}" })}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: chip.borderColor,
                  backgroundColor: chip.backgroundColor,
                  paddingLeft: spacing.md,
                  paddingRight: spacing.xs,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ ...typography.caption, color: chip.textColor, fontWeight: "600" }}>
                  {tag.tag_text}
                </Text>
                <Pressable
                  onPress={() => onRemoveTag(tag)}
                  disabled={updating}
                  accessibilityRole="button"
                  accessibilityLabel={t("tags.removeTag", { tag: tag.tag_text, defaultValue: "Remove tag {{tag}}" })}
                  hitSlop={8}
                  style={{ marginLeft: spacing.xs, padding: 2, opacity: updating ? 0.5 : 1 }}
                >
                  <Feather name="x" size={14} color={chip.textColor} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {actionError ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
          {actionError}
        </Text>
      ) : null}
    </Card>
  );
}
