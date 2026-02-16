import { describe, expect, it, vi } from "vitest";

vi.mock("expo-localization", () => ({
  getLocales: () => [{ languageTag: "en-US" }],
}));

describe("i18n", () => {
  it("returns localized strings and falls back to key", async () => {
    const mod = await import("./i18n");
    expect(mod.t("tickets.title")).toBe("Tickets");
    expect(mod.t("does.not.exist")).toBe("does.not.exist");
  });
});

