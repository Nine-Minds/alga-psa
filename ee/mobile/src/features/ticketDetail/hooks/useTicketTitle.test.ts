import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import { useTicketTitle } from "./useTicketTitle";
import type { TicketDetail } from "../../../api/tickets";
import type { ApiClient } from "../../../api";

// --- Mocks ---------------------------------------------------------------

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));

vi.mock("../../../cache/ticketsCache", () => ({
  invalidateTicketsListCache: vi.fn(),
}));

vi.mock("../../../api/tickets", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../api/tickets")>();
  return { ...original, updateTicketTitle: vi.fn() };
});

import { updateTicketTitle } from "../../../api/tickets";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";

const mockUpdateTicketTitle = updateTicketTitle as ReturnType<typeof vi.fn>;
const mockInvalidateCache = invalidateTicketsListCache as ReturnType<typeof vi.fn>;

// --- Helpers -------------------------------------------------------------

const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = { accessToken: "tok-123", refreshToken: "ref", expiresAtMs: Date.now() + 60_000, user: { id: "u1" } };
const fakeTicket: TicketDetail = {
  ticket_id: "t-1",
  ticket_number: "T-001",
  title: "Original Title",
  status_name: "Open",
  status_is_closed: false,
  attributes: {},
} as TicketDetail;

type HookReturn = ReturnType<typeof useTicketTitle>;

/**
 * Minimal hook test harness. Captures hook output via a ref that is updated
 * on every render, then uses an onRender callback so tests can read the
 * latest result synchronously after `act()`.
 */
function renderTitleHook(opts?: {
  ticket?: TicketDetail | null;
  client?: ApiClient | null;
  session?: any;
}) {
  const setTicket = vi.fn();
  const t = (key: string) => key;
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };

  function Wrapper() {
    const hook = useTicketTitle({
      client: opts?.client !== undefined ? opts.client : fakeClient,
      session: opts?.session !== undefined ? opts.session : fakeSession as any,
      ticketId: "t-1",
      showToast: vi.fn(),
      t,
      ticket: opts?.ticket !== undefined ? opts.ticket : fakeTicket,
      setTicket,
    });
    // Assign on every render so `latest.current` is always fresh
    latest.current = hook;
    return null;
  }

  let renderer: ReturnType<typeof create>;
  act(() => { renderer = create(React.createElement(Wrapper)); });

  return {
    get result() { return latest.current; },
    setTicket,
    /** Force a re-render to pick up state changes */
    flush: () => renderer!.update(React.createElement(Wrapper)),
    unmount: () => renderer!.unmount(),
  };
}

// --- Tests ---------------------------------------------------------------

