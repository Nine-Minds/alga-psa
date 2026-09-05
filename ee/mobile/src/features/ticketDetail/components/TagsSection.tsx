import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TicketTag } from "../../../api/tags";
import { Card } from "../../../ui/components/Card";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { useTheme } from "../../../ui/ThemeContext";
import { getTagChipColors } from "../../../ui/tagColors";
import { ActionChip } from "./ActionChip";
import { SectionCollapseToggle } from "./SectionCollapseToggle";

export function TagsSection({
  tags,
  loading,
  hidden,
  error,
  actionError,
  updating,
  onAddPress,
  initiallyCollapsed = false,
}: {
  tags: TicketTag[];
  loading: boolean;
  hidden: boolean;
  error: string | null;
  actionError: string | null;
  updating: boolean;
  onAddPress: () => void;
  initiallyCollapsed?: boolean;
}) {
  const { t } = useTranslation("tickets");
  const { mode, colors, spacing, typography } = useTheme();
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);

  if (hidden) return null;

  return (
    <Card accessibilityLabel={t("tags.title", { defaultValue: "Tags" })}>
      <SectionHeader
        title={t("tags.title", { defaultValue: "Tags" })}
        action={(
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {!collapsed ? (
              <ActionChip
                label={t("tags.editTags", { defaultValue: "Edit tags" })}
                disabled={updating}
                onPress={onAddPress}
              />
            ) : null}
            <SectionCollapseToggle
              collapsed={collapsed}
              onToggle={() => setCollapsed((value) => !value)}
              summary={String(tags.length)}
              sectionLabel={t("tags.title", "Tags")}
            />
          </View>
        )}
      />

      {collapsed ? null : <>
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
            const chip = getTagChipColors(tag, mode);
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
                  paddingHorizontal: spacing.md,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ ...typography.caption, color: chip.textColor, fontWeight: "600" }}>
                  {tag.tag_text}
                </Text>
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
      </>}
    </Card>
  );
}
