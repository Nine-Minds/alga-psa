import { Pressable, Text } from "react-native";
import { useTheme } from "../ThemeContext";

/** A toggleable pill for inline filter rows. */
export function FilterChip({
  label,
  selected = false,
  count,
  onPress,
  testID,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  count?: number;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const text = typeof count === "number" ? `${label} · ${count}` : label;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? text}
      style={({ pressed }) => ({
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 6,
        borderRadius: theme.borderRadius.full,
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected ? theme.colors.primaryLight : theme.colors.card,
        opacity: pressed ? 0.95 : 1,
      })}
    >
      <Text
        style={{
          ...theme.typography.caption,
          color: selected ? theme.colors.primaryDark : theme.colors.text,
          fontWeight: selected ? "700" : "600",
        }}
        numberOfLines={1}
      >
        {text}
      </Text>
    </Pressable>
  );
}