describe("useTicketTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in non-editing state", () => {
    const h = renderTitleHook();
    expect(h.result.titleEditing).toBe(false);
    expect(h.result.titleDraft).toBe("");
    expect(h.result.titleSaving).toBe(false);
    expect(h.result.titleError).toBeNull();
  });

  it("startTitleEditing populates draft from ticket title", () => {
    const h = renderTitleHook();
    act(() => { h.result.startTitleEditing(); h.flush(); });
    expect(h.result.titleEditing).toBe(true);
    expect(h.result.titleDraft).toBe("Original Title");
    expect(h.result.titleError).toBeNull();
  });

  it("cancelTitleEditing clears editing and error", () => {
    const h = renderTitleHook();
    act(() => { h.result.startTitleEditing(); h.flush(); });
    act(() => { h.result.cancelTitleEditing(); h.flush(); });
    expect(h.result.titleEditing).toBe(false);
    expect(h.result.titleError).toBeNull();
  });

  it("saveTitle sets error when draft is empty", async () => {
    const h = renderTitleHook();
    act(() => { h.result.startTitleEditing(); h.flush(); });
    act(() => { h.result.setTitleDraft("   "); h.flush(); });

    await act(async () => { await h.result.saveTitle(); h.flush(); });

    expect(h.result.titleError).toBe("detail.errors.titleEmpty");
    expect(mockUpdateTicketTitle).not.toHaveBeenCalled();
  });

  it("saveTitle skips API call when title is unchanged", async () => {
    const h = renderTitleHook();
    act(() => { h.result.startTitleEditing(); h.flush(); });
    // draft is "Original Title", same as ticket.title

    await act(async () => { await h.result.saveTitle(); h.flush(); });

    expect(h.result.titleEditing).toBe(false);
    expect(mockUpdateTicketTitle).not.toHaveBeenCalled();
  });

  it("saveTitle calls API and updates ticket on success", async () => {
    mockUpdateTicketTitle.mockResolvedValueOnce({ ok: true, status: 200, data: { data: fakeTicket } });

    const h = renderTitleHook();
    act(() => { h.result.startTitleEditing(); h.flush(); });
    act(() => { h.result.setTitleDraft("New Title"); h.flush(); });

    await act(async () => { await h.result.saveTitle(); h.flush(); });

    expect(mockUpdateTicketTitle).toHaveBeenCalledWith(fakeClient, {
      apiKey: "tok-123",
      ticketId: "t-1",
      title: "New Title",
      auditHeaders: { "x-device": "test" },
    });
    expect(h.result.titleEditing).toBe(false);
    expect(h.result.titleSaving).toBe(false);
    expect(h.setTicket).toHaveBeenCalled();
    expect(mockInvalidateCache).toHaveBeenCalled();
  });

  it("saveTitle shows permission error", async () => {
    mockUpdateTicketTitle.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: { kind: "permission", message: "Forbidden", status: 403 },
    });

    const h = renderTitleHook();
    act(() => { h.result.startTitleEditing(); h.flush(); });
    act(() => { h.result.setTitleDraft("New Title"); h.flush(); });

    await act(async () => { await h.result.saveTitle(); h.flush(); });

    expect(h.result.titleError).toBe("detail.errors.titlePermission");
    expect(h.result.titleEditing).toBe(true);
    expect(h.result.titleSaving).toBe(false);
  });

  it("saveTitle shows validation error with API message", async () => {
    mockUpdateTicketTitle.mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: {
        kind: "validation",
        message: "Bad request",
        status: 400,
        body: { error: { message: "Title too long" } },
      },
    });

    const h = renderTitleHook();
    act(() => { h.result.startTitleEditing(); h.flush(); });
    act(() => { h.result.setTitleDraft("New Title"); h.flush(); });

    await act(async () => { await h.result.saveTitle(); h.flush(); });

    expect(h.result.titleError).toBe("Title too long");
  });

  it("saveTitle falls back to validation key when no API message", async () => {
    mockUpdateTicketTitle.mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: { kind: "validation", message: "Bad request", status: 400, body: {} },
    });

    const h = renderTitleHook();
    act(() => { h.result.startTitleEditing(); h.flush(); });
    act(() => { h.result.setTitleDraft("New Title"); h.flush(); });

    await act(async () => { await h.result.saveTitle(); h.flush(); });

    expect(h.result.titleError).toBe("detail.errors.titleValidation");
  });

  it("saveTitle shows generic error for other failures", async () => {
    mockUpdateTicketTitle.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: { kind: "server", message: "Internal error", status: 500 },
    });

    const h = renderTitleHook();
    act(() => { h.result.startTitleEditing(); h.flush(); });
    act(() => { h.result.setTitleDraft("New Title"); h.flush(); });

    await act(async () => { await h.result.saveTitle(); h.flush(); });

    expect(h.result.titleError).toBe("detail.errors.titleGeneric");
  });

  it("saveTitle is a no-op when client or session is null", async () => {
    const h = renderTitleHook({ client: null, session: null });
    act(() => { h.result.startTitleEditing(); h.flush(); });
    act(() => { h.result.setTitleDraft("New"); h.flush(); });

    await act(async () => { await h.result.saveTitle(); });

    expect(mockUpdateTicketTitle).not.toHaveBeenCalled();
  });
});
