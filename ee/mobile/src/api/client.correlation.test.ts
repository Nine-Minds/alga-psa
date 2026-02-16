import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient correlation id", () => {
  it("adds x-correlation-id and keeps it stable across retries", async () => {
    const headersSeen: any[] = [];
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      headersSeen.push(init?.headers);
      if (headersSeen.length === 1) return jsonResponse({ error: { message: "bad gateway" } }, 502);
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

    const first = headersSeen[0] as Record<string, string>;
    const second = headersSeen[1] as Record<string, string>;
    expect(typeof first["x-correlation-id"]).toBe("string");
    expect(first["x-correlation-id"]).toBe(second["x-correlation-id"]);
  });
});

