import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { hitSlop } from "../a11y";

export function IconButton({
  icon,
  onPress,
  disabled = false,
  size = 44,
  accessibilityLabel,
}: {
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop}
      style={({ pressed }) => ({
        width: Math.max(size, 44),
        height: Math.max(size, 44),
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed && !disabled ? 0.5 : disabled ? 0.3 : 1,
      })}
    >
      {icon}
    </Pressable>
  );
}
