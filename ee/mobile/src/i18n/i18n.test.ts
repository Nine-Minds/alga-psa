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

  // The bundle propagation strings once lived in a second `detail.bundle`
  // object in tickets.json. JSON keeps only the last duplicate, so the whole
  // block was dropped at parse time and the status picker's confirm dialog
  // rendered raw key paths. Assert each key resolves to something other than
  // its own key, which is what i18next falls back to when a key is missing.
  it("resolves every bundle propagation string used by the status picker", () => {
    const keys = [
      "detail.bundle.closeTitle",
      "detail.bundle.reopenTitle",
      "detail.bundle.closeDescription",
      "detail.bundle.reopenDescription",
      "detail.bundle.masterOnly",
      "detail.bundle.closeWithChildren",
      "detail.bundle.reopenWithChildren",
    ];
    for (const key of keys) {
      expect(t(`tickets:${key}`, { count: 2 })).not.toBe(key);
    }
  });

  // Siblings of the keys above, in the same object. A future edit that
  // re-introduces a duplicate `detail.bundle` would take these out instead.
  it("keeps the pre-existing bundle banner strings alongside them", () => {
    expect(t("tickets:detail.bundle.masterBanner", { count: 3 })).toBe(
      "Master of a bundle (3 children).",
    );
    expect(t("tickets:detail.bundle.modes.sync_updates")).toBe("Sync updates");
  });

  it("interpolates the child count into the propagation confirm title", () => {
    expect(t("tickets:detail.bundle.closeTitle", { count: 4 })).toBe(
      "Close 4 child ticket too?",
    );
  });
});

