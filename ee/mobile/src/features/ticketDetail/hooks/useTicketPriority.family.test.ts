import { describe, expect, it, vi } from "vitest";

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../../cache/ticketsCache", () => ({ invalidateTicketsListCache: vi.fn() }));
vi.mock("../../../cache/referenceDataCache", () => ({
  getCachedTicketPriorities: vi.fn(() => null),
  setCachedTicketPriorities: vi.fn(),
}));
vi.mock("../../../api/tickets", () => ({
  getTicketPriorities: vi.fn(),
  updateTicketPriority: vi.fn(),
}));

import React from "react";
import { act, create } from "react-test-renderer";
import type { ApiClient } from "../../../api";
import { getTicketPriorities } from "../../../api/tickets";
import { prioritiesOfSameFamily, useTicketPriority } from "./useTicketPriority";

const custom = { priority_id: "c1", priority_name: "Whimsical Wish", is_from_itil_standard: false };
const itil = { priority_id: "i1", priority_name: "P3 - Medium", is_from_itil_standard: true };

describe("prioritiesOfSameFamily", () => {
  it("keeps a ticket on a custom-priority board to custom priorities, and an ITIL one to ITIL", () => {
    expect(prioritiesOfSameFamily([custom, itil], "c1")).toEqual([custom]);
    expect(prioritiesOfSameFamily([custom, itil], "i1")).toEqual([itil]);
  });

  it("offers everything without a current priority or without the server's ITIL flag", () => {
    expect(prioritiesOfSameFamily([custom, itil], null)).toEqual([custom, itil]);
    const legacy = [{ priority_id: "c1", priority_name: "Whimsical Wish" }, { priority_id: "i1", priority_name: "P3 - Medium" }];
    expect(prioritiesOfSameFamily(legacy, "c1")).toEqual(legacy);
  });
});

/**
 * T182 — F102 of `ee/plans/2026-11-21-itil-remediation` (`priority-pickers`).
 *
 * The heuristic above cannot answer "a ticket with no priority on a board that uses ITIL
 * priorities": with nothing to compare, it offered every priority. The hook now asks the server
 * for the board's own list (R3) and shows it as it came.
 */
describe("the priorities of a ticket's board", () => {
  const mockGet = getTicketPriorities as ReturnType<typeof vi.fn>;
  const itilOnly = [{ priority_id: "i1", priority_name: "P3 - Medium", is_from_itil_standard: true }];

  function renderWithBoard(boardId: string | null, currentPriorityId: string | null) {
    const latest: { current: ReturnType<typeof useTicketPriority> } = {
      current: undefined as unknown as ReturnType<typeof useTicketPriority>,
    };
    function Wrapper() {
      latest.current = useTicketPriority({
        client: { request: vi.fn() } as unknown as ApiClient,
        session: { accessToken: "tok", tenantId: "ten" } as never,
        ticketId: "t-1",
        showToast: vi.fn(),
        t: (key: string) => key,
        fetchTicket: vi.fn().mockResolvedValue(undefined),
        currentPriorityId,
        boardId,
      } as never);
      return null;
    }
    act(() => {
      create(React.createElement(Wrapper));
    });
    return latest;
  }

  it("asks for the board's priorities and lists them unfiltered", async () => {
    mockGet.mockResolvedValue({ ok: true, data: { data: itilOnly } });
    const hook = renderWithBoard("board-itil-two", null);
    await act(async () => {
      await hook.current.openPriorityPicker();
    });

    expect(mockGet).toHaveBeenCalledWith(expect.anything(), { apiKey: "tok", boardId: "board-itil-two" });
    // A ticket with no priority yet still sees only what the board uses.
    expect(hook.current.priorityOptions).toEqual(itilOnly);
  });

  it("falls back to the current priority's family when the board is unknown", async () => {
    mockGet.mockResolvedValue({
      ok: true,
      data: {
        data: [
          { priority_id: "c1", priority_name: "Whimsical Wish", is_from_itil_standard: false },
          ...itilOnly,
        ],
      },
    });
    const hook = renderWithBoard(null, "c1");
    await act(async () => {
      await hook.current.openPriorityPicker();
    });

    expect(mockGet).toHaveBeenCalledWith(expect.anything(), { apiKey: "tok", boardId: null });
    expect(hook.current.priorityOptions.map((option) => option.priority_id)).toEqual(["c1"]);
  });
});
