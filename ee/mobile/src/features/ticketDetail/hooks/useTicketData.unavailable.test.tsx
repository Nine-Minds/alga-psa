import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTicket = vi.fn();
vi.mock("../../../api/tickets", () => ({
  getTicketById: (...a: unknown[]) => mockGetTicket(...a),
  getTicketComments: vi.fn(async () => ({ ok: true, data: { data: [] } })),
}));
vi.mock("../../../cache/ticketsCache", () => ({
  getCachedTicketDetail: vi.fn(() => ({ ticket_id: "t1", title: "Cached secret title" })),
  setCachedTicketDetail: vi.fn(),
}));
vi.mock("../../../hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({ refreshing: false, refresh: vi.fn() }),
}));

import { useTicketData } from "./useTicketData";

const stable = {
  client: {} as never,
  session: { accessToken: "k" } as never,
  t: ((k: string) => k) as never,
};

async function run() {
  let latest!: ReturnType<typeof useTicketData>;
  function Probe() {
    latest = useTicketData({
      ...stable,
      ticketId: "t1",
    });
    return null;
  }
  await act(async () => {
    create(<Probe />);
  });
  await act(async () => {
    await latest.fetchTicket();
  });
  return latest;
}

describe("useTicketData record availability", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["403", { kind: "permission", status: 403, message: "denied" }],
    ["404", { kind: "http", status: 404, message: "nope" }],
  ])("marks the ticket unavailable on %s and drops the cached copy", async (_l, error) => {
    mockGetTicket.mockResolvedValue({ ok: false, status: (error as { status: number }).status, error });
    const state = await run();
    expect(state.unavailable).toBe(true);
    expect(state.ticket).toBeNull();
  });

  it("keeps the generic error (not unavailable) for network and server errors", async () => {
    for (const error of [
      { kind: "network", message: "x" },
      { kind: "server", status: 500, message: "x" },
    ]) {
      mockGetTicket.mockResolvedValue({ ok: false, error });
      const state = await run();
      expect(state.unavailable).toBe(false);
      expect(state.error).not.toBeNull();
    }
  });
});
