import { describe, expect, it, vi, beforeAll } from "vitest";

vi.mock("expo-localization", () => ({
  getLocales: () => [{ languageTag: "en-US" }],
}));

describe("i18n", () => {
  let t: (key: string, options?: Record<string, unknown>) => string;

  beforeAll(async () => {
    const mod = await import("./i18n");
    t = mod.t as unknown as typeof t;
  });

  it("resolves a basic translation from the common namespace", () => {
    expect(t("common:retry")).toBe("Retry");
  });

  it("resolves a namespaced translation", () => {
    expect(t("tickets:list.title")).toBe("Tickets");
  });

  it("handles interpolation", () => {
    expect(t("tickets:list.assignedTo", { name: "Alice" })).toBe("Assigned to Alice");
  });

  it("falls back to the key for missing translations", () => {
    expect(t("common:does.not.exist")).toBe("does.not.exist");
  });

  it("resolves nested keys", () => {
    expect(t("auth:signIn.cta")).toBe("Sign in");
  });

  it("resolves settings namespace", () => {
    expect(t("settings:title")).toBe("Settings");
  });
});

