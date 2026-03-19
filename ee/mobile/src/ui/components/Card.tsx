import type { ReactNode } from "react";
import type { AccessibilityRole, ViewStyle } from "react-native";
import { View } from "react-native";
import { useTheme } from "../ThemeContext";

export function Card({
  children,
  style,
  elevated = false,
  accessibilityRole,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          backgroundColor: theme.colors.card,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.borderRadius.lg,
          padding: theme.spacing.md,
        },
        elevated ? theme.shadows.md : undefined,
        style,
      ]}
    >
      {children}
    </View>
  );
}
