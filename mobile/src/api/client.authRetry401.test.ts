import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient 401 handler", () => {
  it("calls onAuthError once and retries the request with the refreshed token", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) return jsonResponse({ error: { message: "Unauthorized" } }, 401);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers["x-api-key"]).toBe("NEW_TOKEN");
      return jsonResponse({ ok: true }, 200);
    });

    const onAuthError = vi.fn(async () => "NEW_TOKEN");

    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
      onAuthError,
    });

    const result = await client.request({ method: "GET", path: "/api/v1/tickets" });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });
});

