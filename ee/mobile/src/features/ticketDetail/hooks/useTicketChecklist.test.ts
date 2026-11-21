import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import type { ApiClient } from "../../../api";
import type { TicketChecklistItem } from "../../../api/ticketChecklist";

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));
vi.mock("../../../api/ticketChecklist", () => ({
  getTicketChecklist: vi.fn(),
  createTicketChecklistItem: vi.fn(),
  setTicketChecklistItemCompleted: vi.fn(),
}));

import {
  createTicketChecklistItem,
  getTicketChecklist,
  setTicketChecklistItemCompleted,
} from "../../../api/ticketChecklist";
import { useTicketChecklist } from "./useTicketChecklist";

const mockGet = getTicketChecklist as ReturnType<typeof vi.fn>;
const mockCreate = createTicketChecklistItem as ReturnType<typeof vi.fn>;
const mockSetCompleted = setTicketChecklistItemCompleted as ReturnType<typeof vi.fn>;

const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = { accessToken: "tok-1" };
const t = (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) ?? key;

function item(id: string, order: number, completed = false): TicketChecklistItem {
  return {
    checklist_item_id: id,
    ticket_id: "t-1",
    item_name: `Item ${id}`,
    description: null,
    order_number: order,
    assigned_to: null,
    is_required: false,
    completed,
    completed_by: null,
    completed_at: null,
    source: "manual",
  } as TicketChecklistItem;
}

type HookReturn = ReturnType<typeof useTicketChecklist>;

async function renderChecklistHook(opts?: { client?: ApiClient | null }) {
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };
  function Wrapper() {
    latest.current = useTicketChecklist({
      client: opts?.client !== undefined ? opts.client : fakeClient,
      session: fakeSession as any,
      ticketId: "t-1",
      showToast: vi.fn(),
      t,
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

describe("useTicketChecklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops loading and makes no request without a client", async () => {
    const h = await renderChecklistHook({ client: null });
    expect(h.result.loading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
    let added!: boolean;
    await act(async () => {
      added = await h.result.addItem("x", false);
      await h.result.toggleItem(item("a", 1));
    });
    expect(added).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSetCompleted).not.toHaveBeenCalled();
  });

  it("loads checklist items on mount", async () => {
    mockGet.mockResolvedValueOnce({ ok: true, data: { data: [item("a", 1)] } });
    const h = await renderChecklistHook();
    expect(mockGet).toHaveBeenCalledWith(fakeClient, { apiKey: "tok-1", ticketId: "t-1" });
    expect(h.result.loading).toBe(false);
    expect(h.result.hidden).toBe(false);
    expect(h.result.items).toEqual([item("a", 1)]);
  });

  it("hides the checklist when the user lacks permission", async () => {
    mockGet.mockResolvedValueOnce({ ok: false, error: { kind: "permission" } });
    const h = await renderChecklistHook();
    expect(h.result.hidden).toBe(true);
    expect(h.result.error).toBeNull();
    expect(h.result.loading).toBe(false);
  });

  it("shows a load error on other failures and when the request throws", async () => {
    mockGet.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    const h = await renderChecklistHook();
    expect(h.result.error).toBe("Unable to load checklist.");

    mockGet.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await h.result.fetchChecklist();
    });
    expect(h.result.error).toBe("Unable to load checklist.");
    expect(h.result.loading).toBe(false);
  });

  describe("addItem", () => {
    it("rejects a blank name", async () => {
      mockGet.mockResolvedValueOnce({ ok: true, data: { data: [] } });
      const h = await renderChecklistHook();
      let added!: boolean;
      await act(async () => {
        added = await h.result.addItem("   ", true);
      });
      expect(added).toBe(false);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("creates a trimmed item and keeps items ordered", async () => {
      mockGet.mockResolvedValueOnce({ ok: true, data: { data: [item("b", 2), item("c", 3)] } });
      mockCreate.mockResolvedValueOnce({ ok: true, data: { data: item("a", 1) } });
      const h = await renderChecklistHook();
      let added!: boolean;
      await act(async () => {
        added = await h.result.addItem("  New item ", true);
      });
      expect(added).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith(fakeClient, {
        apiKey: "tok-1",
        ticketId: "t-1",
        itemName: "New item",
        isRequired: true,
        auditHeaders: { "x-device": "test" },
      });
      expect(h.result.items.map((i) => i.checklist_item_id)).toEqual(["a", "b", "c"]);
      expect(h.result.adding).toBe(false);
    });

    it.each([
      ["permission", { kind: "permission" }, "You don't have permission to update this checklist."],
      ["validation", { kind: "validation", body: { error: { message: "Name too long" } } }, "Name too long"],
      ["validation fallback", { kind: "validation", body: {} }, "Unable to add checklist item."],
      ["server", { kind: "server" }, "Unable to add checklist item."],
    ])("reports a %s failure", async (_l, error, expected) => {
      mockGet.mockResolvedValueOnce({ ok: true, data: { data: [] } });
      mockCreate.mockResolvedValueOnce({ ok: false, error });
      const h = await renderChecklistHook();
      let added!: boolean;
      await act(async () => {
        added = await h.result.addItem("x", false);
      });
      expect(added).toBe(false);
      expect(h.result.actionError).toBe(expected);
      expect(h.result.items).toEqual([]);
    });
  });

  describe("toggleItem", () => {
    it("optimistically toggles and applies the server row", async () => {
      const a = item("a", 1);
      mockGet.mockResolvedValueOnce({ ok: true, data: { data: [a] } });
      let resolve!: (v: unknown) => void;
      mockSetCompleted.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const h = await renderChecklistHook();

      let pending!: Promise<void>;
      await act(async () => {
        pending = h.result.toggleItem(a);
        await Promise.resolve();
      });
      expect(h.result.items[0].completed).toBe(true);
      expect(h.result.updatingIds.has("a")).toBe(true);

      await act(async () => {
        await h.result.toggleItem(a);
      });
      expect(mockSetCompleted).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolve({ ok: true, data: { data: { ...a, completed: true, completed_by_name: "Tech" } } });
        await pending;
      });
      expect(mockSetCompleted).toHaveBeenCalledWith(fakeClient, {
        apiKey: "tok-1",
        ticketId: "t-1",
        itemId: "a",
        completed: true,
        auditHeaders: { "x-device": "test" },
      });
      expect(h.result.items[0]).toMatchObject({ completed: true, completed_by_name: "Tech" });
      expect(h.result.updatingIds.size).toBe(0);
    });

    it.each([
      ["permission", { kind: "permission" }, "You don't have permission to update this checklist."],
      ["server", { kind: "server" }, "Unable to update checklist item."],
    ])("rolls back on a %s failure", async (_l, error, expected) => {
      const a = item("a", 1, true);
      mockGet.mockResolvedValueOnce({ ok: true, data: { data: [a, item("b", 2)] } });
      mockSetCompleted.mockResolvedValueOnce({ ok: false, error });
      const h = await renderChecklistHook();
      await act(async () => {
        await h.result.toggleItem(a);
      });
      expect(mockSetCompleted.mock.calls[0][1].completed).toBe(false);
      expect(h.result.items[0]).toEqual(a);
      expect(h.result.actionError).toBe(expected);
      expect(h.result.updatingIds.size).toBe(0);
    });
  });
});
