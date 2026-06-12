import { describe, expect, it, vi } from "vitest";

vi.mock("expo-linking", () => {
  return {
    createURL: () => "exp://test/",
    parse: (rawUrl: string) => {
      const u = new URL(rawUrl);
      return {
        scheme: u.protocol.replace(":", ""),
        hostname: u.hostname,
        path: u.pathname.replace(/^\//, ""),
      };
    },
    getInitialURL: vi.fn(async () => null),
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  };
});

describe("deep link hardening", () => {
  it("rejects unexpected deep link paths", async () => {
    const ExpoLinking = await import("expo-linking");
    (ExpoLinking.getInitialURL as any).mockResolvedValueOnce("alga://evil/hack");

    vi.resetModules();
    const { linking } = await import("./linking");
    await expect(linking.getInitialURL?.()).resolves.toBeNull();
  });

  it("allows known safe paths", async () => {
    const ExpoLinking = await import("expo-linking");
    (ExpoLinking.getInitialURL as any).mockResolvedValueOnce("alga://signin");

    vi.resetModules();
    const { linking } = await import("./linking");
    await expect(linking.getInitialURL?.()).resolves.toBe("alga://signin");
  });

  it("allows the drawer section paths", async () => {
    const ExpoLinking = await import("expo-linking");

    for (const path of ["schedule", "time-entries", "clients", "contacts"]) {
      (ExpoLinking.getInitialURL as any).mockResolvedValueOnce(`alga://${path}`);
      vi.resetModules();
      const { linking } = await import("./linking");
      await expect(linking.getInitialURL?.()).resolves.toBe(`alga://${path}`);
    }
  });

  it("rejects detail-like paths that are not allowlisted", async () => {
    const ExpoLinking = await import("expo-linking");
    (ExpoLinking.getInitialURL as any).mockResolvedValueOnce("alga://clients/123");

    vi.resetModules();
    const { linking } = await import("./linking");
    await expect(linking.getInitialURL?.()).resolves.toBeNull();
  });
});
