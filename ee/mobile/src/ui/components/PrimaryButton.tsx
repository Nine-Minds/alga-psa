import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { hitSlop } from "../a11y";
import { useTheme } from "../ThemeContext";

export function PrimaryButton({
  children,
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityHint,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={hitSlop}
      style={({ pressed }) => ({
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: disabled ? theme.colors.border : theme.colors.primary,
        borderRadius: 10,
        opacity: pressed && !disabled ? 0.9 : 1,
        alignSelf: "center",
      })}
    >
      <Text style={{ ...theme.typography.body, color: disabled ? theme.colors.textSecondary : theme.colors.textInverse, fontWeight: "600" }}>
        {children}
      </Text>
    </Pressable>
  );
}
