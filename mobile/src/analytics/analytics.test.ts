import { describe, expect, it, vi } from "vitest";
import { MOBILE_ANALYTICS_SCHEMA_VERSION, MobileAnalyticsEvents } from "./events";

describe("analytics", () => {
  it("does not emit events when disabled", async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_ENABLED = "false";
    vi.resetModules();

    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { analytics } = await import("./analytics");

    analytics.trackEvent(MobileAnalyticsEvents.appStartupReady, { durationMs: 1, signedIn: false });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("emits schema_version when enabled", async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_ENABLED = "true";
    vi.resetModules();

    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { analytics } = await import("./analytics");

    analytics.trackEvent(MobileAnalyticsEvents.appStartupReady, { durationMs: 123, signedIn: true });
    expect(spy).toHaveBeenCalledTimes(1);

    const [_msg, meta] = spy.mock.calls[0] ?? [];
    expect(meta).toMatchObject({
      name: MobileAnalyticsEvents.appStartupReady,
      properties: {
        schema_version: MOBILE_ANALYTICS_SCHEMA_VERSION,
        durationMs: 123,
        signedIn: true,
      },
    });

    spy.mockRestore();
  });
});

