import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

describe("createApiClient timeouts", () => {
  it("returns a timeout error when the request exceeds timeoutMs", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      await new Promise<void>((_resolve, reject) => {
        if (!signal) return reject(new Error("missing signal"));
        if (signal.aborted) return reject(new Error("aborted"));
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      throw new Error("unreachable");
    });

    const client = createApiClient({
      baseUrl: "https://example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
      defaultTimeoutMs: 5,
    });

    const result = await client.request({ method: "GET", path: "/api/v1/tickets" });
    expect(result.ok).toBe(false);
    expect(result.error.kind).toBe("timeout");
    expect((result.error as any).timeoutMs).toBe(5);
  });
});

