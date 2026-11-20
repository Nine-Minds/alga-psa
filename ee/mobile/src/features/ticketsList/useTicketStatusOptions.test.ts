import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api";

const mocks = vi.hoisted(() => ({
  getTicketStatuses: vi.fn(),
  cache: new Map<string, unknown>(),
}));

vi.mock("../../api/tickets", () => ({
  getTicketStatuses: (...args: unknown[]) => mocks.getTicketStatuses(...args),
}));
vi.mock("../../cache/referenceDataCache", () => ({
  getCachedTicketStatuses: (key: string) => mocks.cache.get(key) ?? null,
  setCachedTicketStatuses: (key: string, value: unknown) => mocks.cache.set(key, value),
}));

import { useTicketStatusOptions } from "./useTicketStatusOptions";

type HookResult = ReturnType<typeof useTicketStatusOptions>;
type HookArgs = Parameters<typeof useTicketStatusOptions>[0];

const client = { request: vi.fn() } as unknown as ApiClient;
const STATUSES = [
  { status_id: "s-1", name: "Open", is_closed: false },
  { status_id: "s-2", name: "Closed", is_closed: true },
];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderHook(args: Partial<HookArgs> = {}) {
  const latest: { current: HookResult } = { current: undefined as unknown as HookResult };
  const props: HookArgs = { client, apiKey: "key", tenantId: "tenant-1", errorMessage: "load failed", ...args };
  function Wrapper(p: HookArgs) {
    latest.current = useTicketStatusOptions(p);
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(Wrapper, props));
  });
  return {
    get result() {
      return latest.current;
    },
    rerender: async (next: Partial<HookArgs>) => {
      await act(async () => {
        renderer.update(React.createElement(Wrapper, { ...props, ...next }));
      });
    },
    renderer,
  };
}

describe("useTicketStatusOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.clear();
  });

  it("fetches statuses, exposes them and caches them under the tenant", async () => {
    let resolve!: (value: unknown) => void;
    mocks.getTicketStatuses.mockReturnValue(new Promise((r) => (resolve = r)));
    const hook = await renderHook();
    expect(hook.result.statusOptionsLoading).toBe(true);
    expect(hook.result.statusOptionsLoaded).toBe(false);
    expect(mocks.getTicketStatuses).toHaveBeenCalledWith(client, { apiKey: "key" });

    await act(async () => {
      resolve({ ok: true, data: { data: STATUSES } });
    });
    await flush();
    expect(hook.result.statusOptions).toEqual(STATUSES);
    expect(hook.result.statusOptionsLoaded).toBe(true);
    expect(hook.result.statusOptionsLoading).toBe(false);
    expect(hook.result.statusOptionsError).toBeNull();
    expect(mocks.cache.get("tenant-1")).toEqual(STATUSES);
  });

  it("uses cached statuses without calling the API", async () => {
    mocks.cache.set("tenant-1", STATUSES);
    const hook = await renderHook();
    expect(mocks.getTicketStatuses).not.toHaveBeenCalled();
    expect(hook.result.statusOptions).toEqual(STATUSES);
    expect(hook.result.statusOptionsLoaded).toBe(true);
  });

  it("falls back to an unknown-tenant cache key when tenantId is missing", async () => {
    mocks.getTicketStatuses.mockResolvedValue({ ok: true, data: { data: STATUSES } });
    await renderHook({ tenantId: null });
    await flush();
    expect(mocks.cache.get("unknownTenant")).toEqual(STATUSES);
  });

  it("ignores an empty cached array and fetches", async () => {
    mocks.cache.set("tenant-1", []);
    mocks.getTicketStatuses.mockResolvedValue({ ok: true, data: { data: STATUSES } });
    const hook = await renderHook();
    await flush();
    expect(mocks.getTicketStatuses).toHaveBeenCalledTimes(1);
    expect(hook.result.statusOptions).toEqual(STATUSES);
  });

  it("reports the error message and marks loaded on failure so the list does not wait", async () => {
    mocks.getTicketStatuses.mockResolvedValue({ ok: false, error: { kind: "http", status: 500 } });
    const hook = await renderHook();
    await flush();
    expect(hook.result.statusOptionsError).toBe("load failed");
    expect(hook.result.statusOptionsLoaded).toBe(true);
    expect(hook.result.statusOptionsLoading).toBe(false);
    expect(hook.result.statusOptions).toEqual([]);
    expect(mocks.cache.size).toBe(0);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["no client", { client: null }],
    ["no api key", { apiKey: null }],
  ])("does nothing when %s", async (_label, args) => {
    const hook = await renderHook(args as Partial<HookArgs>);
    await flush();
    expect(mocks.getTicketStatuses).not.toHaveBeenCalled();
    expect(hook.result.statusOptionsLoaded).toBe(false);
  });

  it("starts loading once enabled flips on", async () => {
    mocks.getTicketStatuses.mockResolvedValue({ ok: true, data: { data: STATUSES } });
    const hook = await renderHook({ enabled: false });
    expect(mocks.getTicketStatuses).not.toHaveBeenCalled();
    await hook.rerender({ enabled: true });
    await flush();
    expect(mocks.getTicketStatuses).toHaveBeenCalledTimes(1);
    expect(hook.result.statusOptions).toEqual(STATUSES);
  });

  it("discards a response that lands after unmount", async () => {
    let resolve!: (value: unknown) => void;
    mocks.getTicketStatuses.mockReturnValue(new Promise((r) => (resolve = r)));
    const hook = await renderHook();
    await act(async () => {
      hook.renderer.unmount();
    });
    await act(async () => {
      resolve({ ok: true, data: { data: STATUSES } });
    });
    expect(mocks.cache.size).toBe(0);
  });
});
