import { Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";

type Props = NativeStackScreenProps<RootStackParamList, "ClientDetail">;

export function ClientDetailScreen({ route }: Props) {
  const { t } = useTranslation("clients");
  const theme = useTheme();
  const { clientId, clientName } = route.params;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg }}>
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
        {clientName ?? t("detail.title", { defaultValue: "Client" })}
      </Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
        {t("detail.comingSoon", { defaultValue: "Client details will show up here soon." })}
      </Text>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
        {clientId}
      </Text>
    </View>
  );
}
