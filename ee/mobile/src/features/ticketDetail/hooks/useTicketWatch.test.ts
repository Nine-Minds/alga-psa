import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import { useTicketWatch } from "./useTicketWatch";
import type { ApiClient } from "../../../api/client";
import type { TicketDetail } from "../../../api/tickets";

// --- Mocks -----------------------------------------------------------------

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));

vi.mock("../../../cache/ticketsCache", () => ({
  invalidateTicketsListCache: vi.fn(),
}));

vi.mock("../../../api/tickets", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../api/tickets")>();
  return { ...original, updateTicketAttributes: vi.fn() };
});

import { updateTicketAttributes } from "../../../api/tickets";
const mockUpdateAttributes = updateTicketAttributes as ReturnType<typeof vi.fn>;

// --- Helpers ---------------------------------------------------------------

const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = {
  accessToken: "tok-123",
  refreshToken: "ref",
  expiresAtMs: Date.now() + 60_000,
  user: { id: "user-1" },
};

function makeTicket(attributes: Record<string, unknown> | null = null): TicketDetail {
  return {
    ticket_id: "t-1",
    ticket_number: "T-001",
    title: "Test ticket",
    status_id: "s-1",
    priority_id: "p-1",
    board_id: "b-1",
    client_id: "c-1",
    attributes,
  } as TicketDetail;
}

type HookReturn = ReturnType<typeof useTicketWatch>;

function renderHook(ticket: TicketDetail | null = makeTicket()) {
  const fetchTicket = vi.fn().mockResolvedValue(undefined);
  const t = (key: string) => key;
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };

  function Wrapper() {
    const hook = useTicketWatch({
      client: fakeClient,
      session: fakeSession,
      ticketId: "t-1",
      t,
      showToast: vi.fn(),
      ticket,
      fetchTicket,
    });
    latest.current = hook;
    return null;
  }

  act(() => {
    create(React.createElement(Wrapper));
  });

  return { latest, fetchTicket };
}

// --- Tests -----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTicketWatch", () => {
  it("sends {} (not null) when unwatching leaves attributes empty", async () => {
    mockUpdateAttributes.mockResolvedValue({ ok: true, data: {} });

    // Ticket has only watcher_user_ids with current user — unwatching empties attributes
    const ticket = makeTicket({ watcher_user_ids: ["user-1"] });
    const { latest } = renderHook(ticket);

    await act(async () => { await latest.current.toggleWatch(); });

    expect(mockUpdateAttributes).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        attributes: expect.any(Object),
      }),
    );

    const call = mockUpdateAttributes.mock.calls[0][1];
    // attributes must be {} not null
    expect(call.attributes).toEqual({});
    expect(call.attributes).not.toBeNull();
  });

  it("sends watcher_user_ids when watching", async () => {
    mockUpdateAttributes.mockResolvedValue({ ok: true, data: {} });

    const ticket = makeTicket({});
    const { latest } = renderHook(ticket);

    await act(async () => { await latest.current.toggleWatch(); });

    const call = mockUpdateAttributes.mock.calls[0][1];
    expect(call.attributes).toEqual({ watcher_user_ids: ["user-1"] });
  });

  it("preserves other attributes when toggling watch", async () => {
    mockUpdateAttributes.mockResolvedValue({ ok: true, data: {} });

    const ticket = makeTicket({ description: "some text", watcher_user_ids: ["user-1"] });
    const { latest } = renderHook(ticket);

    // Unwatch — should keep description, remove watcher_user_ids
    await act(async () => { await latest.current.toggleWatch(); });

    const call = mockUpdateAttributes.mock.calls[0][1];
    expect(call.attributes).toEqual({ description: "some text" });
  });

  it("refreshes ticket after successful toggle", async () => {
    mockUpdateAttributes.mockResolvedValue({ ok: true, data: {} });

    const ticket = makeTicket({});
    const { latest, fetchTicket } = renderHook(ticket);

    await act(async () => { await latest.current.toggleWatch(); });

    expect(fetchTicket).toHaveBeenCalled();
  });

  it("sets permission error on 403", async () => {
    mockUpdateAttributes.mockResolvedValue({
      ok: false,
      error: { kind: "permission" },
    });

    const ticket = makeTicket({});
    const { latest } = renderHook(ticket);

    await act(async () => { await latest.current.toggleWatch(); });

    expect(latest.current.watchError).toBe("detail.errors.watchPermission");
  });
});
