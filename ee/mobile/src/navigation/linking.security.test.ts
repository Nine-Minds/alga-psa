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

  it("T097 rejects a project or asset id that is not a uuid", async () => {
    const ExpoLinking = await import("expo-linking");

    for (const url of [
      "alga://project/not-a-uuid",
      "alga://project/11111111-1111-4111-8111",
      "alga://asset/../../etc/passwd",
      "alga://asset/",
    ]) {
      (ExpoLinking.getInitialURL as any).mockResolvedValueOnce(url);
      vi.resetModules();
      const { linking, setDeepLinkSignedIn } = await import("./linking");
      setDeepLinkSignedIn(true);
      await expect(linking.getInitialURL?.()).resolves.toBeNull();
    }
  });

  it("T097 accepts a uuid project and asset link for a signed-in user", async () => {
    const ExpoLinking = await import("expo-linking");

    for (const url of [
      "alga://project/11111111-1111-4111-8111-111111111111",
      "alga://asset/33333333-3333-4333-8333-333333333333",
    ]) {
      (ExpoLinking.getInitialURL as any).mockResolvedValueOnce(url);
      vi.resetModules();
      const { linking, setDeepLinkSignedIn } = await import("./linking");
      setDeepLinkSignedIn(true);
      await expect(linking.getInitialURL?.()).resolves.toBe(url);
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
