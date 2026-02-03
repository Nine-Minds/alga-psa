import { useEffect, useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import * as Application from "expo-application";
import { getAppConfig } from "../config/appConfig";
import { colors, spacing, typography } from "../ui/theme";
import { authenticateForUnlock, canUseBiometrics, getBiometricGateEnabled, setBiometricGateEnabled } from "../auth/biometricGate";
import { useAuth } from "../auth/AuthContext";
import { clearTicketsCache } from "../cache/ticketsCache";

export function SettingsScreen() {
  const config = getAppConfig();
  const { session, logout } = useAuth();
  const version = Application.nativeApplicationVersion ?? "unknown";
  const build = Application.nativeBuildVersion ?? "unknown";
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      const [enabled, available] = await Promise.all([
        getBiometricGateEnabled(),
        canUseBiometrics(),
      ]);
      if (canceled) return;
      setBiometricEnabled(enabled);
      setBiometricAvailable(available);
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
        setBiometricError("Biometrics are not set up on this device.");
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
    <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
      <Text style={{ ...typography.title, marginBottom: spacing.sm, color: colors.text }}>
        Settings
      </Text>

      <View style={{ marginTop: spacing.lg }}>
        <Text style={{ ...typography.caption, color: colors.mutedText, marginBottom: spacing.sm }}>
          Account
        </Text>
        <Row label="Status" value={session ? "Signed in" : "Signed out"} />
        <View style={{ height: spacing.sm }} />
        <Row label="User" value={session?.user?.email ?? session?.user?.name ?? session?.user?.id ?? "—"} />
        <View style={{ height: spacing.sm }} />
        <Row label="Tenant" value={session?.tenantId ?? "—"} />
        <View style={{ height: spacing.sm }} />
        <ToggleRow
          label="Logout"
          value="Sign out"
          disabled={logoutBusy || !session}
          onPress={() => {
            Alert.alert("Sign out?", "You will need to sign in again to access tickets.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Sign out",
                style: "destructive",
                onPress: () => {
                  void (async () => {
                    if (logoutBusy) return;
                    setLogoutBusy(true);
                    try {
                      await logout();
                    } catch {
                      Alert.alert("Logout failed", "Unable to sign out. Please try again.");
                    } finally {
                      setLogoutBusy(false);
                    }
                  })();
                },
              },
            ]);
          }}
        />
      </View>

      <View style={{ marginTop: spacing.lg }}>
        <Text style={{ ...typography.caption, color: colors.mutedText, marginBottom: spacing.sm }}>
          Diagnostics
        </Text>
        <Row label="App version" value={`${version} (${build})`} />
        <View style={{ height: spacing.sm }} />
        <Row label="Platform" value={`${Platform.OS}`} />
        <View style={{ height: spacing.sm }} />
        <Row label="Environment" value={config.ok ? config.env : "invalid"} />
        <View style={{ height: spacing.sm }} />
        <Row label="Base URL" value={config.ok ? config.baseUrl : "missing"} />
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <Text style={{ ...typography.caption, color: colors.mutedText, marginBottom: spacing.sm }}>
          Security
        </Text>
        <ToggleRow
          label="Biometric lock"
          value={biometricEnabled ? "On" : "Off"}
          disabled={biometricBusy}
          onPress={() => void toggleBiometric()}
        />
        {biometricError ? (
          <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.danger }}>
            {biometricError}
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <Text style={{ ...typography.caption, color: colors.mutedText, marginBottom: spacing.sm }}>
          Data
        </Text>
        <ToggleRow
          label="Clear cache"
          value="Clear"
          onPress={() => {
            Alert.alert(
              "Clear cache?",
              "This clears in-memory ticket caches on this device. You may need to refresh tickets after.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Clear",
                  style: "destructive",
                  onPress: () => {
                    clearTicketsCache();
                    Alert.alert("Cleared", "Cache cleared.");
                  },
                },
              ],
            );
          }}
        />
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <Text style={{ ...typography.caption, color: colors.mutedText, marginBottom: spacing.sm }}>
          About
        </Text>
        <ToggleRow
          label="About"
          value="Open"
          onPress={() => setAboutOpen(true)}
        />
        <View style={{ height: spacing.sm }} />
        <ToggleRow
          label="Legal"
          value="Open"
          onPress={() => setLegalOpen(true)}
        />
      </View>

      <AboutModal
        visible={aboutOpen}
        onClose={() => setAboutOpen(false)}
        version={version}
        build={build}
        baseUrl={config.ok ? config.baseUrl : null}
      />
      <LegalModal
        visible={legalOpen}
        onClose={() => setLegalOpen(false)}
        privacyUrl={config.ok ? new URL("/legal/privacy", config.baseUrl).toString() : null}
        termsUrl={config.ok ? new URL("/legal/terms", config.baseUrl).toString() : null}
      />
    </View>
  );
}

function AboutModal({
  visible,
  onClose,
  version,
  build,
  baseUrl,
}: {
  visible: boolean;
  onClose: () => void;
  version: string;
  build: string;
  baseUrl: string | null;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
        <Text style={{ ...typography.title, color: colors.text }}>About</Text>
        <View style={{ height: spacing.md }} />
        <Row label="App" value="Alga PSA Mobile" />
        <View style={{ height: spacing.sm }} />
        <Row label="Version" value={`${version} (${build})`} />
        <View style={{ height: spacing.sm }} />
        <Row label="Base URL" value={baseUrl ?? "—"} />

        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close about"
          onPress={onClose}
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <Text style={{ ...typography.body, color: colors.primary, fontWeight: "700" }}>
            Close
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function LegalModal({
  visible,
  onClose,
  privacyUrl,
  termsUrl,
}: {
  visible: boolean;
  onClose: () => void;
  privacyUrl: string | null;
  termsUrl: string | null;
}) {
  const openUrl = (url: string | null) => {
    if (!url) return;
    void Linking.openURL(url);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
        <Text style={{ ...typography.title, color: colors.text }}>Legal</Text>
        <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.sm }}>
          Privacy policy and terms are currently hosted on the Alga web app.
        </Text>

        <View style={{ marginTop: spacing.lg }}>
          <ToggleRow
            label="Privacy policy"
            value={privacyUrl ? "Open" : "Unavailable"}
            disabled={!privacyUrl}
            onPress={() => openUrl(privacyUrl)}
          />
          <View style={{ height: spacing.sm }} />
          <ToggleRow
            label="Terms of service"
            value={termsUrl ? "Open" : "Unavailable"}
            disabled={!termsUrl}
            onPress={() => openUrl(termsUrl)}
          />
        </View>

        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close legal"
          onPress={onClose}
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <Text style={{ ...typography.body, color: colors.primary, fontWeight: "700" }}>
            Close
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
      }}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={{ ...typography.caption, color: colors.mutedText }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  disabled,
  onPress,
}: {
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
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        opacity: pressed && !disabled ? 0.95 : 1,
      })}
    >
      <Text style={{ ...typography.caption, color: colors.mutedText }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{value}</Text>
    </Pressable>
  );
}
