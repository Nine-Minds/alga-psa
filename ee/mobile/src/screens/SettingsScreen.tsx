import { useEffect, useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import * as Application from "expo-application";
import { useTranslation } from "react-i18next";
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

export function SettingsScreen() {
  const { t } = useTranslation("settings");
  const theme = useTheme();
  const config = getAppConfig();
  const { session, logout } = useAuth();
  const version = Application.nativeApplicationVersion ?? t("common:unknown");
  const build = Application.nativeBuildVersion ?? t("common:unknown");
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const [hideSensitiveEnabled, setHideSensitiveEnabled] = useState(false);
  const [hideSensitiveBusy, setHideSensitiveBusy] = useState(false);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      const [enabled, available, hideSensitive] = await Promise.all([
        getBiometricGateEnabled(),
        canUseBiometrics(),
        getHideSensitiveNotificationsEnabled(),
      ]);
      if (canceled) return;
      setBiometricEnabled(enabled);
      setBiometricAvailable(available);
      setHideSensitiveEnabled(hideSensitive);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, []);

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
    <View style={{ flex: 1, padding: theme.spacing.lg, backgroundColor: theme.colors.background }}>
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
      </View>

      <View style={{ marginTop: theme.spacing.lg }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>
          {t("sections.diagnostics")}
        </Text>
        <Row theme={theme} label={t("diagnostics.appVersion")} value={formatAppVersion(version, build)} />
        <View style={{ height: theme.spacing.sm }} />
        <Row theme={theme} label={t("diagnostics.platform")} value={`${Platform.OS}`} />
        <View style={{ height: theme.spacing.sm }} />
        <Row theme={theme} label={t("diagnostics.environment")} value={config.ok ? config.env : t("diagnostics.invalid")} />
        <View style={{ height: theme.spacing.sm }} />
        <Row theme={theme} label={t("diagnostics.baseUrl")} value={config.ok ? config.baseUrl : t("diagnostics.missing")} />
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
          {t("sections.about")}
        </Text>
        <ToggleRow
          theme={theme}
          label={t("sections.about")}
          value={t("common:open")}
          onPress={() => setAboutOpen(true)}
        />
        <View style={{ height: theme.spacing.sm }} />
        <ToggleRow
          theme={theme}
          label={t("legal")}
          value={t("common:open")}
          onPress={() => setLegalOpen(true)}
        />
      </View>

      <AboutModal
        theme={theme}
        visible={aboutOpen}
        onClose={() => setAboutOpen(false)}
        version={version}
        build={build}
        baseUrl={config.ok ? config.baseUrl : null}
      />
      <LegalModal
        theme={theme}
        visible={legalOpen}
        onClose={() => setLegalOpen(false)}
        privacyUrl={tryBuildHostedPathUrl(config.ok ? config.baseUrl : null, "/legal/privacy")}
        termsUrl={tryBuildHostedPathUrl(config.ok ? config.baseUrl : null, "/legal/terms")}
      />
    </View>
  );
}

function AboutModal({
  theme,
  visible,
  onClose,
  version,
  build,
  baseUrl,
}: {
  theme: Theme;
  visible: boolean;
  onClose: () => void;
  version: string;
  build: string;
  baseUrl: string | null;
}) {
  const { t } = useTranslation("settings");
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, padding: theme.spacing.lg, backgroundColor: theme.colors.background }}>
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{t("aboutModal.title")}</Text>
        <View style={{ height: theme.spacing.md }} />
        <Row theme={theme} label={t("aboutModal.app")} value={t("aboutModal.appName")} />
        <View style={{ height: theme.spacing.sm }} />
        <Row theme={theme} label={t("aboutModal.version")} value={t("aboutModal.versionValue", { version, build })} />
        <View style={{ height: theme.spacing.sm }} />
        <Row theme={theme} label={t("aboutModal.baseUrl")} value={baseUrl ?? "—"} />

        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("aboutModal.closeAccessibility")}
          onPress={onClose}
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <Text style={{ ...theme.typography.body, color: theme.colors.primary, fontWeight: "700" }}>
            {t("common:close")}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function LegalModal({
  theme,
  visible,
  onClose,
  privacyUrl,
  termsUrl,
}: {
  theme: Theme;
  visible: boolean;
  onClose: () => void;
  privacyUrl: string | null;
  termsUrl: string | null;
}) {
  const openUrl = (url: string | null) => {
    if (!url) return;
    void Linking.openURL(url);
  };

  const { t } = useTranslation("settings");

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, padding: theme.spacing.lg, backgroundColor: theme.colors.background }}>
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{t("legalModal.title")}</Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
          {t("legalModal.subtitle")}
        </Text>

        <View style={{ marginTop: theme.spacing.lg }}>
          <ToggleRow
            theme={theme}
            label={t("legalModal.privacyPolicy")}
            value={privacyUrl ? t("common:open") : t("common:unavailable")}
            disabled={!privacyUrl}
            onPress={() => openUrl(privacyUrl)}
          />
          <View style={{ height: theme.spacing.sm }} />
          <ToggleRow
            theme={theme}
            label={t("legalModal.termsOfService")}
            value={termsUrl ? t("common:open") : t("common:unavailable")}
            disabled={!termsUrl}
            onPress={() => openUrl(termsUrl)}
          />
        </View>

        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("legalModal.closeAccessibility")}
          onPress={onClose}
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <Text style={{ ...theme.typography.body, color: theme.colors.primary, fontWeight: "700" }}>
            {t("common:close")}
          </Text>
        </Pressable>
      </View>
    </Modal>
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
