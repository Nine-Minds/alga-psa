import { describe, expect, it, vi } from "vitest";

vi.mock("expo-localization", () => ({
  getLocales: () => [{ languageTag: "en-US" }],
}));

describe("dateTime formatters", () => {
  it("formats date-only strings consistently (no time component)", async () => {
    const mod = await import("./dateTime");

    const dateOnly = "2026-02-03";
    const short = mod.formatDateShort(dateOnly);
    const dt = mod.formatDateTime(dateOnly);
    expect(short).not.toBe("—");
    expect(dt).toBe(short);
  });

  it("formats relative time and combined relative+absolute", async () => {
    const mod = await import("./dateTime");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-03T00:00:00.000Z"));

    const inOneHour = "2026-02-03T01:00:00.000Z";
    const rel = mod.formatRelativeTime(inOneHour);
    expect(rel).not.toBe("");

    const combined = mod.formatDateTimeWithRelative(inOneHour);
    expect(combined).toContain("•");

    vi.useRealTimers();
  });
});

