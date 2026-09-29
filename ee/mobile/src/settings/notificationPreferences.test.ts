import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("../storage/secureStorage", () => ({
  secureStorage: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value); },
  },
  getSecureJson: async (key: string) => {
    const raw = store.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  },
  setSecureJson: async (key: string, value: unknown) => { store.set(key, JSON.stringify(value)); },
}));

import {
  getPushPriorityThreshold,
  getReminderLeadMinutes,
  normalizeReminderLeads,
  setPushPriorityThreshold,
  setReminderLeadMinutes,
} from "./notificationPreferences";

describe("notificationPreferences", () => {
  beforeEach(() => store.clear());

  it("defaults the push threshold to low (everything) and round-trips a change", async () => {
    expect(await getPushPriorityThreshold()).toBe("low");
    await setPushPriorityThreshold("high");
    expect(await getPushPriorityThreshold()).toBe("high");
  });

  it("ignores a corrupted threshold value", async () => {
    store.set("alga.mobile.settings.pushPriorityThreshold", "urgent");
    expect(await getPushPriorityThreshold()).toBe("low");
  });

  it("defaults reminder leads to 15 minutes and allows several leads", async () => {
    expect(await getReminderLeadMinutes()).toEqual([15]);
    await setReminderLeadMinutes([5, 15, 5, 99]);
    expect(await getReminderLeadMinutes()).toEqual([15, 5]);
  });

  it("treats an explicitly empty list as reminders off", async () => {
    await setReminderLeadMinutes([]);
    expect(await getReminderLeadMinutes()).toEqual([]);
  });

  it("normalizes unknown shapes back to the default", () => {
    expect(normalizeReminderLeads("15")).toEqual([15]);
    expect(normalizeReminderLeads([60, 10])).toEqual([60, 10]);
  });
});
