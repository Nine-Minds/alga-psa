import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient header middleware", () => {
  it("adds Authorization, tenant, and client tagging headers", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe("Bearer ACCESS_TOKEN");
      expect(headers["x-tenant-id"]).toBe("tenant_123");
      expect(headers["x-alga-client"]).toBe("mobile/test");
      expect(headers["x-api-key"]).toBe("api_key_abc");
      expect(headers.accept).toBe("application/json");
      expect(headers["x-correlation-id"]).toBeDefined();
      return jsonResponse({ ok: true });
    });

    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      getAccessToken: () => "ACCESS_TOKEN",
      getTenantId: () => "tenant_123",
      getUserAgentTag: () => "mobile/test",
    });

    const result = await client.request({
      method: "GET",
      path: "/api/v1/tickets",
      headers: {
        "x-api-key": "api_key_abc",
        authorization: "Bearer SHOULD_BE_OVERWRITTEN",
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});

