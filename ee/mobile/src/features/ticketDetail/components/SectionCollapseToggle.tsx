import React from "react";
import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";

export function SectionCollapseToggle({
  collapsed,
  onToggle,
  summary,
  sectionLabel,
}: {
  collapsed: boolean;
  onToggle: () => void;
  summary?: string | null;
  sectionLabel?: string;
}) {
  const { t } = useTranslation("common");
  const { colors, spacing, typography } = useTheme();
  const label = collapsed ? t("expand") : t("collapse");
  const accessibilityLabel = sectionLabel ? `${label} ${sectionLabel}` : label;

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {summary ? (
        <View
          style={{
            paddingHorizontal: spacing.sm,
            paddingVertical: 3,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>{summary}</Text>
        </View>
      ) : null}
      <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>{label}</Text>
      <Feather name={collapsed ? "chevron-down" : "chevron-up"} size={14} color={colors.primary} />
    </Pressable>
  );
}
