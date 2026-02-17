import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient request deduplication", () => {
  it("dedupes concurrent identical GETs without signals", async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return jsonResponse({ ok: true });
    });

    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [a, b] = await Promise.all([
      client.request({ method: "GET", path: "/api/v1/tickets" }),
      client.request({ method: "GET", path: "/api/v1/tickets" }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("does not dedupe when headers differ", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await Promise.all([
      client.request({
        method: "GET",
        path: "/api/v1/tickets",
        headers: { "x-api-key": "a" },
      }),
      client.request({
        method: "GET",
        path: "/api/v1/tickets",
        headers: { "x-api-key": "b" },
      }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not dedupe when AbortSignals are provided", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const a = new AbortController();
    const b = new AbortController();

    await Promise.all([
      client.request({ method: "GET", path: "/api/v1/tickets", signal: a.signal }),
      client.request({ method: "GET", path: "/api/v1/tickets", signal: b.signal }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

