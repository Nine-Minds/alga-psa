import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { getAppConfig } from "../config/appConfig";
import { logger } from "../logging/logger";
import { colors, spacing, typography } from "../ui/theme";
import { t } from "../i18n/i18n";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { buildWebSignInUrl, createPendingMobileAuth, getAuthCallbackRedirectUri } from "../auth/mobileAuth";
import { createApiClient } from "../api";
import { getAuthCapabilities, type MobileAuthCapabilities } from "../api/mobileAuth";
import { analytics } from "../analytics/analytics";

export function SignInScreen() {
  const config = useMemo(() => getAppConfig(), []);
  const [status, setStatus] = useState<"idle" | "opening">("idle");
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<MobileAuthCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);

  const baseUrl = config.ok ? config.baseUrl : null;
  const baseHost = useMemo(() => {
    if (!baseUrl) return null;
    try {
      return new URL(baseUrl).hostname.toLowerCase();
    } catch {
      return null;
    }
  }, [baseUrl]);

  const hostAllowed = useMemo(() => {
    const allowlist = capabilities?.hostedDomainAllowlist;
    if (!allowlist || allowlist.length === 0) return true;
    if (!baseHost) return false;
    return allowlist.map((h) => h.toLowerCase()).includes(baseHost);
  }, [baseHost, capabilities?.hostedDomainAllowlist]);

  const fetchCapabilities = useCallback(async () => {
    if (!baseUrl) return;
    setCapabilitiesLoading(true);
    setCapabilitiesError(null);
    try {
      const client = createApiClient({
        baseUrl,
        getUserAgentTag: () => `mobile/${Platform.OS}`,
      });
      const result = await getAuthCapabilities(client);

      if (!result.ok) {
        setCapabilitiesError("Unable to verify mobile sign-in support on this server.");
        setCapabilities(null);
        return;
      }

      setCapabilities(result.data);
    } catch {
      setCapabilitiesError("Unable to verify mobile sign-in support on this server.");
      setCapabilities(null);
    } finally {
      setCapabilitiesLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void fetchCapabilities();
  }, [fetchCapabilities]);

  const onSignIn = async () => {
    if (!baseUrl) {
      analytics.trackEvent("auth.sign_in.blocked", { reason: "missing_base_url" });
      setError("Missing configuration. Please set EXPO_PUBLIC_ALGA_BASE_URL.");
      return;
    }
    if (capabilities && !capabilities.mobileEnabled) {
      analytics.trackEvent("auth.sign_in.blocked", { reason: "mobile_disabled" });
      setError("Mobile sign-in is not enabled for this server.");
      return;
    }
    if (!hostAllowed) {
      analytics.trackEvent("auth.sign_in.blocked", { reason: "host_not_allowlisted" });
      setError("This base URL is not allowed for mobile sign-in.");
      return;
    }
    setError(null);
    setStatus("opening");
    try {
      analytics.trackEvent("auth.sign_in.start");
      const pending = await createPendingMobileAuth();
      const redirectUri = getAuthCallbackRedirectUri();
      const loginUrl = buildWebSignInUrl({ baseUrl, redirectUri, state: pending.state });

      const canOpen = await Linking.canOpenURL(loginUrl);
      if (!canOpen) {
        analytics.trackEvent("auth.sign_in.open_failed", { reason: "cannot_open_url" });
        setError("Unable to open browser for sign-in.");
        return;
      }
      await Linking.openURL(loginUrl);
      analytics.trackEvent("auth.sign_in.opened_browser");
    } catch (e) {
      logger.error("Failed to open sign-in URL", { error: e });
      analytics.trackEvent("auth.sign_in.open_failed", { reason: "exception" });
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
          disabled={
            status === "opening" ||
            !baseUrl ||
            (capabilities !== null && !capabilities.mobileEnabled) ||
            !hostAllowed
          }
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

      {capabilitiesLoading ? (
        <Text style={{ ...typography.caption, marginTop: spacing.md, textAlign: "center", color: colors.mutedText }}>
          Checking server sign-in support…
        </Text>
      ) : capabilities && !capabilities.mobileEnabled ? (
        <Text style={{ ...typography.caption, marginTop: spacing.md, textAlign: "center", color: colors.danger }}>
          Mobile sign-in is disabled for this server.
        </Text>
      ) : capabilitiesError ? (
        <View style={{ marginTop: spacing.md, alignItems: "center" }}>
          <Text style={{ ...typography.caption, textAlign: "center", color: colors.mutedText }}>
            {capabilitiesError}
          </Text>
          <View style={{ height: spacing.md }} />
          <PrimaryButton onPress={() => void fetchCapabilities()} disabled={capabilitiesLoading}>
            Retry
          </PrimaryButton>
        </View>
      ) : capabilities && !hostAllowed ? (
        <Text style={{ ...typography.caption, marginTop: spacing.md, textAlign: "center", color: colors.danger }}>
          This server domain is not allowed for mobile sign-in.
        </Text>
      ) : null}
    </View>
  );
}
