import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";
import { analytics } from "../analytics/analytics";
import { MOBILE_ANALYTICS_SCHEMA_VERSION, MobileAnalyticsEvents } from "../analytics/events";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient telemetry", () => {
  it("emits api.request.succeeded with duration and normalized path", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }, 200));

    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    analytics.setEnabled(true);

    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    });

    const result = await client.request({ method: "GET", path: "/api/v1/tickets" });
    expect(result.ok).toBe(true);

    expect(spy).toHaveBeenCalledWith(
      "analytics.event",
      expect.objectContaining({
        name: MobileAnalyticsEvents.apiRequestSucceeded,
        properties: expect.objectContaining({
          schema_version: MOBILE_ANALYTICS_SCHEMA_VERSION,
          method: "GET",
          path: "/api/v1/tickets",
          status: 200,
          attempts: 1,
          durationMs: expect.any(Number),
        }),
      }),
    );

    analytics.setEnabled(false);
    spy.mockRestore();
  });
});

