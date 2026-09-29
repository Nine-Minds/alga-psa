import { describe, expect, it, vi } from "vitest";

const setNotificationChannelAsync = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null);
vi.mock("expo-notifications", () => ({
  setNotificationChannelAsync: (...args: unknown[]) => setNotificationChannelAsync(...args),
  AndroidImportance: { LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("../i18n/i18n", () => ({ default: { t: (_key: string, opts: { defaultValue: string }) => opts.defaultValue } }));

import { asNotificationPriority, ensurePriorityChannels, foregroundBehaviorFor, PRIORITY_CHANNEL_IDS, shouldToastInForeground } from "./priorityDelivery";

describe("priorityDelivery", () => {
  it("only high priority interrupts in the foreground; low stays badge-only", () => {
    expect(foregroundBehaviorFor("high")).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true, shouldShowList: true });
    expect(foregroundBehaviorFor("normal")).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false, shouldShowList: true });
    expect(foregroundBehaviorFor("low")).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false, shouldShowList: false, shouldSetBadge: true });
    expect(shouldToastInForeground("low")).toBe(false);
    expect(shouldToastInForeground("normal")).toBe(true);
  });

  it("treats unknown payload priorities as normal", () => {
    expect(asNotificationPriority(undefined)).toBe("normal");
    expect(asNotificationPriority("critical")).toBe("normal");
    expect(asNotificationPriority("high")).toBe("high");
  });

  it("creates the three channels the server targets, once", async () => {
    await ensurePriorityChannels();
    await ensurePriorityChannels();
    expect(setNotificationChannelAsync).toHaveBeenCalledTimes(3);
    const calls = setNotificationChannelAsync.mock.calls as unknown as Array<[string, { sound: unknown; importance: number }]>;
    expect(calls.map((c) => c[0])).toEqual(expect.arrayContaining(Object.values(PRIORITY_CHANNEL_IDS)));
    const low = calls.find((c) => c[0] === PRIORITY_CHANNEL_IDS.low)?.[1];
    expect(low?.sound).toBeNull();
    expect(low?.importance).toBe(2);
  });
});
