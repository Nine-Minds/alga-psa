import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import { useTicketCategory } from "./useTicketCategory";
import type { ApiClient } from "../../../api/client";

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));

vi.mock("../../../cache/ticketsCache", () => ({
  invalidateTicketsListCache: vi.fn(),
}));

vi.mock("../../../api/tickets", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../api/tickets")>();
  return { ...original, getTicketCategories: vi.fn(), updateTicketCategory: vi.fn() };
});

import { getTicketCategories, updateTicketCategory } from "../../../api/tickets";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";

const mockList = getTicketCategories as ReturnType<typeof vi.fn>;
const mockUpdate = updateTicketCategory as ReturnType<typeof vi.fn>;
const mockInvalidate = invalidateTicketsListCache as ReturnType<typeof vi.fn>;

const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = {
  accessToken: "tok-123",
  tenantId: "tenant-1",
  user: { id: "user-1" },
};

const categories = [
  { category_id: "hardware", category_name: "Hardware", parent_category: null },
  { category_id: "laptop", category_name: "Laptop", parent_category: "hardware" },
];

type HookReturn = ReturnType<typeof useTicketCategory>;

function renderHook(opts?: { boardId?: string | null; session?: any }) {
  const fetchTicket = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };

  function Wrapper() {
    latest.current = useTicketCategory({
      client: fakeClient,
      session: opts?.session !== undefined ? opts.session : (fakeSession as any),
      ticketId: "t-1",
      t: (key: string) => key,
      showToast,
      fetchTicket,
      boardId: opts?.boardId ?? "board-1",
    });
    return null;
  }

  act(() => {
    create(React.createElement(Wrapper));
  });

  return { latest, fetchTicket, showToast };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTicketCategory", () => {
  it("loads the board's categories when the picker opens", async () => {
    mockList.mockResolvedValue({ ok: true, data: { data: categories } });
    const { latest } = renderHook();

    await act(async () => { await latest.current.openCategoryPicker(); });

    expect(mockList).toHaveBeenCalledWith(fakeClient, { apiKey: "tok-123", board_id: "board-1" });
    expect(latest.current.categoryPickerOpen).toBe(true);
    expect(latest.current.categoryOptions).toEqual(categories);
  });

  it("surfaces a permission failure instead of an empty list", async () => {
    mockList.mockResolvedValue({ ok: false, error: { kind: "permission" } });
    const { latest } = renderHook({ session: { ...fakeSession, tenantId: "tenant-no-perm" } });

    await act(async () => { await latest.current.openCategoryPicker(); });

    expect(latest.current.categoryOptionsError).toBe("detail.errors.categoryPermission");
  });

  it("writes the parent/child pair for a subcategory", async () => {
    mockList.mockResolvedValue({ ok: true, data: { data: categories } });
    mockUpdate.mockResolvedValue({ ok: true, data: { data: {} } });
    const { latest, fetchTicket } = renderHook({ boardId: "board-pair" });

    await act(async () => { await latest.current.openCategoryPicker(); });
    await act(async () => { await latest.current.submitCategory("laptop"); });

    expect(mockUpdate).toHaveBeenCalledWith(fakeClient, expect.objectContaining({
      ticketId: "t-1",
      category_id: "hardware",
      subcategory_id: "laptop",
      auditHeaders: { "x-device": "test" },
    }));
    expect(mockInvalidate).toHaveBeenCalled();
    expect(fetchTicket).toHaveBeenCalled();
    expect(latest.current.categoryPickerOpen).toBe(false);
  });

  it("clears both columns when the selection is removed", async () => {
    mockList.mockResolvedValue({ ok: true, data: { data: categories } });
    mockUpdate.mockResolvedValue({ ok: true, data: { data: {} } });
    const { latest } = renderHook({ boardId: "board-clear" });

    await act(async () => { await latest.current.openCategoryPicker(); });
    await act(async () => { await latest.current.submitCategory(null); });

    expect(mockUpdate).toHaveBeenCalledWith(fakeClient, expect.objectContaining({
      category_id: null,
      subcategory_id: null,
    }));
  });

  it("keeps the picker open and shows the server message on a validation failure", async () => {
    mockList.mockResolvedValue({ ok: true, data: { data: categories } });
    mockUpdate.mockResolvedValue({
      ok: false,
      error: { kind: "validation", body: { error: { message: "Invalid category combination" } } },
    });
    const { latest, fetchTicket } = renderHook({ boardId: "board-invalid" });

    await act(async () => { await latest.current.openCategoryPicker(); });
    await act(async () => { await latest.current.submitCategory("laptop"); });

    expect(latest.current.categoryUpdateError).toBe("Invalid category combination");
    expect(latest.current.categoryPickerOpen).toBe(true);
    expect(fetchTicket).not.toHaveBeenCalled();
  });
});
