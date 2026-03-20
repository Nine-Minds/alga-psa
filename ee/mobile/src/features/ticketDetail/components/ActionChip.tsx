import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useTheme } from "../../../ui/ThemeContext";

export function ActionChip({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors, spacing, typography } = useTheme();
  const isDisabled = Boolean(disabled || loading);
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        opacity: isDisabled ? 0.6 : pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {loading ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
        <Text style={{ ...typography.caption, color: colors.text, fontWeight: "600", marginLeft: loading ? spacing.sm : 0 }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
