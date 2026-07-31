import { describe, expect, it, vi } from "vitest";
import { getMyCapabilities } from "./capabilities";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("capabilities api", () => {
  it("calls GET /api/v1/mobile/me/capabilities with the api key", async () => {
    const client = mockClient({ ok: true, data: { data: { features: { inventory: true, opportunities: false } } } });
    const signal = new AbortController().signal;

    await getMyCapabilities(client, { apiKey: "api-key-1", signal });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/mobile/me/capabilities",
      signal,
      headers: {
        "x-api-key": "api-key-1",
      },
    });
  });
});
