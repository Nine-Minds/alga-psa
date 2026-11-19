import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as null | { accessToken: string; tenantId?: string },
  refreshSession: vi.fn(),
  config: { ok: true, baseUrl: "https://psa.example.com" } as { ok: boolean; baseUrl?: string },
  createApiClient: vi.fn(),
}));

vi.mock("../../../auth/AuthContext", () => ({
  useAuth: () => ({ session: mocks.session, refreshSession: mocks.refreshSession }),
}));
vi.mock("../../../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../../../api", () => ({ createApiClient: (...args: unknown[]) => mocks.createApiClient(...args) }));

import { useInventoryApi } from "./useInventoryApi";

type Result = ReturnType<typeof useInventoryApi>;

function renderHook() {
  const latest: { current: Result } = { current: undefined as unknown as Result };
  function Wrapper() {
    latest.current = useInventoryApi();
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(React.createElement(Wrapper));
  });
  return {
    get result() {
      return latest.current;
    },
    rerender: () => act(() => renderer.update(React.createElement(Wrapper))),
  };
}

describe("useInventoryApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { accessToken: "key-1", tenantId: "tenant-1" };
    mocks.config = { ok: true, baseUrl: "https://psa.example.com" };
    mocks.createApiClient.mockImplementation((opts: unknown) => ({ request: vi.fn(), opts }));
  });

  it("builds a client against the configured server with the session's key and tenant", () => {
    const hook = renderHook();
    expect(hook.result.apiKey).toBe("key-1");
    expect(hook.result.baseUrl).toBe("https://psa.example.com");
    expect(hook.result.client).not.toBeNull();
    const opts = mocks.createApiClient.mock.calls[0][0];
    expect(opts.baseUrl).toBe("https://psa.example.com");
    expect(opts.getAccessToken()).toBe("key-1");
    expect(opts.getTenantId()).toBe("tenant-1");
    expect(opts.getUserAgentTag()).toBe("mobile/web/inventory");
    expect(opts.onAuthError).toBe(mocks.refreshSession);
  });

  it("memoizes the client across re-renders with the same session", () => {
    const hook = renderHook();
    const first = hook.result.client;
    hook.rerender();
    expect(hook.result.client).toBe(first);
    expect(mocks.createApiClient).toHaveBeenCalledTimes(1);
  });

  it("returns no client when signed out", () => {
    mocks.session = null;
    const hook = renderHook();
    expect(hook.result).toEqual({ client: null, apiKey: null, baseUrl: null });
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });

  it("returns no client when app config is invalid", () => {
    mocks.config = { ok: false };
    const hook = renderHook();
    expect(hook.result.client).toBeNull();
    expect(hook.result.baseUrl).toBeNull();
    expect(hook.result.apiKey).toBe("key-1");
  });
});
