import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getAppConfig } from "../config/appConfig";
import { logger } from "../logging/logger";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { buildWebSignInUrl, createPendingMobileAuth, getAuthCallbackRedirectUri, parseAuthCallback } from "../auth/mobileAuth";
import {
  AppleSignInCancelledError,
  AppleSignInUnavailableError,
  isAppleSignInAvailable,
  signInWithApple,
} from "../auth/appleSignIn";
import { createApiClient } from "../api";
import { getAuthCapabilities, type MobileAuthCapabilities } from "../api/mobileAuth";
import { signInWithAppleOnServer } from "../api/appleAuth";
import { analytics } from "../analytics/analytics";
import { MobileAnalyticsEvents } from "../analytics/events";
import type { RootStackParamList } from "../navigation/types";

export function SignInScreen() {
  const { t } = useTranslation("auth");
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const config = useMemo(() => getAppConfig(), []);
  const [status, setStatus] = useState<"idle" | "opening" | "apple">("idle");
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<MobileAuthCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let active = true;
    void isAppleSignInAvailable().then((available) => {
      if (active) setAppleAvailable(available);
    });
    return () => {
      active = false;
    };
  }, []);

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

  const hasConfiguredSsoProvider = useMemo(() => {
    const providers = capabilities?.providers;
    if (!providers) return true;
    return Boolean(providers.microsoft || providers.google);
  }, [capabilities?.providers]);

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
        setCapabilitiesError(t("signIn.errors.verifySupport"));
        setCapabilities(null);
        return;
      }

      setCapabilities(result.data);
    } catch {
      setCapabilitiesError(t("signIn.errors.verifySupport"));
      setCapabilities(null);
    } finally {
      setCapabilitiesLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void fetchCapabilities();
  }, [fetchCapabilities]);

  const onAppleSignIn = async () => {
    if (!baseUrl) {
      setError(t("signIn.errors.missingConfig"));
      return;
    }
    if (!hostAllowed) {
      setError(t("signIn.errors.hostNotAllowed"));
      return;
    }
    setError(null);
    setStatus("apple");
    try {
      analytics.trackEvent(MobileAnalyticsEvents.authAppleStart);
      const credential = await signInWithApple();
      const pending = await createPendingMobileAuth();

      const client = createApiClient({
        baseUrl,
        getUserAgentTag: () => `mobile/${Platform.OS}/apple-signin`,
      });
      const result = await signInWithAppleOnServer(client, {
        identityToken: credential.identityToken,
        authorizationCode: credential.authorizationCode ?? undefined,
        firstName: credential.fullName?.givenName ?? undefined,
        lastName: credential.fullName?.familyName ?? undefined,
        state: pending.state,
      });

      if (!result.ok) {
        if (result.status === 404) {
          analytics.trackEvent(MobileAnalyticsEvents.authAppleNoAccount);
          setError(t("signIn.errors.appleNoAccount"));
        } else {
          analytics.trackEvent(MobileAnalyticsEvents.authAppleFailed, {
            status: result.status ?? null,
            errorKind: result.error.kind,
          });
          setError(t("signIn.errors.appleFailed"));
        }
        return;
      }

      analytics.trackEvent(MobileAnalyticsEvents.authAppleSucceeded);
      navigation.navigate("AuthCallback", {
        ott: result.data.ott,
        state: pending.state,
      });
    } catch (e) {
      if (e instanceof AppleSignInCancelledError) {
        analytics.trackEvent(MobileAnalyticsEvents.authAppleCancelled);
        return;
      }
      if (e instanceof AppleSignInUnavailableError) {
        setAppleAvailable(false);
        return;
      }
      logger.error("Apple sign-in failed", { error: e });
      analytics.trackEvent(MobileAnalyticsEvents.authAppleFailed, { reason: "exception" });
      setError(t("signIn.errors.appleFailed"));
    } finally {
      setStatus("idle");
    }
  };

  const onSignIn = async () => {
    if (!baseUrl) {
      analytics.trackEvent(MobileAnalyticsEvents.authSignInBlocked, { reason: "missing_base_url" });
      setError(t("signIn.errors.missingConfig"));
      return;
    }
    if (!hostAllowed) {
      analytics.trackEvent(MobileAnalyticsEvents.authSignInBlocked, { reason: "host_not_allowlisted" });
      setError(t("signIn.errors.hostNotAllowed"));
      return;
    }
    setError(null);
    setStatus("opening");
    try {
      analytics.trackEvent(MobileAnalyticsEvents.authSignInStart);
      const pending = await createPendingMobileAuth();
      const redirectUri = getAuthCallbackRedirectUri();
      const loginUrl = buildWebSignInUrl({ baseUrl, redirectUri, state: pending.state });

      const result = await WebBrowser.openAuthSessionAsync(loginUrl, redirectUri);
      if (result.type === "success") {
        analytics.trackEvent(MobileAnalyticsEvents.authSignInOpenedBrowser);
        const parsed = parseAuthCallback(result.url);
        navigation.navigate("AuthCallback", {
          ott: parsed.ott,
          state: parsed.state,
          error: parsed.error,
        });
      } else {
        // User cancelled or dismissed the in-app browser
        analytics.trackEvent(MobileAnalyticsEvents.authSignInOpenFailed, { reason: "user_cancelled" });
      }
    } catch (e) {
      logger.error("Failed to open sign-in URL", { error: e });
      analytics.trackEvent(MobileAnalyticsEvents.authSignInOpenFailed, { reason: "exception" });
      setError(t("signIn.errors.failedOpenBrowser"));
    } finally {
      setStatus("idle");
    }
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: theme.spacing.xl,
        backgroundColor: theme.colors.background,
      }}
    >
      <Text style={{ ...theme.typography.title, textAlign: "center", color: theme.colors.text }}>
        {t("common:appTitle")}
      </Text>
      <Text style={{ ...theme.typography.body, marginTop: theme.spacing.md, textAlign: "center", color: theme.colors.textSecondary }}>
        {t("signIn.subtitle")}
      </Text>

      <View style={{ marginTop: theme.spacing.lg, alignItems: "center" }}>
        <PrimaryButton
          onPress={() => void onSignIn()}
          disabled={
            status !== "idle" ||
            !baseUrl ||
            !hostAllowed
          }
          accessibilityLabel={t("signIn.cta")}
          accessibilityHint={t("signIn.accessibilityHint")}
        >
          {status === "opening" ? t("signIn.opening") : t("signIn.cta")}
        </PrimaryButton>
      </View>

      {Platform.OS === "ios" && appleAvailable ? (
        <View style={{ marginTop: theme.spacing.md, alignItems: "center" }}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={
              theme.colors.background === "#000000" || theme.colors.background?.toLowerCase?.() === "#000"
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={8}
            style={{
              width: 260,
              height: 44,
              opacity: status === "idle" && baseUrl && hostAllowed ? 1 : 0.5,
            }}
            onPress={() => {
              if (status !== "idle" || !baseUrl || !hostAllowed) return;
              void onAppleSignIn();
            }}
          />
          {status === "apple" ? (
            <Text
              style={{
                ...theme.typography.caption,
                marginTop: theme.spacing.sm,
                textAlign: "center",
                color: theme.colors.textSecondary,
              }}
            >
              {t("signIn.appleSigningIn")}
            </Text>
          ) : null}
        </View>
      ) : null}

      {Platform.OS === "ios" ? (
        <View style={{ marginTop: theme.spacing.md, alignItems: "center" }}>
          <Text
            onPress={() => navigation.navigate("CreateWorkspace")}
            accessibilityRole="button"
            accessibilityLabel={t("signIn.createWorkspace", "Create a new workspace")}
            style={{
              ...theme.typography.body,
              color: theme.colors.secondary,
              paddingVertical: theme.spacing.sm,
            }}
          >
            {t("signIn.createWorkspace", "Create a new workspace")}
          </Text>
        </View>
      ) : null}

      {baseUrl ? (
        <Text
          style={{
            ...theme.typography.caption,
            marginTop: theme.spacing.md,
            textAlign: "center",
            color: theme.colors.textSecondary,
          }}
        >
          {baseUrl}
        </Text>
      ) : null}

      {error ? (
        <Text
          style={{
            ...theme.typography.body,
            marginTop: theme.spacing.md,
            textAlign: "center",
            color: theme.colors.danger,
          }}
        >
          {error}
        </Text>
      ) : null}

      {capabilitiesLoading ? (
        <Text style={{ ...theme.typography.caption, marginTop: theme.spacing.md, textAlign: "center", color: theme.colors.textSecondary }}>
          {t("signIn.checkingServer")}
        </Text>
      ) : capabilitiesError ? (
        <View style={{ marginTop: theme.spacing.md, alignItems: "center" }}>
          <Text style={{ ...theme.typography.caption, textAlign: "center", color: theme.colors.textSecondary }}>
            {capabilitiesError}
          </Text>
          <View style={{ height: theme.spacing.md }} />
          <PrimaryButton onPress={() => void fetchCapabilities()} disabled={capabilitiesLoading}>
            {t("common:retry")}
          </PrimaryButton>
        </View>
      ) : capabilities && !hostAllowed ? (
        <Text style={{ ...theme.typography.caption, marginTop: theme.spacing.md, textAlign: "center", color: theme.colors.danger }}>
          {t("signIn.errors.domainNotAllowed")}
        </Text>
      ) : capabilities && !hasConfiguredSsoProvider ? (
        <Text style={{ ...theme.typography.caption, marginTop: theme.spacing.md, textAlign: "center", color: theme.colors.textSecondary }}>
          {t("signIn.errors.ssoNotConfigured")}
        </Text>
      ) : null}
    </View>
  );
}
