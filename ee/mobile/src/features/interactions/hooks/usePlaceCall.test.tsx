import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordPendingCallMock, showToastMock } = vi.hoisted(() => ({
  recordPendingCallMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, def?: string) => def ?? _key }),
}));
vi.mock("../../../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: showToastMock }) }));
vi.mock("./usePendingCallPrompt", () => ({ recordPendingCall: (...args: unknown[]) => recordPendingCallMock(...args) }));

import { Linking } from "react-native";
import { usePlaceCall, type PlaceCallInput } from "./usePlaceCall";

let placeCall: ((call: PlaceCallInput) => void) | null = null;

function Harness() {
  placeCall = usePlaceCall();
  return null;
}

const NOW = new Date(2026, 8, 14, 9, 30, 0).getTime();
const input: PlaceCallInput = {
  origin: { kind: "client", id: "client-1" },
  phone: "+15550100",
  name: "Acme",
  contactId: null,
  clientId: "client-1",
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("usePlaceCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    act(() => {
      create(React.createElement(Harness));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dials the number and arms the prompt with the time the call started", async () => {
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);

    placeCall?.(input);
    await flush();

    expect(openUrl).toHaveBeenCalledWith("tel:+15550100");
    expect(recordPendingCallMock).toHaveBeenCalledWith({ ...input, startedAtMs: NOW });
    expect(showToastMock).not.toHaveBeenCalled();
    openUrl.mockRestore();
  });

  it("does not arm the prompt when the device can't place calls", async () => {
    const openUrl = vi.spyOn(Linking, "openURL").mockRejectedValue(new Error("unsupported"));

    placeCall?.(input);
    await flush();

    // A wifi-only iPad must not get a stray "log this call?" on the next resume.
    expect(recordPendingCallMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith({ message: "This device can't place phone calls.", tone: "error" });
    openUrl.mockRestore();
  });
});
