import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import type { ApiClient } from "../../../api";

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));
vi.mock("../../../cache/ticketsCache", () => ({
  invalidateTicketsListCache: vi.fn(),
}));
vi.mock("../../../cache/referenceDataCache", () => ({
  getCachedTicketPriorities: vi.fn(() => null),
  setCachedTicketPriorities: vi.fn(),
}));
vi.mock("../../../api/tickets", () => ({
  getTicketPriorities: vi.fn(),
  updateTicketPriority: vi.fn(),
}));

import { getTicketPriorities, updateTicketPriority } from "../../../api/tickets";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import { getCachedTicketPriorities, setCachedTicketPriorities } from "../../../cache/referenceDataCache";
import { useTicketPriority } from "./useTicketPriority";

const mockGet = getTicketPriorities as ReturnType<typeof vi.fn>;
const mockUpdate = updateTicketPriority as ReturnType<typeof vi.fn>;
const mockGetCached = getCachedTicketPriorities as ReturnType<typeof vi.fn>;
const mockSetCached = setCachedTicketPriorities as ReturnType<typeof vi.fn>;

const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = { accessToken: "tok-1", tenantId: "ten-1" };
const priorities = [
  { priority_id: "p-high", priority_name: "High", is_from_itil_standard: false },
  { priority_id: "p-itil", priority_name: "P1", is_from_itil_standard: true },
  { priority_id: "p-low", priority_name: "Low", is_from_itil_standard: false },
];

type HookReturn = ReturnType<typeof useTicketPriority>;

function renderPriorityHook(opts?: { client?: ApiClient | null; session?: any; currentPriorityId?: string | null }) {
  const showToast = vi.fn();
  const fetchTicket = vi.fn().mockResolvedValue(undefined);
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };
  function Wrapper() {
    latest.current = useTicketPriority({
      client: opts?.client !== undefined ? opts.client : fakeClient,
      session: opts?.session !== undefined ? opts.session : (fakeSession as any),
      ticketId: "t-1",
      showToast,
      t: (k: string) => k,
      fetchTicket,
      currentPriorityId: opts?.currentPriorityId,
    });
    return null;
  }
  act(() => {
    create(React.createElement(Wrapper));
  });
  return {
    get result() {
      return latest.current;
    },
    showToast,
    fetchTicket,
  };
}

describe("useTicketPriority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCached.mockReturnValue(null);
  });

  it("does nothing without a client", async () => {
    const h = renderPriorityHook({ client: null });
    await act(async () => {
      await h.result.openPriorityPicker();
      await h.result.submitPriority("p-low");
    });
    expect(h.result.priorityPickerOpen).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("loads priorities, caches them, and only offers the current priority's family", async () => {
    mockGet.mockResolvedValueOnce({ ok: true, data: { data: priorities } });
    const h = renderPriorityHook({ currentPriorityId: "p-high" });
    await act(async () => {
      await h.result.openPriorityPicker();
    });
    expect(mockGet).toHaveBeenCalledWith(fakeClient, { apiKey: "tok-1" });
    expect(mockSetCached).toHaveBeenCalledWith("ten-1", priorities);
    expect(h.result.priorityPickerOpen).toBe(true);
    expect(h.result.priorityOptionsLoading).toBe(false);
    expect(h.result.priorityOptions.map((p) => p.priority_id)).toEqual(["p-high", "p-low"]);

    await act(async () => {
      await h.result.openPriorityPicker();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("uses cached priorities under the unknownTenant key when the session has no tenant", async () => {
    mockGetCached.mockReturnValueOnce(priorities);
    const h = renderPriorityHook({ session: { accessToken: "tok-1" } });
    await act(async () => {
      await h.result.openPriorityPicker();
    });
    expect(mockGetCached).toHaveBeenCalledWith("unknownTenant");
    expect(mockGet).not.toHaveBeenCalled();
    expect(h.result.priorityOptions).toHaveLength(3);
  });

  it("shows a load error when priorities cannot be fetched", async () => {
    mockGet.mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    const h = renderPriorityHook();
    await act(async () => {
      await h.result.openPriorityPicker();
    });
    expect(h.result.priorityOptionsError).toBe("detail.errors.unableToLoadPriorities");
    expect(h.result.priorityOptionsLoading).toBe(false);
  });

  it("updates the priority, refreshes the ticket and closes the picker", async () => {
    mockUpdate.mockResolvedValueOnce({ ok: true, data: { data: {} } });
    const h = renderPriorityHook();
    act(() => h.result.setPriorityPickerOpen(true));
    await act(async () => {
      await h.result.submitPriority("p-low", { suppressContactNotifications: false, suppressInternalNotifications: true });
    });
    expect(mockUpdate).toHaveBeenCalledWith(fakeClient, {
      apiKey: "tok-1",
      ticketId: "t-1",
      priority_id: "p-low",
      notificationSuppression: { suppressContactNotifications: false, suppressInternalNotifications: true },
      auditHeaders: { "x-device": "test" },
    });
    expect(invalidateTicketsListCache).toHaveBeenCalled();
    expect(h.fetchTicket).toHaveBeenCalled();
    expect(h.result.priorityPickerOpen).toBe(false);
    expect(h.result.priorityUpdating).toBe(false);
    expect(h.showToast).toHaveBeenCalledWith({ message: "notifications.suppression.successAll", tone: "success" });
  });

  it.each([
    ["permission", { kind: "permission" }, "detail.errors.priorityPermission"],
    ["validation", { kind: "validation", body: { error: { message: "Wrong family" } } }, "Wrong family"],
    ["validation fallback", { kind: "validation", body: {} }, "detail.errors.priorityValidation"],
    ["server", { kind: "server" }, "detail.errors.priorityGeneric"],
  ])("keeps the picker open with an error on a %s failure", async (_l, error, expected) => {
    mockUpdate.mockResolvedValueOnce({ ok: false, error });
    const h = renderPriorityHook();
    act(() => h.result.setPriorityPickerOpen(true));
    await act(async () => {
      await h.result.submitPriority("p-low");
    });
    expect(h.result.priorityUpdateError).toBe(expected);
    expect(h.result.priorityPickerOpen).toBe(true);
    expect(h.fetchTicket).not.toHaveBeenCalled();
    expect(h.showToast).not.toHaveBeenCalled();
  });
});
