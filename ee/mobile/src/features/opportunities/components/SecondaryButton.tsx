import React, { type ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { hitSlop } from "../../../ui/a11y";
import { useTheme } from "../../../ui/ThemeContext";

export function SecondaryButton({
  children,
  onPress,
  disabled,
  tone = "neutral",
  testID,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const danger = tone === "danger";
  const textColor = danger ? theme.colors.danger : theme.colors.text;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop}
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: danger ? theme.colors.danger : theme.colors.border,
        backgroundColor: theme.colors.card,
        alignItems: "center",
        opacity: disabled ? 0.5 : pressed ? 0.9 : 1,
      })}
    >
      <Text style={{ ...theme.typography.body, color: disabled ? theme.colors.textSecondary : textColor, fontWeight: "600" }}>
        {children}
      </Text>
    </Pressable>
  );
}
