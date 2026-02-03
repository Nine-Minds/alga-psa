import { Platform, Text, View } from "react-native";
import * as Application from "expo-application";
import { getAppConfig } from "../config/appConfig";
import { colors, spacing, typography } from "../ui/theme";

export function SettingsScreen() {
  const config = getAppConfig();
  const version = Application.nativeApplicationVersion ?? "unknown";
  const build = Application.nativeBuildVersion ?? "unknown";

  return (
    <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
      <Text style={{ ...typography.title, marginBottom: spacing.sm, color: colors.text }}>
        Settings
      </Text>

      <View style={{ marginTop: spacing.lg }}>
        <Row label="App version" value={`${version} (${build})`} />
        <View style={{ height: spacing.sm }} />
        <Row label="Platform" value={`${Platform.OS}`} />
        <View style={{ height: spacing.sm }} />
        <Row label="Environment" value={config.ok ? config.env : "invalid"} />
        <View style={{ height: spacing.sm }} />
        <Row label="Base URL" value={config.ok ? config.baseUrl : "missing"} />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
      }}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={{ ...typography.caption, color: colors.mutedText }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}
