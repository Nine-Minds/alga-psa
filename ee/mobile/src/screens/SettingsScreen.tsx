import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import * as Application from "expo-application";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { getAppConfig } from "../config/appConfig";
import { useTheme } from "../ui/ThemeContext";
import { authenticateForUnlock, canUseBiometrics, getBiometricGateEnabled, setBiometricGateEnabled } from "../auth/biometricGate";
import { useAuth } from "../auth/AuthContext";
import { clearTicketsCache } from "../cache/ticketsCache";
import { Avatar } from "../ui/components/Avatar";
import { tryBuildHostedPathUrl } from "../urls/hostedUrls";
import { getHideSensitiveNotificationsEnabled, setHideSensitiveNotificationsEnabled } from "../settings/privacyPreferences";
import { formatAppVersion } from "./settingsDiagnostics";
import type { Theme } from "../ui/themes";
import { phase2Features } from "../features/phase2";
import { requestPushPermission, getExpoPushToken } from "../notifications/pushTokenService";
import { registerPushToken, unregisterPushToken } from "../api/pushToken";
import { createApiClient } from "../api";
import { getStableDeviceId } from "../device/clientMetadata";
import { secureStorage, getSecureJson, setSecureJson } from "../storage/secureStorage";
import { getAppleLinkStatus, linkAppleId, unlinkAppleId } from "../api/appleAuth";
import {
  AppleSignInCancelledError,
  AppleSignInUnavailableError,
  isAppleSignInAvailable,
  signInWithApple,
} from "../auth/appleSignIn";
import { logger } from "../logging/logger";

