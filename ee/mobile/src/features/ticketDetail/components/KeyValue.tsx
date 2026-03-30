import React from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../../ui/ThemeContext";

export function KeyValue({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  const { colors, spacing, typography } = useTheme();
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
      <Text style={{ ...typography.caption, color: colors.textSecondary }}>{label}</Text>
      {typeof value === "string" ? (
        <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{value}</Text>
      ) : (
        <View style={{ marginTop: 2 }}>{value}</View>
      )}
      {children}
    </View>
  );
}
