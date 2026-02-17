import { describe, expect, it, vi } from "vitest";

vi.mock("expo-linking", () => {
  return {
    createURL: (path: string) => `exp://test/${path}`,
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

describe("navigation deep link config", () => {
  it("declares alga:// deep link routing for ticket detail", async () => {
    const mod = await import("./linking");
    const linking = mod.linking as any;

    expect(linking.prefixes).toContain("alga://");
    expect(linking.config.screens.TicketDetail).toBe("ticket/:ticketId");
    expect(linking.config.screens.SignIn).toBe("signin");
  });
});
