import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../../../api/client";

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));

vi.mock("../../../api/timeEntries", () => ({
  createTimeEntry: vi.fn(),
}));

import { createTimeEntry } from "../../../api/timeEntries";
import { useTimeEntry } from "./useTimeEntry";

const mockCreateTimeEntry = createTimeEntry as ReturnType<typeof vi.fn>;

const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = {
  accessToken: "tok-123",
  refreshToken: "ref",
  expiresAtMs: Date.now() + 60_000,
  user: { id: "user-1" },
};

type HookReturn = ReturnType<typeof useTimeEntry>;

function renderHook(opts?: {
  client?: ApiClient | null;
  session?: any;
  ticketId?: string;
  onCreated?: () => void;
}) {
  const showToast = vi.fn();
  const t = vi.fn((key: string, vars?: Record<string, unknown>) => {
    if (vars && Object.keys(vars).length > 0) {
      return `${key}:${JSON.stringify(vars)}`;
    }
    return key;
  });
  const latest: { current: HookReturn } = {
    current: undefined as unknown as HookReturn,
  };

  function Wrapper() {
    latest.current = useTimeEntry(
      {
        client: opts?.client !== undefined ? opts.client : fakeClient,
        session: opts?.session !== undefined ? opts.session : fakeSession,
        ticketId: opts?.ticketId ?? "ticket-1",
        showToast,
        t,
      },
      { onCreated: opts?.onCreated },
    );
    return null;
  }

  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(React.createElement(Wrapper));
  });

  return { latest, showToast, t, rerender: () => act(() => renderer.update(React.createElement(Wrapper))) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTimeEntry", () => {
  describe("initial state", () => {
    it("starts closed, with empty fields, no error, not updating", () => {
      const { latest } = renderHook();
      expect(latest.current.timeEntryOpen).toBe(false);
      expect(latest.current.timeEntryStartTime).toBe("");
      expect(latest.current.timeEntryEndTime).toBe("");
      expect(latest.current.timeEntryNotes).toBe("");
      expect(latest.current.timeEntryServiceId).toBeNull();
      expect(latest.current.timeEntryError).toBeNull();
      expect(latest.current.timeEntryUpdating).toBe(false);
    });
  });

  describe("openTimeEntryModal", () => {
    it("for today, defaults to (now-15m, now) and opens the modal", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-05T14:30:00"));

      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal());

      expect(latest.current.timeEntryOpen).toBe(true);
      expect(latest.current.timeEntryStartTime).toBe("14:15");
      expect(latest.current.timeEntryEndTime).toBe("14:30");
    });

    it("for a non-today date, defaults to 09:00 - 09:15", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-05T14:30:00"));

      const { latest } = renderHook();
      const yesterday = new Date("2026-05-04T00:00:00");
      act(() => latest.current.openTimeEntryModal(yesterday));

      expect(latest.current.timeEntryStartTime).toBe("09:00");
      expect(latest.current.timeEntryEndTime).toBe("09:15");
      expect(latest.current.timeEntryDate.getDate()).toBe(yesterday.getDate());
    });

    it("clears notes, service, and error when reopening", () => {
      const { latest } = renderHook();

      act(() => latest.current.openTimeEntryModal());
      act(() => latest.current.setTimeEntryNotes("some notes"));
      act(() => latest.current.setTimeEntryServiceId("svc-1"));

      act(() => latest.current.openTimeEntryModal());

      expect(latest.current.timeEntryNotes).toBe("");
      expect(latest.current.timeEntryServiceId).toBeNull();
      expect(latest.current.timeEntryError).toBeNull();
    });
  });

  describe("submitTimeEntry — validation", () => {
    it("sets error when no service is selected", async () => {
      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal());

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(latest.current.timeEntryError).toBe("timeEntry.errors.noService");
      expect(mockCreateTimeEntry).not.toHaveBeenCalled();
    });

    it("sets error when start time is malformed", async () => {
      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal());
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("not-a-time"));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(latest.current.timeEntryError).toBe("timeEntry.errors.invalidTime");
      expect(mockCreateTimeEntry).not.toHaveBeenCalled();
    });

    it("sets error when end is not after start", async () => {
      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal());
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("10:00"));
      act(() => latest.current.setTimeEntryEndTime("10:00"));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(latest.current.timeEntryError).toBe("timeEntry.errors.endBeforeStart");
      expect(mockCreateTimeEntry).not.toHaveBeenCalled();
    });

    it("does nothing when client is null", async () => {
      const { latest } = renderHook({ client: null });
      await act(async () => {
        await latest.current.submitTimeEntry();
      });
      expect(mockCreateTimeEntry).not.toHaveBeenCalled();
    });

    it("does nothing when session is null", async () => {
      const { latest } = renderHook({ session: null });
      await act(async () => {
        await latest.current.submitTimeEntry();
      });
      expect(mockCreateTimeEntry).not.toHaveBeenCalled();
    });
  });

  describe("submitTimeEntry — success", () => {
    it("calls createTimeEntry with computed ISO start/end + audit headers", async () => {
      mockCreateTimeEntry.mockResolvedValue({
        ok: true,
        data: { data: { entry_id: "te-1" } },
      });

      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal(new Date("2026-05-05T00:00:00")));
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("10:00"));
      act(() => latest.current.setTimeEntryEndTime("10:30"));
      act(() => latest.current.setTimeEntryNotes("  fix printer  "));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(mockCreateTimeEntry).toHaveBeenCalledTimes(1);
      const callArgs = mockCreateTimeEntry.mock.calls[0]?.[1];
      expect(callArgs).toMatchObject({
        apiKey: "tok-123",
        work_item_type: "ticket",
        work_item_id: "ticket-1",
        service_id: "svc-1",
        notes: "fix printer",
        is_billable: true,
        auditHeaders: { "x-device": "test" },
      });
      expect(typeof callArgs.start_time).toBe("string");
      expect(typeof callArgs.end_time).toBe("string");
      expect(new Date(callArgs.end_time).getTime() - new Date(callArgs.start_time).getTime())
        .toBe(30 * 60_000);
    });

    it("omits notes when only whitespace", async () => {
      mockCreateTimeEntry.mockResolvedValue({
        ok: true,
        data: { data: { entry_id: "te-1" } },
      });

      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal(new Date("2026-05-05T00:00:00")));
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("10:00"));
      act(() => latest.current.setTimeEntryEndTime("10:15"));
      act(() => latest.current.setTimeEntryNotes("   "));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(mockCreateTimeEntry.mock.calls[0]?.[1]?.notes).toBeUndefined();
    });

    it("closes the modal, calls onCreated, and shows a toast", async () => {
      mockCreateTimeEntry.mockResolvedValue({
        ok: true,
        data: { data: { entry_id: "te-1" } },
      });

      const onCreated = vi.fn();
      const { latest, showToast } = renderHook({ onCreated });
      act(() => latest.current.openTimeEntryModal(new Date("2026-05-05T00:00:00")));
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("10:00"));
      act(() => latest.current.setTimeEntryEndTime("10:30"));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(latest.current.timeEntryOpen).toBe(false);
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: "info",
          message: expect.stringContaining("timeEntry.createdMessage"),
        }),
      );
      // 30-minute duration is passed through to the toast
      expect((showToast.mock.calls[0]?.[0]?.message as string)).toContain('"minutes":30');
    });
  });

  describe("submitTimeEntry — error branches", () => {
    it("sets permission error on permission failure", async () => {
      mockCreateTimeEntry.mockResolvedValue({
        ok: false,
        error: { kind: "permission" },
      });

      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal(new Date("2026-05-05T00:00:00")));
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("10:00"));
      act(() => latest.current.setTimeEntryEndTime("10:30"));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(latest.current.timeEntryError).toBe("timeEntry.errors.permission");
      expect(latest.current.timeEntryOpen).toBe(true);
      expect(latest.current.timeEntryUpdating).toBe(false);
    });

    it("uses validation message from body when present", async () => {
      mockCreateTimeEntry.mockResolvedValue({
        ok: false,
        error: { kind: "validation", body: { error: { message: "Service not allowed" } } },
      });

      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal(new Date("2026-05-05T00:00:00")));
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("10:00"));
      act(() => latest.current.setTimeEntryEndTime("10:30"));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(latest.current.timeEntryError).toBe("Service not allowed");
    });

    it("falls back to validation key when body has no message", async () => {
      mockCreateTimeEntry.mockResolvedValue({
        ok: false,
        error: { kind: "validation", body: {} },
      });

      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal(new Date("2026-05-05T00:00:00")));
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("10:00"));
      act(() => latest.current.setTimeEntryEndTime("10:30"));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(latest.current.timeEntryError).toBe("timeEntry.errors.validation");
    });

    it("sets generic error for unknown failures", async () => {
      mockCreateTimeEntry.mockResolvedValue({
        ok: false,
        error: { kind: "server" },
      });

      const { latest } = renderHook();
      act(() => latest.current.openTimeEntryModal(new Date("2026-05-05T00:00:00")));
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("10:00"));
      act(() => latest.current.setTimeEntryEndTime("10:30"));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(latest.current.timeEntryError).toBe("timeEntry.errors.generic");
    });

    it("does not call onCreated on error", async () => {
      mockCreateTimeEntry.mockResolvedValue({
        ok: false,
        error: { kind: "server" },
      });

      const onCreated = vi.fn();
      const { latest } = renderHook({ onCreated });
      act(() => latest.current.openTimeEntryModal(new Date("2026-05-05T00:00:00")));
      act(() => latest.current.setTimeEntryServiceId("svc-1"));
      act(() => latest.current.setTimeEntryStartTime("10:00"));
      act(() => latest.current.setTimeEntryEndTime("10:30"));

      await act(async () => {
        await latest.current.submitTimeEntry();
      });

      expect(onCreated).not.toHaveBeenCalled();
    });
  });
});
