import { Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  const theme = useTheme();
  const palette = theme.colors.badge[tone];
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 4,
        borderRadius: theme.borderRadius.full,
        backgroundColor: palette.bg,
        borderWidth: 1,
        borderColor: palette.border,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ ...theme.typography.caption, color: palette.text, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
