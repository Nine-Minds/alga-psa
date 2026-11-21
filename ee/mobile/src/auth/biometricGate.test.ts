import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSecureJson: vi.fn(),
  setSecureJson: vi.fn(),
  hasHardwareAsync: vi.fn(),
  isEnrolledAsync: vi.fn(),
  authenticateAsync: vi.fn(),
}));

vi.mock("../storage/secureStorage", () => ({
  getSecureJson: (...args: unknown[]) => mocks.getSecureJson(...args),
  setSecureJson: (...args: unknown[]) => mocks.setSecureJson(...args),
}));

vi.mock("expo-local-authentication", () => ({
  hasHardwareAsync: () => mocks.hasHardwareAsync(),
  isEnrolledAsync: () => mocks.isEnrolledAsync(),
  authenticateAsync: (...args: unknown[]) => mocks.authenticateAsync(...args),
}));

import {
  BIOMETRIC_GRACE_MS,
  authenticateForUnlock,
  canUseBiometrics,
  getBiometricGateEnabled,
  setBiometricGateEnabled,
} from "./biometricGate";

describe("biometricGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasHardwareAsync.mockResolvedValue(true);
    mocks.isEnrolledAsync.mockResolvedValue(true);
  });

  it("uses a 15 minute grace period", () => {
    expect(BIOMETRIC_GRACE_MS).toBe(15 * 60 * 1000);
  });

  it("treats only an explicit true as enabled", async () => {
    mocks.getSecureJson.mockResolvedValueOnce(true);
    await expect(getBiometricGateEnabled()).resolves.toBe(true);
    mocks.getSecureJson.mockResolvedValueOnce(null);
    await expect(getBiometricGateEnabled()).resolves.toBe(false);
    mocks.getSecureJson.mockResolvedValueOnce("true");
    await expect(getBiometricGateEnabled()).resolves.toBe(false);
    expect(mocks.getSecureJson).toHaveBeenCalledWith("alga.mobile.biometricGate.enabled");
  });

  it("persists the enabled flag", async () => {
    await setBiometricGateEnabled(false);
    expect(mocks.setSecureJson).toHaveBeenCalledWith("alga.mobile.biometricGate.enabled", false);
  });

  it("requires hardware before checking enrollment", async () => {
    mocks.hasHardwareAsync.mockResolvedValue(false);
    await expect(canUseBiometrics()).resolves.toBe(false);
    expect(mocks.isEnrolledAsync).not.toHaveBeenCalled();
  });

  it("requires enrollment", async () => {
    mocks.isEnrolledAsync.mockResolvedValue(false);
    await expect(canUseBiometrics()).resolves.toBe(false);
  });

  it("refuses to prompt when biometrics are unavailable", async () => {
    mocks.isEnrolledAsync.mockResolvedValue(false);
    await expect(authenticateForUnlock()).resolves.toEqual({
      ok: false,
      reason: "Biometrics are not set up on this device.",
    });
    expect(mocks.authenticateAsync).not.toHaveBeenCalled();
  });

  it("unlocks on a successful prompt with device fallback allowed", async () => {
    mocks.authenticateAsync.mockResolvedValue({ success: true });
    await expect(authenticateForUnlock()).resolves.toEqual({ ok: true });
    expect(mocks.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: "Unlock AlgaPSA", disableDeviceFallback: false }),
    );
  });

  it("reports a failed or canceled prompt", async () => {
    mocks.authenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" });
    await expect(authenticateForUnlock()).resolves.toEqual({
      ok: false,
      reason: "Authentication canceled or failed.",
    });
  });
});
