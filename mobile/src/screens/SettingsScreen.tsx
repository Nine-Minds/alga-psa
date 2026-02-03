import { Text, View } from "react-native";
import { colors, spacing, typography } from "../ui/theme";

export function SettingsScreen() {
  return (
    <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
      <Text style={{ ...typography.title, marginBottom: spacing.sm, color: colors.text }}>
        Settings (placeholder)
      </Text>
      <Text style={{ ...typography.body, color: colors.mutedText }}>
        Diagnostics and session controls will live here.
      </Text>
    </View>
  );
}
