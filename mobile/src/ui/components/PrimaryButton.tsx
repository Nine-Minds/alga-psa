import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { hitSlop } from "../a11y";
import { colors, spacing, typography } from "../theme";

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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={hitSlop}
      style={({ pressed }) => ({
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: disabled ? colors.border : colors.primary,
        borderRadius: 10,
        opacity: pressed && !disabled ? 0.9 : 1,
        alignSelf: "flex-start",
      })}
    >
      <Text style={{ ...typography.body, color: disabled ? colors.mutedText : colors.primaryText, fontWeight: "600" }}>
        {children}
      </Text>
    </Pressable>
  );
}
