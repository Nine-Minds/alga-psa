import { useState } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { deleteAccount } from "../api/iap";
import { useAuth } from "../auth/AuthContext";
import { logger } from "../logging/logger";

/**
 * Account deletion screen. Required by App Store guideline 5.1.1(v): any
 * app with in-app account creation must also offer in-app account deletion.
 *
 * UX is deliberately heavy — confirmation dialog + explicit destructive
 * button + explanation of what will happen — because deletion is
 * irreversible and may tear down an entire IAP-provisioned tenant.
 */
export function AccountDeletionScreen() {
  const { t } = useTranslation("settings");
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const { session, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performDelete = async () => {
    setError(null);
    const config = getAppConfig();
    if (!config.ok || !session) {
      setError(t("accountDelete.errors.notSignedIn", "You must be signed in to delete your account."));
      return;
    }

    setBusy(true);
    try {
      const client = createApiClient({
        baseUrl: config.baseUrl,
        getAccessToken: () => session.accessToken,
        getTenantId: () => session.tenantId,
        getUserAgentTag: () => `mobile/${Platform.OS}/account-delete`,
      });
      const result = await deleteAccount(client);
      if (!result.ok) {
        setError(t("accountDelete.errors.failed", "Unable to delete your account. Please try again."));
        setBusy(false);
        return;
      }

      const instructions =
        result.data.subscriptionCancellationInstructions ??
        t(
          "accountDelete.cancelInstructions",
          "To stop future Apple charges, open Settings > Apple ID > Subscriptions and cancel AlgaPSA.",
        );

      Alert.alert(
        t("accountDelete.successTitle", "Account deleted"),
        instructions,
        [
          {
            text: t("common:ok", "OK"),
            onPress: () => {
              void (async () => {
                try {
                  await logout();
                } catch (e) {
                  logger.warn("Logout after deletion failed", { error: e });
                } finally {
                  navigation.reset({ index: 0, routes: [{ name: "SignIn" }] });
                }
              })();
            },
          },
        ],
        { cancelable: false },
      );
    } catch (e) {
      logger.error("deleteAccount threw", { error: e });
      setError(t("accountDelete.errors.failed", "Unable to delete your account. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const onDeletePress = () => {
    Alert.alert(
      t("accountDelete.confirmTitle", "Delete your account?"),
      t(
        "accountDelete.confirmMessage",
        "This will permanently delete your user account. If you're on a Solo plan, your workspace and all its data will also be deleted. This cannot be undone.",
      ),
      [
        { text: t("common:cancel", "Cancel"), style: "cancel" },
        {
          text: t("accountDelete.confirmButton", "Delete account"),
          style: "destructive",
          onPress: () => void performDelete(),
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.xl }}
    >
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
        {t("accountDelete.title", "Delete Account")}
      </Text>

      <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, marginTop: theme.spacing.md }}>
        {t(
          "accountDelete.body",
          "Deleting your account removes your user from AlgaPSA. If you're on a Solo plan, your workspace and all its data — clients, tickets, invoices, time entries — will also be deleted. This cannot be undone.",
        )}
      </Text>

      <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, marginTop: theme.spacing.md }}>
        {t(
          "accountDelete.appleNote",
          "Note: deleting your account here does NOT automatically cancel your Apple subscription. To stop future charges, open Settings on your iPhone → your name → Subscriptions → AlgaPSA → Cancel Subscription.",
        )}
      </Text>

      {error ? (
        <Text
          style={{
            ...theme.typography.body,
            color: theme.colors.danger,
            marginTop: theme.spacing.md,
          }}
        >
          {error}
        </Text>
      ) : null}

      <View style={{ marginTop: theme.spacing.xl }}>
        <PrimaryButton
          onPress={onDeletePress}
          disabled={busy || !session}
          accessibilityLabel={t("accountDelete.confirmButton", "Delete account")}
        >
          {busy ? t("accountDelete.deleting", "Deleting…") : t("accountDelete.confirmButton", "Delete account")}
        </PrimaryButton>
      </View>
    </ScrollView>
  );
}
