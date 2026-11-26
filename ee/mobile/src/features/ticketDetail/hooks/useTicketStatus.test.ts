import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import { Alert } from "react-native";
import type { ApiClient } from "../../../api";

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));

vi.mock("../../../cache/ticketsCache", () => ({
  invalidateTicketsListCache: vi.fn(),
}));

vi.mock("../../../cache/referenceDataCache", () => ({
  getCachedTicketStatuses: vi.fn(() => null),
  setCachedTicketStatuses: vi.fn(),
}));

vi.mock("../../../api/tickets", () => ({
  getTicketStatuses: vi.fn(),
  updateTicketStatus: vi.fn(),
}));

import { getTicketStatuses, updateTicketStatus } from "../../../api/tickets";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import { getCachedTicketStatuses, setCachedTicketStatuses } from "../../../cache/referenceDataCache";
import { extractBundlePropagationDetails, useTicketStatus } from "./useTicketStatus";

const mockGetStatuses = getTicketStatuses as ReturnType<typeof vi.fn>;
const mockUpdateStatus = updateTicketStatus as ReturnType<typeof vi.fn>;
const mockGetCached = getCachedTicketStatuses as ReturnType<typeof vi.fn>;
const mockSetCached = setCachedTicketStatuses as ReturnType<typeof vi.fn>;
const mockInvalidate = invalidateTicketsListCache as ReturnType<typeof vi.fn>;

const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = { accessToken: "tok-1", tenantId: "ten-1", user: { id: "u1" } };
const statuses = [
  { status_id: "s-open", name: "Open", is_closed: false },
  { status_id: "s-closed", name: "Closed", is_closed: true },
];

type HookReturn = ReturnType<typeof useTicketStatus>;

function renderStatusHook(opts?: {
  client?: ApiClient | null;
  session?: any;
  boardId?: string | null;
  refreshCapabilities?: () => Promise<void>;
  onChecklistBlocked?: () => void;
}) {
  const showToast = vi.fn();
  const fetchTicket = vi.fn().mockResolvedValue(undefined);
  const t = (key: string, o?: Record<string, unknown>) =>
    o && typeof o.count === "number" ? `${key}:${o.count}` : key;
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };
  let boardId = opts?.boardId;

  function Wrapper() {
    latest.current = useTicketStatus({
      client: opts?.client !== undefined ? opts.client : fakeClient,
      session: opts?.session !== undefined ? opts.session : (fakeSession as any),
      ticketId: "t-1",
      showToast,
      t,
      fetchTicket,
      refreshCapabilities: opts?.refreshCapabilities ?? vi.fn().mockResolvedValue(undefined),
      boardId,
      onChecklistBlocked: opts?.onChecklistBlocked,
    });
    return null;
  }

  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(React.createElement(Wrapper));
  });

  return {
    get result() {
      return latest.current;
    },
    showToast,
    fetchTicket,
    flush: () => renderer!.update(React.createElement(Wrapper)),
    setBoardId: (next: string | null) => {
      boardId = next;
      act(() => {
        renderer!.update(React.createElement(Wrapper));
      });
    },
  };
}

describe("extractBundlePropagationDetails", () => {
  it("returns details only for the bundle confirmation reason", () => {
    const details = { reason: "bundle_propagation_confirmation_required", crossesBoundary: "close", affectedChildren: [], unaffectedChildren: [] };
    expect(extractBundlePropagationDetails({ error: { details } })).toBe(details);
    expect(extractBundlePropagationDetails({ error: { details: { reason: "other" } } })).toBeNull();
    expect(extractBundlePropagationDetails({ error: {} })).toBeNull();
    expect(extractBundlePropagationDetails(null)).toBeNull();
    expect(extractBundlePropagationDetails(undefined)).toBeNull();
  });
});

