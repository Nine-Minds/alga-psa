import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import type { ApiClient } from "../../../api";
import type { TicketDetail } from "../../../api/tickets";

vi.mock("../../../api/tickets", () => ({
  getTicketBundle: vi.fn(),
}));

import { getTicketBundle } from "../../../api/tickets";
import { useTicketBundle } from "./useTicketBundle";

const mockGetBundle = getTicketBundle as ReturnType<typeof vi.fn>;
const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = { accessToken: "tok-1" };

type HookReturn = ReturnType<typeof useTicketBundle>;

async function renderBundleHook(ticket: Partial<TicketDetail> | null, opts?: { client?: ApiClient | null }) {
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };
  function Wrapper() {
    latest.current = useTicketBundle({
      client: opts?.client !== undefined ? opts.client : fakeClient,
      session: fakeSession as any,
      ticketId: "t-1",
      ticket: ticket as TicketDetail | null,
    });
    return null;
  }
  await act(async () => {
    create(React.createElement(Wrapper));
  });
  return {
    get result() {
      return latest.current;
    },
  };
}

describe("useTicketBundle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never requests a bundle for a standalone ticket", async () => {
    const h = await renderBundleHook({ ticket_id: "t-1" });
    expect(h.result.bundleRole).toBe("standalone");
    expect(h.result.bundle).toBeNull();
    expect(mockGetBundle).not.toHaveBeenCalled();
  });

  it("does not request without a client", async () => {
    const h = await renderBundleHook({ ticket_id: "t-1", bundle_child_count: 2 }, { client: null });
    expect(h.result.bundleRole).toBe("master");
    expect(mockGetBundle).not.toHaveBeenCalled();
  });

  it("loads the bundle for a master ticket", async () => {
    const bundle = { master: { ticket_id: "t-1" }, children: [] };
    mockGetBundle.mockResolvedValueOnce({ ok: true, data: { data: bundle } });
    const h = await renderBundleHook({ ticket_id: "t-1", bundle_child_count: 2 });
    expect(mockGetBundle).toHaveBeenCalledWith(fakeClient, { apiKey: "tok-1", ticketId: "t-1" });
    expect(h.result.bundle).toEqual(bundle);
    expect(h.result.bundleLoading).toBe(false);
  });

  it("clears the bundle when the request fails for a child ticket", async () => {
    mockGetBundle.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    const h = await renderBundleHook({ ticket_id: "t-1", master_ticket_id: "m-1" });
    expect(h.result.bundleRole).toBe("child");
    expect(h.result.bundle).toBeNull();
    expect(h.result.bundleLoading).toBe(false);
  });
});
