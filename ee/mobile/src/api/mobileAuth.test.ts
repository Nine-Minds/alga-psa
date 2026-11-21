import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import {
  exchangeOtt,
  exchangeOttWithRetry,
  getAuthCapabilities,
  refreshSession,
  revokeSession,
} from "./mobileAuth";

function makeClient(results: Array<ApiResult<unknown>>) {
  const request = vi.fn(async () => {
    const next = results.shift();
    if (!next) throw new Error("no more results");
    return next;
  });
  return { client: { request } as unknown as ApiClient, request };
}

const OK = { ok: true as const, status: 200, data: { accessToken: "a", refreshToken: "r", expiresInSec: 60 } };
const BODY = { ott: "ott-1", state: "state-1" };

describe("mobile auth endpoints", () => {
  it("posts the OTT exchange", async () => {
    const { client, request } = makeClient([OK]);
    const signal = new AbortController().signal;
    await exchangeOtt(client, BODY, signal);
    expect(request).toHaveBeenCalledWith({ method: "POST", path: "/api/v1/mobile/auth/exchange", body: BODY, signal });
  });

  it("posts refresh and revoke with the refresh token", async () => {
    const { client, request } = makeClient([OK, { ok: true, status: 200, data: {} }]);
    await refreshSession(client, { refreshToken: "r-1", device: { platform: "ios" } });
    await revokeSession(client, { refreshToken: "r-1" });
    expect(request).toHaveBeenNthCalledWith(1, {
      method: "POST",
      path: "/api/v1/mobile/auth/refresh",
      body: { refreshToken: "r-1", device: { platform: "ios" } },
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: "POST",
      path: "/api/v1/mobile/auth/revoke",
      body: { refreshToken: "r-1" },
    });
  });

  it("gets auth capabilities", async () => {
    const { client, request } = makeClient([{ ok: true, status: 200, data: { providers: { microsoft: true, google: false } } }]);
    await getAuthCapabilities(client);
    expect(request).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/mobile/auth/capabilities" });
  });
});

describe("exchangeOttWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the first success without retrying", async () => {
    const { client, request } = makeClient([OK]);
    await expect(exchangeOttWithRetry(client, BODY)).resolves.toEqual(OK);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and gateway 5xx with exponential backoff", async () => {
    const { client, request } = makeClient([
      { ok: false, error: { kind: "network", message: "down" } },
      { ok: false, status: 503, error: { kind: "server", status: 503, message: "busy" } },
      OK,
    ]);
    const promise = exchangeOttWithRetry(client, BODY, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(99);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toEqual(OK);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("caps the backoff at maxDelayMs", async () => {
    const timeout = { ok: false as const, error: { kind: "timeout" as const, message: "t", timeoutMs: 1 } };
    const { client, request } = makeClient([timeout, timeout, OK]);
    const promise = exchangeOttWithRetry(client, BODY, { baseDelayMs: 1000, maxDelayMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toEqual(OK);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-gateway server error or an auth error", async () => {
    const internal = { ok: false as const, status: 500, error: { kind: "server" as const, status: 500, message: "boom" } };
    const first = makeClient([internal]);
    await expect(exchangeOttWithRetry(first.client, BODY)).resolves.toEqual(internal);
    expect(first.request).toHaveBeenCalledTimes(1);

    const auth = { ok: false as const, status: 401, error: { kind: "auth" as const, status: 401, message: "bad ott" } };
    const second = makeClient([auth]);
    await expect(exchangeOttWithRetry(second.client, BODY)).resolves.toEqual(auth);
    expect(second.request).toHaveBeenCalledTimes(1);
  });

  it("returns the last failure once attempts are exhausted", async () => {
    const net = (n: number) => ({ ok: false as const, error: { kind: "network" as const, message: `n${n}` } });
    const { client, request } = makeClient([net(1), net(2)]);
    const promise = exchangeOttWithRetry(client, BODY, { maxAttempts: 2, baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toEqual(net(2));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("returns a canceled result immediately", async () => {
    const canceled = { ok: false as const, error: { kind: "canceled" as const, message: "Request canceled" } };
    const { client, request } = makeClient([canceled]);
    await expect(exchangeOttWithRetry(client, BODY)).resolves.toEqual(canceled);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not call the server when the signal is already aborted", async () => {
    const { client, request } = makeClient([]);
    const controller = new AbortController();
    controller.abort();
    await expect(exchangeOttWithRetry(client, BODY, {}, controller.signal)).resolves.toEqual({
      ok: false,
      error: { kind: "canceled", message: "Request canceled" },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("stops waiting and reports canceled when aborted during backoff", async () => {
    const { client, request } = makeClient([{ ok: false, error: { kind: "network", message: "down" } }]);
    const controller = new AbortController();
    const promise = exchangeOttWithRetry(client, BODY, { baseDelayMs: 1000 }, controller.signal);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await expect(promise).resolves.toEqual({ ok: false, error: { kind: "canceled", message: "Request canceled" } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("falls through to a network failure when zero attempts are allowed", async () => {
    const { client, request } = makeClient([]);
    await expect(exchangeOttWithRetry(client, BODY, { maxAttempts: 0 })).resolves.toEqual({
      ok: false,
      error: { kind: "network", message: "Network request failed" },
    });
    expect(request).not.toHaveBeenCalled();
  });
});
