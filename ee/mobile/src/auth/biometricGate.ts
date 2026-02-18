import * as LocalAuthentication from "expo-local-authentication";
import { getSecureJson, setSecureJson } from "../storage/secureStorage";

const BIOMETRIC_GATE_KEY = "alga.mobile.biometricGate.enabled";

export async function getBiometricGateEnabled(): Promise<boolean> {
  return (await getSecureJson<boolean>(BIOMETRIC_GATE_KEY)) === true;
}

export async function setBiometricGateEnabled(enabled: boolean): Promise<void> {
  await setSecureJson<boolean>(BIOMETRIC_GATE_KEY, enabled);
}

export async function canUseBiometrics(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return enrolled;
}

export async function authenticateForUnlock(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const available = await canUseBiometrics();
  if (!available) {
    return { ok: false, reason: "Biometrics are not set up on this device." };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Alga PSA",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });

  return result.success ? { ok: true } : { ok: false, reason: "Authentication canceled or failed." };
}

