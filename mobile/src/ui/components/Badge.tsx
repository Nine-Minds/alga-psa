import { Text, View } from "react-native";
import { colors, spacing, typography } from "../theme";

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  const palette = tonePalette[tone];
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: palette.bg,
        borderWidth: 1,
        borderColor: palette.border,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ ...typography.caption, color: palette.text, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

const tonePalette = {
  neutral: { bg: colors.card, border: colors.border, text: colors.text },
  info: { bg: "#DBEAFE", border: "#93C5FD", text: "#1E3A8A" },
  success: { bg: "#DCFCE7", border: "#86EFAC", text: "#14532D" },
  warning: { bg: "#FFEDD5", border: "#FDBA74", text: "#7C2D12" },
  danger: { bg: "#FEE2E2", border: "#FCA5A5", text: "#7F1D1D" },
} as const;

