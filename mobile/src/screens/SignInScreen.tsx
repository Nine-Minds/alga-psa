import { Text, View } from "react-native";
import { colors, spacing, typography } from "../ui/theme";
import { t } from "../i18n/i18n";

export function SignInScreen() {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: spacing.xl,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ ...typography.title, textAlign: "center", color: colors.text }}>
        {t("app.title")}
      </Text>
      <Text style={{ ...typography.body, marginTop: spacing.md, textAlign: "center", color: colors.mutedText }}>
        Sign-in flow is not implemented yet. This screen will launch the system browser to the
        hosted Alga login and handle the deep link callback.
      </Text>
    </View>
  );
}
