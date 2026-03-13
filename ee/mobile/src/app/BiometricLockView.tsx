import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../ui/ThemeContext";
import { ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { authenticateForUnlock, setBiometricGateEnabled } from "../auth/biometricGate";

export function BiometricLockView({ onUnlocked }: { onUnlocked: () => void }) {
  const theme = useTheme();
  const [status, setStatus] = useState<"idle" | "authenticating">("idle");
  const [error, setError] = useState<string | null>(null);

  const unlock = useCallback(async () => {
    setStatus("authenticating");
    setError(null);
    const result = await authenticateForUnlock();
    if (result.ok) {
      onUnlocked();
    } else {
      setError(result.reason);
      setStatus("idle");
    }
  }, [onUnlocked]);

  useEffect(() => {
    void unlock();
  }, [unlock]);

  if (status === "authenticating") {
    return <LoadingState message="Unlocking..." />;
  }

  if (error) {
    return (
      <ErrorState
        title="Locked"
        description={error}
        action={
          <View>
            <PrimaryButton onPress={() => void unlock()}>Try again</PrimaryButton>
            <View style={{ height: theme.spacing.md }} />
            <PrimaryButton
              onPress={() => {
                void (async () => {
                  await setBiometricGateEnabled(false);
                  onUnlocked();
                })();
              }}
            >
              Disable biometric lock
            </PrimaryButton>
          </View>
        }
      />
    );
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: theme.spacing.xl,
        backgroundColor: theme.colors.background,
      }}
    >
      <Text style={{ ...theme.typography.title, textAlign: "center", color: theme.colors.text }}>Locked</Text>
      <Text style={{ ...theme.typography.body, marginTop: theme.spacing.md, textAlign: "center", color: theme.colors.textSecondary }}>
        Unlock with biometrics to continue.
      </Text>
      <View style={{ marginTop: theme.spacing.lg }}>
        <PrimaryButton onPress={() => void unlock()}>Unlock</PrimaryButton>
      </View>
    </View>
  );
}
