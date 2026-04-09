import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import { useTicketDueDate } from "./useTicketDueDate";
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

type HookReturn = ReturnType<typeof useTicketDueDate>;

function renderHook(ticket: TicketDetail | null = makeTicket()) {
  const fetchTicket = vi.fn().mockResolvedValue(undefined);
  const t = (key: string) => key;
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };

  function Wrapper() {
    const hook = useTicketDueDate({
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

describe("useTicketDueDate", () => {
  it("sends {} (not null) when clearing due date leaves attributes empty", async () => {
    mockUpdateAttributes.mockResolvedValue({ ok: true, data: {} });

    // Ticket has only a due_date in attributes — clearing it empties attributes
    const ticket = makeTicket({ due_date: "2026-04-10T00:00:00.000Z" });
    const { latest } = renderHook(ticket);

    await act(async () => { await latest.current.submitDueDateIso(null); });

    expect(mockUpdateAttributes).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        attributes: expect.any(Object),
      }),
    );

    const call = mockUpdateAttributes.mock.calls[0][1];
    expect(call.attributes).toEqual({});
    expect(call.attributes).not.toBeNull();
  });

  it("sends due_date when setting a date", async () => {
    mockUpdateAttributes.mockResolvedValue({ ok: true, data: {} });

    const ticket = makeTicket({});
    const { latest } = renderHook(ticket);

    await act(async () => { await latest.current.submitDueDateIso("2026-05-01T00:00:00.000Z"); });

    const call = mockUpdateAttributes.mock.calls[0][1];
    expect(call.attributes).toEqual({ due_date: "2026-05-01T00:00:00.000Z" });
  });

  it("preserves other attributes when clearing due date", async () => {
    mockUpdateAttributes.mockResolvedValue({ ok: true, data: {} });

    const ticket = makeTicket({
      description: "some text",
      due_date: "2026-04-10T00:00:00.000Z",
    });
    const { latest } = renderHook(ticket);

    await act(async () => { await latest.current.submitDueDateIso(null); });

    const call = mockUpdateAttributes.mock.calls[0][1];
    expect(call.attributes).toEqual({ description: "some text" });
  });

  it("refreshes ticket and closes modal after success", async () => {
    mockUpdateAttributes.mockResolvedValue({ ok: true, data: {} });

    const ticket = makeTicket({});
    const { latest, fetchTicket } = renderHook(ticket);

    await act(async () => { await latest.current.submitDueDateIso("2026-05-01T00:00:00.000Z"); });

    expect(fetchTicket).toHaveBeenCalled();
    expect(latest.current.dueDateOpen).toBe(false);
  });

  it("setDueDateInDays sends correct ISO date", async () => {
    mockUpdateAttributes.mockResolvedValue({ ok: true, data: {} });

    const ticket = makeTicket({});
    const { latest } = renderHook(ticket);

    await act(async () => { await latest.current.setDueDateInDays(7); });

    const call = mockUpdateAttributes.mock.calls[0][1];
    const sentDate = call.attributes.due_date;
    expect(typeof sentDate).toBe("string");
    // The date should be ~7 days from now
    const diff = new Date(sentDate).getTime() - Date.now();
    const daysDiff = Math.round(diff / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBeGreaterThanOrEqual(6);
    expect(daysDiff).toBeLessThanOrEqual(7);
  });

  it("sets permission error on 403", async () => {
    mockUpdateAttributes.mockResolvedValue({
      ok: false,
      error: { kind: "permission" },
    });

    const ticket = makeTicket({});
    const { latest } = renderHook(ticket);

    await act(async () => { await latest.current.submitDueDateIso("2026-05-01T00:00:00.000Z"); });

    expect(latest.current.dueDateError).toBe("detail.errors.dueDatePermission");
  });
});
