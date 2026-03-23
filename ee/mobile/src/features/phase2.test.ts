import { describe, expect, it, vi } from "vitest";

describe("phase2Features", () => {
  it("notifications are always enabled", async () => {
    const prevDev = (globalThis as any).__DEV__;
    (globalThis as any).__DEV__ = false;
    vi.resetModules();

    const { phase2Features } = await import("./phase2");
    expect(phase2Features.notifications).toBe(true);

    (globalThis as any).__DEV__ = prevDev;
  });

  it("hard-disables selfHostedBaseUrl when not in dev", async () => {
    const prevDev = (globalThis as any).__DEV__;
    process.env.EXPO_PUBLIC_PHASE2_SELF_HOSTED = "true";
    (globalThis as any).__DEV__ = false;
    vi.resetModules();

    const { phase2Features } = await import("./phase2");
    expect(phase2Features.selfHostedBaseUrl).toBe(false);

    (globalThis as any).__DEV__ = prevDev;
  });
});