describe("useTicketStatus", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCached.mockReturnValue(null);
    alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  describe("openStatusPicker", () => {
    it("is a no-op without client or session", async () => {
      const h = renderStatusHook({ client: null });
      await act(async () => {
        await h.result.openStatusPicker();
      });
      expect(h.result.statusPickerOpen).toBe(false);
      expect(mockGetStatuses).not.toHaveBeenCalled();
    });

    it("loads statuses for the board and caches them per tenant+board", async () => {
      mockGetStatuses.mockResolvedValueOnce({ ok: true, data: { data: statuses } });
      const h = renderStatusHook({ boardId: "b-1" });
      await act(async () => {
        await h.result.openStatusPicker();
      });
      expect(h.result.statusPickerOpen).toBe(true);
      expect(mockGetCached).toHaveBeenCalledWith("ten-1:board:b-1");
      expect(mockGetStatuses).toHaveBeenCalledWith(fakeClient, { apiKey: "tok-1", board_id: "b-1" });
      expect(h.result.statusOptions).toEqual(statuses);
      expect(h.result.statusOptionsLoading).toBe(false);
      expect(mockSetCached).toHaveBeenCalledWith("ten-1:board:b-1", statuses);
    });

    it("refreshes tenant capabilities before loading statuses for the picker", async () => {
      const events: string[] = [];
      const refreshCapabilities = vi.fn(async () => {
        events.push("capabilities");
      });
      mockGetStatuses.mockImplementationOnce(async () => {
        events.push("statuses");
        return { ok: true, data: { data: statuses } };
      });
      const h = renderStatusHook({ refreshCapabilities });

      await act(async () => {
        await h.result.openStatusPicker();
      });

      expect(events).toEqual(["capabilities", "statuses"]);
      expect(refreshCapabilities).toHaveBeenCalledTimes(1);
    });

    it("uses tenant-only cache key and no board filter without a board, falling back to unknownTenant", async () => {
      mockGetStatuses.mockResolvedValueOnce({ ok: true, data: { data: statuses } });
      const h = renderStatusHook({ session: { accessToken: "tok-1" } });
      await act(async () => {
        await h.result.openStatusPicker();
      });
      expect(mockGetCached).toHaveBeenCalledWith("unknownTenant");
      expect(mockGetStatuses).toHaveBeenCalledWith(fakeClient, { apiKey: "tok-1", board_id: undefined });
    });

    it("uses cached statuses without hitting the API", async () => {
      mockGetCached.mockReturnValueOnce(statuses);
      const h = renderStatusHook();
      await act(async () => {
        await h.result.openStatusPicker();
      });
      expect(h.result.statusOptions).toEqual(statuses);
      expect(mockGetStatuses).not.toHaveBeenCalled();
    });

    it("does not reload once options are present", async () => {
      mockGetStatuses.mockResolvedValueOnce({ ok: true, data: { data: statuses } });
      const h = renderStatusHook();
      await act(async () => {
        await h.result.openStatusPicker();
      });
      act(() => h.result.setStatusPickerOpen(false));
      await act(async () => {
        await h.result.openStatusPicker();
      });
      expect(h.result.statusPickerOpen).toBe(true);
      expect(mockGetStatuses).toHaveBeenCalledTimes(1);
      expect(mockGetCached).toHaveBeenCalledTimes(1);
    });

    it("shows a load error when the API fails", async () => {
      mockGetStatuses.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
      const h = renderStatusHook();
      await act(async () => {
        await h.result.openStatusPicker();
      });
      expect(h.result.statusOptionsError).toBe("detail.errors.unableToLoadStatuses");
      expect(h.result.statusOptions).toEqual([]);
      expect(h.result.statusOptionsLoading).toBe(false);
      expect(mockSetCached).not.toHaveBeenCalled();
    });

    it("drops loaded options when the board changes so the next open reloads", async () => {
      mockGetStatuses.mockResolvedValue({ ok: true, data: { data: statuses } });
      const h = renderStatusHook({ boardId: "b-1" });
      await act(async () => {
        await h.result.openStatusPicker();
      });
      expect(h.result.statusOptions).toHaveLength(2);
      h.setBoardId("b-2");
      expect(h.result.statusOptions).toEqual([]);
      await act(async () => {
        await h.result.openStatusPicker();
      });
      expect(mockGetStatuses).toHaveBeenLastCalledWith(fakeClient, { apiKey: "tok-1", board_id: "b-2" });
    });
  });

  describe("submitStatus", () => {
    it("is a no-op without a session", async () => {
      const h = renderStatusHook({ session: null });
      await act(async () => {
        await h.result.submitStatus("s-closed");
      });
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it("updates the status, refreshes, closes the picker and toasts success", async () => {
      mockUpdateStatus.mockResolvedValueOnce({ ok: true, status: 200, data: { data: {} } });
      const h = renderStatusHook();
      act(() => h.result.setStatusPickerOpen(true));
      await act(async () => {
        await h.result.submitStatus("s-closed");
      });
      expect(mockUpdateStatus).toHaveBeenCalledWith(fakeClient, {
        apiKey: "tok-1",
        ticketId: "t-1",
        status_id: "s-closed",
        propagateToChildren: undefined,
        notificationSuppression: undefined,
        auditHeaders: { "x-device": "test" },
      });
      expect(mockInvalidate).toHaveBeenCalled();
      expect(h.fetchTicket).toHaveBeenCalled();
      expect(h.result.statusPickerOpen).toBe(false);
      expect(h.result.pendingStatusId).toBeNull();
      expect(h.result.statusUpdating).toBe(false);
      expect(h.result.statusUpdateError).toBeNull();
      expect(h.showToast).toHaveBeenCalledWith({ message: "detail.changeStatus", tone: "success" });
    });

    it("reports a suppression-specific success message", async () => {
      mockUpdateStatus.mockResolvedValueOnce({ ok: true, status: 200, data: { data: {} } });
      const h = renderStatusHook();
      await act(async () => {
        await h.result.submitStatus("s-closed", { suppressContactNotifications: true, suppressInternalNotifications: false });
      });
      expect(mockUpdateStatus.mock.calls[0][1].notificationSuppression).toEqual({ suppressContactNotifications: true, suppressInternalNotifications: false });
      expect(h.showToast).toHaveBeenCalledWith({ message: "notifications.suppression.successCustomer", tone: "success" });
    });

    it("ignores a second submit while one is in flight", async () => {
      let resolve!: (v: unknown) => void;
      mockUpdateStatus.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const h = renderStatusHook();
      let first!: Promise<void>;
      await act(async () => {
        first = h.result.submitStatus("s-closed");
        await Promise.resolve();
      });
      expect(h.result.statusUpdating).toBe(true);
      expect(h.result.pendingStatusId).toBe("s-closed");
      await act(async () => {
        await h.result.submitStatus("s-open");
      });
      await act(async () => {
        resolve({ ok: true, status: 200, data: { data: {} } });
        await first;
      });
      expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
      expect(h.result.statusUpdating).toBe(false);
    });

    it("shows a permission error", async () => {
      mockUpdateStatus.mockResolvedValueOnce({ ok: false, status: 403, error: { kind: "permission" } });
      const h = renderStatusHook();
      await act(async () => {
        await h.result.submitStatus("s-closed");
      });
      expect(h.result.statusUpdateError).toBe("detail.errors.statusPermission");
      expect(h.result.pendingStatusId).toBeNull();
      expect(h.showToast).toHaveBeenCalledWith({ message: "detail.errors.statusGeneric", tone: "error" });
      expect(h.fetchTicket).not.toHaveBeenCalled();
    });

    it("shows the API validation message, falling back to the generic validation key", async () => {
      mockUpdateStatus.mockResolvedValueOnce({
        ok: false,
        status: 400,
        error: { kind: "validation", body: { error: { message: "Status not allowed" } } },
      });
      const h = renderStatusHook();
      await act(async () => {
        await h.result.submitStatus("s-closed");
      });
      expect(h.result.statusUpdateError).toBe("Status not allowed");

      mockUpdateStatus.mockResolvedValueOnce({ ok: false, status: 400, error: { kind: "validation", body: {} } });
      await act(async () => {
        await h.result.submitStatus("s-closed");
      });
      expect(h.result.statusUpdateError).toBe("detail.errors.statusValidation");
    });

    it("closes the picker and calls onChecklistBlocked when a checklist blocks closing", async () => {
      const onChecklistBlocked = vi.fn();
      mockUpdateStatus.mockResolvedValueOnce({
        ok: false,
        status: 400,
        error: { kind: "validation", body: { error: { message: "Complete the required Checklist items first" } } },
      });
      const h = renderStatusHook({ onChecklistBlocked });
      act(() => h.result.setStatusPickerOpen(true));
      await act(async () => {
        await h.result.submitStatus("s-closed");
      });
      expect(onChecklistBlocked).toHaveBeenCalledTimes(1);
      expect(h.result.statusPickerOpen).toBe(false);
      expect(h.result.statusUpdateError).toBe("Complete the required Checklist items first");
    });

    it("shows a generic error for other failures", async () => {
      mockUpdateStatus.mockResolvedValueOnce({ ok: false, status: 500, error: { kind: "server" } });
      const h = renderStatusHook();
      await act(async () => {
        await h.result.submitStatus("s-closed");
      });
      expect(h.result.statusUpdateError).toBe("detail.errors.statusGeneric");
      expect(h.showToast).toHaveBeenCalledWith({ message: "detail.errors.statusGeneric", tone: "error" });
    });

    it("on a plain 409 conflict closes the picker and offers a refresh", async () => {
      mockUpdateStatus.mockResolvedValueOnce({ ok: false, status: 409, error: { kind: "http", body: {} } });
      const h = renderStatusHook();
      act(() => h.result.setStatusPickerOpen(true));
      await act(async () => {
        await h.result.submitStatus("s-closed");
      });
      expect(h.result.statusPickerOpen).toBe(false);
      expect(h.result.statusUpdateError).toBe("detail.errors.statusConflict");
      expect(h.showToast).toHaveBeenCalledWith({ message: "detail.errors.statusConflictTitle", tone: "info" });
      expect(alertSpy).toHaveBeenCalledTimes(1);
      const [title, desc, buttons] = alertSpy.mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
      expect(title).toBe("detail.errors.statusConflictTitle");
      expect(desc).toBe("detail.errors.statusConflictDescription");
      expect(h.fetchTicket).not.toHaveBeenCalled();
      buttons.find((b) => b.text === "common:refresh")!.onPress!();
      expect(h.fetchTicket).toHaveBeenCalledTimes(1);
    });

    it("on a 409 bundle crossing, asks whether to propagate and resubmits with the choice", async () => {
      mockUpdateStatus.mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: {
          kind: "http",
          body: {
            error: {
              details: {
                reason: "bundle_propagation_confirmation_required",
                crossesBoundary: "close",
                affectedChildren: [
                  { ticket_id: "c1", ticket_number: "T-2" },
                  { ticket_id: "c2", title: "Child two" },
                  { ticket_id: "c3" },
                ],
                unaffectedChildren: [],
              },
            },
          },
        },
      });
      const h = renderStatusHook();
      act(() => h.result.setStatusPickerOpen(true));
      await act(async () => {
        await h.result.submitStatus("s-closed", { suppressContactNotifications: false, suppressInternalNotifications: true });
      });

      expect(h.result.statusPickerOpen).toBe(true);
      expect(h.result.statusUpdateError).toBeNull();
      expect(h.result.pendingStatusId).toBeNull();
      const [title, desc, buttons] = alertSpy.mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
      expect(title).toBe("detail.bundle.closeTitle:3");
      expect(desc).toBe("detail.bundle.closeDescription:3\nT-2, Child two, c3");
      expect(buttons.map((b) => b.text)).toEqual([
        "common:cancel",
        "detail.bundle.masterOnly",
        "detail.bundle.closeWithChildren",
      ]);

      mockUpdateStatus.mockResolvedValue({ ok: true, status: 200, data: { data: {} } });
      await act(async () => {
        buttons[2].onPress!();
      });
      expect(mockUpdateStatus).toHaveBeenLastCalledWith(
        fakeClient,
        expect.objectContaining({
          status_id: "s-closed",
          propagateToChildren: true,
          notificationSuppression: { suppressContactNotifications: false, suppressInternalNotifications: true },
        }),
      );
      await act(async () => {
        buttons[1].onPress!();
      });
      expect(mockUpdateStatus).toHaveBeenLastCalledWith(fakeClient, expect.objectContaining({ propagateToChildren: false }));
    });

    it("uses reopen wording when the bundle change reopens children", async () => {
      mockUpdateStatus.mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: {
          kind: "http",
          body: {
            error: {
              details: {
                reason: "bundle_propagation_confirmation_required",
                crossesBoundary: "reopen",
                affectedChildren: [{ ticket_id: "c1", ticket_number: "T-2" }],
                unaffectedChildren: [],
              },
            },
          },
        },
      });
      const h = renderStatusHook();
      await act(async () => {
        await h.result.submitStatus("s-open");
      });
      const [title, , buttons] = alertSpy.mock.calls[0] as [string, string, Array<{ text: string }>];
      expect(title).toBe("detail.bundle.reopenTitle:1");
      expect(buttons[2].text).toBe("detail.bundle.reopenWithChildren");
    });

    it("treats a bundle 409 that crosses no boundary as a plain conflict", async () => {
      mockUpdateStatus.mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: {
          kind: "http",
          body: {
            error: {
              details: {
                reason: "bundle_propagation_confirmation_required",
                crossesBoundary: null,
                affectedChildren: [],
                unaffectedChildren: [],
              },
            },
          },
        },
      });
      const h = renderStatusHook();
      await act(async () => {
        await h.result.submitStatus("s-open");
      });
      expect(h.result.statusUpdateError).toBe("detail.errors.statusConflict");
      expect(alertSpy.mock.calls[0][0]).toBe("detail.errors.statusConflictTitle");
    });
  });
});
