import { describe, expect, it, vi } from "vitest";

vi.mock("expo-linking", () => {
  return {
    createURL: (_path: string) => "exp://test/",
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
});

