import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("../analytics/analytics", () => ({ analytics: { trackEvent: mocks.trackEvent } }));

import { createApiClient } from "./client";
import { MobileAnalyticsEvents } from "../analytics/events";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function failedEvents() {
  return mocks.trackEvent.mock.calls.filter(([name]) => name === MobileAnalyticsEvents.apiRequestFailed).map(([, p]) => p);
}

describe("createApiClient auth refresh edges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the original 401 when the refresh yields no token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "expired", code: "TOKEN_EXPIRED" } }, 401));
    const onAuthError = vi.fn(async () => null);
    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onAuthError,
    });

    const result = await client.request({ method: "POST", path: "/api/v1/tickets", body: { a: 1 } });
    expect(result).toMatchObject({ ok: false, status: 401, error: { kind: "auth", message: "expired", code: "TOKEN_EXPIRED" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(failedEvents()).toEqual([expect.objectContaining({ errorKind: "auth", status: 401, attempts: 1 })]);
  });

  it("returns the original 401 when the refresh throws", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onAuthError: async () => {
        throw new Error("refresh exploded");
      },
    });

    const result = await client.request({ method: "POST", path: "/api/v1/tickets" });
    expect(result).toMatchObject({ ok: false, status: 401, error: { kind: "auth", message: "HTTP 401" } });
    expect(failedEvents()).toEqual([expect.objectContaining({ errorKind: "exception", attempts: 1 })]);
  });

  it("reports the post-refresh failure when the retried request is still rejected", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "nope" } }, 403));
    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onAuthError: async () => "NEW",
    });

    const result = await client.request({ method: "POST", path: "/api/v1/tickets" });
    expect(result).toMatchObject({ ok: false, status: 403, error: { kind: "permission", message: "nope" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retriedHeaders = fetchImpl.mock.calls[1][1].headers as Record<string, string>;
    expect(retriedHeaders.authorization).toBe("Bearer NEW");
    expect(retriedHeaders["x-api-key"]).toBe("NEW");
    expect(failedEvents()).toEqual([expect.objectContaining({ errorKind: "permission", status: 403, attempts: 2 })]);
  });

  it("does not attempt a refresh without an onAuthError handler", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.request({ method: "GET", path: "/api/v1/tickets" });
    expect(result).toMatchObject({ ok: false, error: { kind: "auth" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps other 4xx to http errors and reads text bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response("gone", { status: 404, headers: { "content-type": "text/plain" } }));
    const client = createApiClient({ baseUrl: "https://example.com", fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.request({ method: "POST", path: "/x" });
    expect(result).toMatchObject({ ok: false, status: 404, error: { kind: "http", message: "HTTP 404", body: "gone" } });
  });

  it("tolerates malformed JSON bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }));
    const client = createApiClient({ baseUrl: "https://example.com", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.request({ method: "POST", path: "/x" })).resolves.toEqual({ ok: true, status: 200, data: undefined });
  });
});

describe("createApiClient cancel during retry backoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the last failure when the caller aborts while waiting to retry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "down" } }, 503));
    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 1000 },
    });
    const controller = new AbortController();
    const promise = client.request({ method: "GET", path: "/x", signal: controller.signal });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const result = await promise;
    expect(result).toMatchObject({ ok: false, status: 503, error: { kind: "server", message: "down" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failedEvents()).toEqual([expect.objectContaining({ errorKind: "server", attempts: 1 })]);
  });

  it("falls back to a network failure when zero attempts are configured", async () => {
    const fetchImpl = vi.fn();
    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry: { maxRetries: -1, baseDelayMs: 0, maxDelayMs: 0 },
    });
    const result = await client.request({ method: "GET", path: "/x" });
    expect(result).toEqual({ ok: false, error: { kind: "network", message: "Network request failed" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
