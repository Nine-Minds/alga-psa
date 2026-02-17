import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { colors, spacing, typography } from "../ui/theme";
import { ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { authenticateForUnlock, setBiometricGateEnabled } from "../auth/biometricGate";

export function BiometricLockView({ onUnlocked }: { onUnlocked: () => void }) {
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
    return <LoadingState message="Unlocking…" />;
  }

  if (error) {
    return (
      <ErrorState
        title="Locked"
        description={error}
        action={
          <View>
            <PrimaryButton onPress={() => void unlock()}>Try again</PrimaryButton>
            <View style={{ height: spacing.md }} />
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
        padding: spacing.xl,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ ...typography.title, textAlign: "center", color: colors.text }}>Locked</Text>
      <Text style={{ ...typography.body, marginTop: spacing.md, textAlign: "center", color: colors.mutedText }}>
        Unlock with biometrics to continue.
      </Text>
      <View style={{ marginTop: spacing.lg }}>
        <PrimaryButton onPress={() => void unlock()}>Unlock</PrimaryButton>
      </View>
    </View>
  );
}
