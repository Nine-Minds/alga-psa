import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import * as Application from "expo-application";
import { getAppConfig } from "../config/appConfig";
import { colors, spacing, typography } from "../ui/theme";
import { authenticateForUnlock, canUseBiometrics, getBiometricGateEnabled, setBiometricGateEnabled } from "../auth/biometricGate";
import { useAuth } from "../auth/AuthContext";
import { clearTicketsCache } from "../cache/ticketsCache";

export function SettingsScreen() {
  const config = getAppConfig();
  const { session } = useAuth();
  const version = Application.nativeApplicationVersion ?? "unknown";
  const build = Application.nativeBuildVersion ?? "unknown";
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [biometricBusy, setBiometricBusy] = useState(false);

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
    </View>
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
