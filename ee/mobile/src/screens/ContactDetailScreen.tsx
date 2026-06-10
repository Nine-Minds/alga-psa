import { Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";

type Props = NativeStackScreenProps<RootStackParamList, "ContactDetail">;

export function ContactDetailScreen({ route }: Props) {
  const { t } = useTranslation("contacts");
  const theme = useTheme();
  const { contactId, contactName } = route.params;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg }}>
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
        {contactName ?? t("detail.title", { defaultValue: "Contact" })}
      </Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
        {t("detail.comingSoon", { defaultValue: "Contact details will show up here soon." })}
      </Text>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
        {contactId}
      </Text>
    </View>
  );
}
