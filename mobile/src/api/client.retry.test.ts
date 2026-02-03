import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient retries", () => {
  it("retries GET requests on 5xx server errors", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      if (call === 0) {
        call += 1;
        return jsonResponse({ error: { message: "boom" } }, 500);
      }
      return jsonResponse({ ok: true }, 200);
    });

    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });

    const result = await client.request({ method: "GET", path: "/api/v1/tickets" });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
