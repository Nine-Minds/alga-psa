import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";

export function TimeEntriesScreen() {
  const { t } = useTranslation("timeEntries");
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg }}>
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
        {t("title", { defaultValue: "Time Entries" })}
      </Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
        {t("comingSoon", { defaultValue: "Your time entries will show up here soon." })}
      </Text>
    </View>
  );
}
