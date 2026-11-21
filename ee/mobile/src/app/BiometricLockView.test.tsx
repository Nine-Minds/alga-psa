import React from "react";
import { Pressable, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  authenticateForUnlock: vi.fn(),
  setBiometricGateEnabled: vi.fn(),
}));

vi.mock("../auth/biometricGate", () => ({
  authenticateForUnlock: () => mocks.authenticateForUnlock(),
  setBiometricGateEnabled: (...args: unknown[]) => mocks.setBiometricGateEnabled(...args),
}));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../ui/states", async () => {
  const ReactLocal = await import("react");
  return {
    LoadingState: (props: Record<string, unknown>) => ReactLocal.createElement("LoadingState", props),
    ErrorState: (props: { title: string; description: string; action: React.ReactNode }) =>
      ReactLocal.createElement("ErrorState", { title: props.title, description: props.description }, props.action),
  };
});

import { BiometricLockView } from "./BiometricLockView";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(onUnlocked: () => void): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BiometricLockView onUnlocked={onUnlocked} />);
  });
  await flush();
  return renderer;
}

function pressButton(renderer: ReactTestRenderer, label: string) {
  const button = renderer.root
    .findAllByType(Pressable)
    .find((node) => node.findAllByType(Text).some((t) => t.props.children === label));
  if (!button) throw new Error(`button ${label} not found`);
  return act(async () => {
    button.props.onPress();
  });
}

describe("BiometricLockView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setBiometricGateEnabled.mockResolvedValue(undefined);
  });

  it("prompts on mount and unlocks on success", async () => {
    mocks.authenticateForUnlock.mockResolvedValue({ ok: true });
    const onUnlocked = vi.fn();
    await render(onUnlocked);
    expect(mocks.authenticateForUnlock).toHaveBeenCalledTimes(1);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it("shows the unlocking state while the prompt is open", async () => {
    const pending = deferred<{ ok: true }>();
    mocks.authenticateForUnlock.mockReturnValue(pending.promise);
    const renderer = await render(vi.fn());
    expect(renderer.root.findByType("LoadingState" as never).props.message).toBe("Unlocking...");
    await act(async () => pending.resolve({ ok: true }));
  });

  it("shows the failure reason and stays locked", async () => {
    mocks.authenticateForUnlock.mockResolvedValue({ ok: false, reason: "Authentication canceled or failed." });
    const onUnlocked = vi.fn();
    const renderer = await render(onUnlocked);
    const error = renderer.root.findByType("ErrorState" as never);
    expect(error.props.title).toBe("Locked");
    expect(error.props.description).toBe("Authentication canceled or failed.");
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("retries the prompt from the error state", async () => {
    mocks.authenticateForUnlock
      .mockResolvedValueOnce({ ok: false, reason: "nope" })
      .mockResolvedValueOnce({ ok: true });
    const onUnlocked = vi.fn();
    const renderer = await render(onUnlocked);
    await pressButton(renderer, "Try again");
    await flush();
    expect(mocks.authenticateForUnlock).toHaveBeenCalledTimes(2);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it("disables the gate and unlocks when the user opts out", async () => {
    mocks.authenticateForUnlock.mockResolvedValue({ ok: false, reason: "Biometrics are not set up on this device." });
    const onUnlocked = vi.fn();
    const renderer = await render(onUnlocked);
    await pressButton(renderer, "Disable biometric lock");
    await flush();
    expect(mocks.setBiometricGateEnabled).toHaveBeenCalledWith(false);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });
});
