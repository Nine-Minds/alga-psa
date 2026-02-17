import { describe, expect, it, vi } from "vitest";

describe("phase2Features", () => {
  it("hard-disables Phase 2 flags when not in dev", async () => {
    const prevDev = (globalThis as any).__DEV__;
    process.env.EXPO_PUBLIC_PHASE2_NOTIFICATIONS = "true";
    (globalThis as any).__DEV__ = false;
    vi.resetModules();

    const { phase2Features } = await import("./phase2");
    expect(phase2Features.notifications).toBe(false);

    (globalThis as any).__DEV__ = prevDev;
  });

  it("allows Phase 2 flags to be enabled in dev only", async () => {
    const prevDev = (globalThis as any).__DEV__;
    process.env.EXPO_PUBLIC_PHASE2_NOTIFICATIONS = "true";
    (globalThis as any).__DEV__ = true;
    vi.resetModules();

    const { phase2Features } = await import("./phase2");
    expect(phase2Features.notifications).toBe(true);

    (globalThis as any).__DEV__ = prevDev;
  });
});

