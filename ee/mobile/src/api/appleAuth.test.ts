import { describe, expect, it, vi } from "vitest";
import { signInWithAppleOnServer } from "./appleAuth";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("appleAuth api", () => {
  it("POSTs to /api/v1/mobile/auth/apple with identity token, code, names, state and a 15s timeout", async () => {
    const client = mockClient({
      ok: true,
      data: { ott: "ott-xyz", state: "state-abc", expiresInSec: 60 },
    });
    const signal = new AbortController().signal;

    await signInWithAppleOnServer(
      client,
      {
        identityToken: "id.token.value",
        authorizationCode: "auth-code-1",
        firstName: "Ada",
        lastName: "Lovelace",
        state: "state-abc",
      },
      signal,
    );

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/mobile/auth/apple",
      body: {
        identityToken: "id.token.value",
        authorizationCode: "auth-code-1",
        firstName: "Ada",
        lastName: "Lovelace",
        state: "state-abc",
      },
      signal,
      timeoutMs: 15_000,
    });
  });

  it("works without optional authorizationCode / names (subsequent sign-in)", async () => {
    const client = mockClient({
      ok: true,
      data: { ott: "ott-xyz", state: "state-abc", expiresInSec: 60 },
    });

    await signInWithAppleOnServer(client, {
      identityToken: "id.token.value",
      state: "state-abc",
    });

    const call = vi.mocked(client.request).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.path).toBe("/api/v1/mobile/auth/apple");
    expect(call.body).toEqual({
      identityToken: "id.token.value",
      state: "state-abc",
    });
  });

  it("returns the server error result unchanged (not-found → 404 for no-account)", async () => {
    const client = mockClient({
      ok: false,
      status: 404,
      error: { kind: "not_found", message: "No Alga account linked" },
    });

    const result = await signInWithAppleOnServer(client, {
      identityToken: "id.token.value",
      state: "state-abc",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });
});