export function SettingsScreen() {
  const { t } = useTranslation("settings");
  const theme = useTheme();
  const config = getAppConfig();
  const navigation = useNavigation<any>();
  const { session, logout } = useAuth();
  const version = Application.nativeApplicationVersion ?? t("common:unknown");
  const build = Application.nativeBuildVersion ?? t("common:unknown");
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [hideSensitiveEnabled, setHideSensitiveEnabled] = useState(false);
  const [hideSensitiveBusy, setHideSensitiveBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [appleSupported, setAppleSupported] = useState(false);
  const [appleLinked, setAppleLinked] = useState<boolean | null>(null);
  const [appleBusy, setAppleBusy] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      const [enabled, available, hideSensitive, storedPushToken] = await Promise.all([
        getBiometricGateEnabled(),
        canUseBiometrics(),
        getHideSensitiveNotificationsEnabled(),
        getSecureJson<string>("alga.mobile.push.registeredToken"),
      ]);
      if (canceled) return;
      setBiometricEnabled(enabled);
      setBiometricAvailable(available);
      setHideSensitiveEnabled(hideSensitive);
      setPushEnabled(Boolean(storedPushToken));
    };
    void run();
    return () => {
      canceled = true;
    };
  }, []);

  // Apple ID linking (iOS only) — fetch current state on mount, and whenever
  // the session changes (sign-in / sign-out).
  useEffect(() => {
    if (Platform.OS !== "ios" || !session || !config.ok) return;
    let canceled = false;
    const controller = new AbortController();

    void (async () => {
      const available = await isAppleSignInAvailable();
      if (canceled) return;
      setAppleSupported(available);
      if (!available) return;

      try {
        const client = createApiClient({
          baseUrl: config.baseUrl,
          getAccessToken: () => session.accessToken,
          getTenantId: () => session.tenantId,
          getUserAgentTag: () => `mobile/${Platform.OS}/apple-link`,
        });
        const result = await getAppleLinkStatus(client, controller.signal);
        if (canceled || controller.signal.aborted) return;
        if (result.ok) setAppleLinked(result.data.linked);
      } catch (e) {
        if (!canceled) logger.warn("Apple link status fetch failed", { error: e });
      }
    })();

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [session, config.ok, config.ok ? config.baseUrl : null]);

  const toggleAppleLink = async () => {
    if (appleBusy || !session || !config.ok) return;
    setAppleError(null);

    // Unlink path
    if (appleLinked) {
      Alert.alert(
        t("security.appleId.disconnectTitle", "Disconnect Apple ID?"),
        t(
          "security.appleId.disconnectBody",
          "You'll no longer be able to use Sign in with Apple for this account.",
        ),
        [
          { text: t("common:cancel"), style: "cancel" },
          {
            text: t("security.appleId.disconnectConfirm", "Disconnect"),
            style: "destructive",
            onPress: () => {
              void (async () => {
                setAppleBusy(true);
                try {
                  const client = createApiClient({
                    baseUrl: config.baseUrl,
                    getAccessToken: () => session.accessToken,
                    getTenantId: () => session.tenantId,
                    getUserAgentTag: () => `mobile/${Platform.OS}/apple-unlink`,
                  });
                  const result = await unlinkAppleId(client);
                  if (!result.ok) {
                    setAppleError(t("security.appleId.errors.unlinkFailed", "Unable to disconnect your Apple ID. Please try again."));
                  } else {
                    setAppleLinked(false);
                  }
                } catch (e) {
                  logger.error("Apple unlink threw", { error: e });
                  setAppleError(t("security.appleId.errors.unlinkFailed", "Unable to disconnect your Apple ID. Please try again."));
                } finally {
                  setAppleBusy(false);
                }
              })();
            },
          },
        ],
      );
      return;
    }

    // Link path
    setAppleBusy(true);
    try {
      const credential = await signInWithApple();
      const client = createApiClient({
        baseUrl: config.baseUrl,
        getAccessToken: () => session.accessToken,
        getTenantId: () => session.tenantId,
        getUserAgentTag: () => `mobile/${Platform.OS}/apple-link`,
      });
      const result = await linkAppleId(client, {
        identityToken: credential.identityToken,
        authorizationCode: credential.authorizationCode ?? undefined,
      });
      if (!result.ok) {
        if (result.status === 409) {
          setAppleError(
            t(
              "security.appleId.errors.alreadyLinkedElsewhere",
              "This Apple ID is already linked to a different AlgaPSA account.",
            ),
          );
        } else {
          setAppleError(t("security.appleId.errors.linkFailed", "Unable to link your Apple ID. Please try again."));
        }
        return;
      }
      setAppleLinked(true);
      Alert.alert(
        t("security.appleId.linkedTitle", "Apple ID connected"),
        t(
          "security.appleId.linkedBody",
          "You can now use Sign in with Apple to sign into this account.",
        ),
        [{ text: t("common:ok") }],
      );
    } catch (e) {
      if (e instanceof AppleSignInCancelledError) return;
      if (e instanceof AppleSignInUnavailableError) {
        setAppleSupported(false);
        return;
      }
      logger.error("Apple link threw", { error: e });
      setAppleError(t("security.appleId.errors.linkFailed", "Unable to link your Apple ID. Please try again."));
    } finally {
      setAppleBusy(false);
    }
  };

  const toggleBiometric = async () => {
    if (biometricBusy) return;
    setBiometricBusy(true);
    setBiometricError(null);
    try {
      if (biometricEnabled) {
        await setBiometricGateEnabled(false);
        setBiometricEnabled(false);
        return;
      }

      const available = biometricAvailable ?? (await canUseBiometrics());
      setBiometricAvailable(available);
      if (!available) {
        setBiometricError(t("security.biometricNotSetUp"));
        return;
      }

      const auth = await authenticateForUnlock();
      if (!auth.ok) {
        setBiometricError(auth.reason);
        return;
      }

      await setBiometricGateEnabled(true);
      setBiometricEnabled(true);
    } finally {
      setBiometricBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.lg }}>
      <View>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>
          {t("sections.account")}
        </Text>
        {session ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing.md }}>
            <Avatar
              name={session.user?.name ?? session.user?.email ?? undefined}
              imageUri={session.user?.avatarUrl && config.ok ? `${config.baseUrl}${session.user.avatarUrl}` : undefined}
              authToken={session.accessToken}
              size="lg"
            />
            <View style={{ marginLeft: theme.spacing.md, flex: 1 }}>
              <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>
                {session.user?.name ?? session.user?.email ?? "—"}
              </Text>
              {session.user?.name && session.user?.email ? (
                <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                  {session.user.email}
                </Text>
              ) : null}
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                {session.tenantId ?? "—"}
              </Text>
            </View>
          </View>
        ) : null}
        <Pressable
          onPress={() => {
            Alert.alert(t("account.signOutConfirmTitle"), t("account.signOutConfirmMessage"), [
              { text: t("common:cancel"), style: "cancel" },
              {
                text: t("account.signOut"),
                style: "destructive",
                onPress: () => {
                  void (async () => {
                    if (logoutBusy) return;
                    setLogoutBusy(true);
                    try {
                      await logout();
                    } catch {
                      Alert.alert(t("account.signOutFailed"), t("account.signOutFailedMessage"));
                    } finally {
                      setLogoutBusy(false);
                    }
                  })();
                },
              },
            ]);
          }}
          disabled={logoutBusy || !session}
          accessibilityRole="button"
          accessibilityLabel={t("account.signOut")}
          style={({ pressed }) => ({
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            backgroundColor: theme.colors.card,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.borderRadius.md,
            alignItems: "center",
            opacity: pressed ? 0.9 : logoutBusy || !session ? 0.5 : 1,
          })}
        >
          <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }}>
            {logoutBusy ? t("account.signingOut") : t("account.signOut")}
          </Text>
        </Pressable>

        <View style={{ height: theme.spacing.sm }} />

        <Pressable
          onPress={() => navigation.navigate("MutedUsers")}
          disabled={!session}
          accessibilityRole="button"
          accessibilityLabel={t("mutedUsers.title", "Muted users")}
          style={({ pressed }) => ({
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            backgroundColor: theme.colors.card,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.borderRadius.md,
            alignItems: "center",
            opacity: pressed ? 0.9 : !session ? 0.5 : 1,
          })}
        >
          <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }}>
            {t("mutedUsers.title", "Muted users")}
          </Text>
        </Pressable>

        <View style={{ height: theme.spacing.sm }} />

        <Pressable
          onPress={() => navigation.navigate("AccountDeletion")}
          disabled={!session}
          accessibilityRole="button"
          accessibilityLabel={t("accountDelete.title", "Delete Account")}
          style={({ pressed }) => ({
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            backgroundColor: theme.colors.card,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.borderRadius.md,
            alignItems: "center",
            opacity: pressed ? 0.9 : !session ? 0.5 : 1,
          })}
        >
          <Text style={{ ...theme.typography.body, color: theme.colors.danger, fontWeight: "600" }}>
            {t("accountDelete.title", "Delete Account")}
          </Text>
        </Pressable>
      </View>

      <View style={{ marginTop: theme.spacing.lg }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>
          {t("sections.about")}
        </Text>
        <Row theme={theme} label={t("about.appName")} value={formatAppVersion(version, build)} />
        <View style={{ height: theme.spacing.sm }} />
        <Row theme={theme} label={t("about.platform")} value={`${Platform.OS}`} />
        <View style={{ height: theme.spacing.sm }} />
        <Row theme={theme} label={t("about.environment")} value={config.ok ? config.env : t("about.invalid")} />
        <View style={{ height: theme.spacing.sm }} />
        <Row theme={theme} label={t("about.baseUrl")} value={config.ok ? config.baseUrl : t("about.missing")} />
      </View>

      <View style={{ marginTop: theme.spacing.xl }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>
          {t("sections.security")}
        </Text>
        <ToggleRow
          theme={theme}
          label={t("security.biometricLock")}
          value={biometricEnabled ? t("common:on") : t("common:off")}
          disabled={biometricBusy}
          onPress={() => void toggleBiometric()}
        />
        {biometricError ? (
          <Text style={{ ...theme.typography.caption, marginTop: theme.spacing.sm, color: theme.colors.danger }}>
            {biometricError}
          </Text>
        ) : null}

        {Platform.OS === "ios" && appleSupported ? (
          <>
            <View style={{ height: theme.spacing.sm }} />
            <ToggleRow
              theme={theme}
              label={t("security.appleId.label", "Sign in with Apple")}
              value={
                appleBusy
                  ? t("security.appleId.working", "Working…")
                  : appleLinked === null
                    ? t("common:loading")
                    : appleLinked
                      ? t("security.appleId.connected", "Connected — tap to disconnect")
                      : t("security.appleId.notConnected", "Not connected — tap to connect")
              }
              disabled={appleBusy || appleLinked === null}
              onPress={() => void toggleAppleLink()}
            />
            {appleError ? (
              <Text style={{ ...theme.typography.caption, marginTop: theme.spacing.sm, color: theme.colors.danger }}>
                {appleError}
              </Text>
            ) : null}
          </>
        ) : null}

        <View style={{ height: theme.spacing.sm }} />
        <ToggleRow
          theme={theme}
          label={t("security.hideSensitiveNotifications")}
          value={hideSensitiveEnabled ? t("common:on") : t("common:off")}
          disabled={hideSensitiveBusy}
          onPress={() => {
            void (async () => {
              if (hideSensitiveBusy) return;
              setHideSensitiveBusy(true);
              try {
                const next = !hideSensitiveEnabled;
                await setHideSensitiveNotificationsEnabled(next);
                setHideSensitiveEnabled(next);
              } finally {
                setHideSensitiveBusy(false);
              }
            })();
          }}
        />
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
          {t("security.hideSensitiveHint")}
        </Text>
      </View>

      {phase2Features.notifications ? (
        <View style={{ marginTop: theme.spacing.xl }}>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>
            {t("sections.notifications", "Notifications")}
          </Text>
          <ToggleRow
            theme={theme}
            label={t("notifications.pushNotifications", "Push Notifications")}
            value={pushEnabled ? t("common:on") : t("common:off")}
            disabled={pushBusy}
            onPress={() => {
              void (async () => {
                if (pushBusy) return;
                setPushBusy(true);
                try {
                  const appConfig = getAppConfig();
                  if (!appConfig.ok || !session) return;

                  if (pushEnabled) {
                    // Disable: unregister token from server
                    const deviceId = await getStableDeviceId();
                    if (deviceId) {
                      const client = createApiClient({
                        baseUrl: appConfig.baseUrl,
                        getTenantId: () => session.tenantId,
                        getUserAgentTag: () => "mobile/settings",
                      });
                      await unregisterPushToken(client, { deviceId });
                    }
                    await secureStorage.deleteItem("alga.mobile.push.registeredToken");
                    setPushEnabled(false);
                  } else {
                    // Enable: request permission + register
                    const granted = await requestPushPermission();
                    if (!granted) {
                      Alert.alert(
                        t("notifications.permissionDeniedTitle", "Notifications Disabled"),
                        t("notifications.permissionDeniedMessage", "Enable notifications in your device settings to receive ticket alerts."),
                        [
                          { text: t("common:cancel"), style: "cancel" },
                          { text: t("notifications.openSettings", "Open Settings"), onPress: () => void Linking.openSettings() },
                        ],
                      );
                      return;
                    }
                    const [token, deviceId] = await Promise.all([
                      getExpoPushToken(),
                      getStableDeviceId(),
                    ]);
                    if (token && deviceId) {
                      const client = createApiClient({
                        baseUrl: appConfig.baseUrl,
                        getTenantId: () => session.tenantId,
                        getUserAgentTag: () => "mobile/settings",
                      });
                      const result = await registerPushToken(client, {
                        expoPushToken: token,
                        deviceId,
                        platform: Platform.OS,
                        appVersion: Application.nativeApplicationVersion ?? undefined,
                      });
                      if (result.ok) {
                        await setSecureJson("alga.mobile.push.registeredToken", token);
                        setPushEnabled(true);
                      }
                    }
                  }
                } finally {
                  setPushBusy(false);
                }
              })();
            }}
          />
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
            {t("notifications.pushHint", "Receive alerts when tickets are assigned, commented on, or updated.")}
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: theme.spacing.xl }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>
          {t("sections.data")}
        </Text>
        <ToggleRow
          theme={theme}
          label={t("data.clearCache")}
          value={t("common:clear")}
          onPress={() => {
            Alert.alert(
              t("data.clearCacheConfirmTitle"),
              t("data.clearCacheConfirmMessage"),
              [
                { text: t("common:cancel"), style: "cancel" },
                {
                  text: t("common:clear"),
                  style: "destructive",
                  onPress: () => {
                    clearTicketsCache();
                    Alert.alert(t("data.cleared"), t("data.clearedMessage"));
                  },
                },
              ],
            );
          }}
        />
      </View>

      <View style={{ marginTop: theme.spacing.xl }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>
          {t("sections.legal")}
        </Text>
        <LinkRow
          theme={theme}
          label={t("legal.privacyPolicy")}
          onPress={() => {
            const url = tryBuildHostedPathUrl(config.ok ? config.baseUrl : null, "/static/privacy_policy");
            if (url) void Linking.openURL(url);
          }}
        />
        <View style={{ height: theme.spacing.sm }} />
        <LinkRow
          theme={theme}
          label={t("legal.termsOfService")}
          onPress={() => {
            const url = tryBuildHostedPathUrl(config.ok ? config.baseUrl : null, "/static/master_terms");
            if (url) void Linking.openURL(url);
          }}
        />
      </View>
    </ScrollView>
  );
}

function Row({ theme, label, value }: { theme: Theme; label: string; value: string }) {
  return (
    <View
      style={{
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
      }}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function ToggleRow({
  theme,
  label,
  value,
  disabled,
  onPress,
}: {
  theme: Theme;
  label: string;
  value: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        opacity: pressed && !disabled ? 0.95 : 1,
      })}
    >
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: 2 }}>{value}</Text>
    </Pressable>
  );
}

function LinkRow({
  theme,
  label,
  onPress,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        opacity: pressed ? 0.95 : 1,
      })}
    >
      <Text style={{ ...theme.typography.body, color: theme.colors.text }}>{label}</Text>
      <Feather name="external-link" size={16} color={theme.colors.textSecondary} />
    </Pressable>
  );
}
