import { describe, expect, it, vi } from "vitest";
import {
  checkEmailExists,
  deleteAccount,
  provisionFromPurchase,
  restorePurchase,
} from "./iap";
import type { ApiClient } from "./client";

function mockClient(response: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

describe("iap api", () => {
  it("calls POST /api/v1/mobile/iap/check-email with the email body and a short timeout", async () => {
    const client = mockClient({ ok: true, data: { exists: false } });
    const signal = new AbortController().signal;

    await checkEmailExists(client, { email: "user@example.com" }, signal);

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/mobile/iap/check-email",
      body: { email: "user@example.com" },
      signal,
      timeoutMs: 10_000,
    });
  });

  it("calls POST /api/v1/mobile/iap/provision with a 60s timeout to cover workflow latency", async () => {
    const client = mockClient({
      ok: true,
      data: {
        status: "created",
        tenantId: "tenant-1",
        ott: "ott-123",
        expiresInSec: 300,
      },
    });
    const signal = new AbortController().signal;

    await provisionFromPurchase(
      client,
      {
        originalTransactionId: "2000000000",
        appAccountToken: "6ed9ee13-4b6a-4ef4-9c6e-3b1e5aa9b6cd",
        emailHint: "user@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        workspaceName: "My MSP",
        state: "state-xyz",
      },
      signal,
    );

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/mobile/iap/provision",
      body: {
        originalTransactionId: "2000000000",
        appAccountToken: "6ed9ee13-4b6a-4ef4-9c6e-3b1e5aa9b6cd",
        emailHint: "user@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        workspaceName: "My MSP",
        state: "state-xyz",
      },
      signal,
      timeoutMs: 60_000,
    });
  });

  it("calls POST /api/v1/mobile/iap/restore with a 20s timeout", async () => {
    const client = mockClient({
      ok: true,
      data: { tenantId: "tenant-1", ott: "ott-123", expiresInSec: 300 },
    });

    await restorePurchase(client, {
      originalTransactionId: "2000000000",
      state: "state-xyz",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/mobile/iap/restore",
      body: {
        originalTransactionId: "2000000000",
        state: "state-xyz",
      },
      signal: undefined,
      timeoutMs: 20_000,
    });
  });

  it("calls POST /api/v1/mobile/account/delete without a body and without a custom timeout", async () => {
    const client = mockClient({
      ok: true,
      data: { ok: true, deleted: true, tenantDeleted: false },
    });
    const signal = new AbortController().signal;

    await deleteAccount(client, signal);

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/mobile/account/delete",
      signal,
    });
    const call = vi.mocked(client.request).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("body");
    expect(call).not.toHaveProperty("timeoutMs");
  });
});
