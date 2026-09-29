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


describe("server-supplied country date format", () => {
  it("defaults to the fixed system default, not the device locale", async () => {
    vi.resetModules();
    const mod = await import("./dateTime");

    expect(mod.getDateTimeFormat()).toEqual(mod.SYSTEM_DATE_FORMAT);
    expect(mod.formatDateShort("2026-02-03")).toContain("2026");
  });

  it("applies the server's digit order and separator", async () => {
    vi.resetModules();
    const mod = await import("./dateTime");

    mod.setDateTimeLocale("en-US", { order: ["day", "month", "year"], separator: "/", hour12: true });
    // A named month keeps the language's own order; only digits are reordered.
    expect(mod.formatDateShort("2026-02-03")).toBe("Feb 3, 2026");

    mod.setDateTimeLocale("de-DE", { order: ["day", "month", "year"], separator: ".", hour12: false });
    expect(mod.formatDateShort("2026-02-03")).toBe("03.02.2026");

    mod.setDateTimeLocale("de-DE", { order: ["month", "day", "year"], separator: "/", hour12: false });
    expect(mod.formatDateShort("2026-02-03")).toBe("02/03/2026");
  });

  it("takes the clock from the server shape, not the device language", async () => {
    vi.resetModules();
    const mod = await import("./dateTime");

    mod.setDateTimeLocale("de-DE", { order: ["day", "month", "year"], separator: ".", hour12: true });
    expect(mod.formatDateTime("2026-02-03T13:23:00.000Z")).toMatch(/\b(AM|PM)\b/);

    mod.setDateTimeLocale("en-US", { order: ["month", "day", "year"], separator: "/", hour12: false });
    expect(mod.formatDateTime("2026-02-03T13:23:00.000Z")).not.toMatch(/\b(AM|PM)\b/);
  });

  it("falls back to the system default when the server sends nothing", async () => {
    vi.resetModules();
    const mod = await import("./dateTime");

    mod.setDateTimeLocale("de-DE", { order: ["day", "month", "year"], separator: ".", hour12: false });
    mod.setDateTimeLocale("de-DE");
    expect(mod.getDateTimeFormat()).toEqual(mod.SYSTEM_DATE_FORMAT);
    expect(mod.formatDateShort("2026-02-03")).toBe("02/03/2026");
  });
});
