import { useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";
import { getAppConfig } from "../config/appConfig";
import { logger } from "../logging/logger";
import { colors, spacing, typography } from "../ui/theme";
import { t } from "../i18n/i18n";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { buildWebSignInUrl, createPendingMobileAuth, getAuthCallbackRedirectUri } from "../auth/mobileAuth";

export function SignInScreen() {
  const config = useMemo(() => getAppConfig(), []);
  const [status, setStatus] = useState<"idle" | "opening">("idle");
  const [error, setError] = useState<string | null>(null);

  const baseUrl = config.ok ? config.baseUrl : null;

  const onSignIn = async () => {
    if (!baseUrl) {
      setError("Missing configuration. Please set EXPO_PUBLIC_ALGA_BASE_URL.");
      return;
    }
    setError(null);
    setStatus("opening");
    try {
      const pending = await createPendingMobileAuth();
      const redirectUri = getAuthCallbackRedirectUri();
      const loginUrl = buildWebSignInUrl({ baseUrl, redirectUri, state: pending.state });

      const canOpen = await Linking.canOpenURL(loginUrl);
      if (!canOpen) {
        setError("Unable to open browser for sign-in.");
        return;
      }
      await Linking.openURL(loginUrl);
    } catch (e) {
      logger.error("Failed to open sign-in URL", { error: e });
      setError("Failed to open browser. Please try again.");
    } finally {
      setStatus("idle");
    }
  };

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
        Sign in using your Alga hosted account. We’ll open the system browser to complete login.
      </Text>

      <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
        <PrimaryButton
          onPress={() => void onSignIn()}
          disabled={status === "opening" || !baseUrl}
          accessibilityLabel={t("auth.signIn.cta")}
          accessibilityHint="Opens the browser to complete sign-in."
        >
          {status === "opening" ? t("auth.signIn.opening") : t("auth.signIn.cta")}
        </PrimaryButton>
      </View>

      {baseUrl ? (
        <Text
          style={{
            ...typography.caption,
            marginTop: spacing.md,
            textAlign: "center",
            color: colors.mutedText,
          }}
        >
          {baseUrl}
        </Text>
      ) : null}

      {error ? (
        <Text
          style={{
            ...typography.body,
            marginTop: spacing.md,
            textAlign: "center",
            color: colors.danger,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
