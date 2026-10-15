import { describe, expect, it } from "vitest";
import type { TicketStatus } from "../api/tickets";
import { groupStatusesByName, resolveStatusIdsByName, statusNamesFromIds } from "./ticketsStatusFilter";

const statuses: TicketStatus[] = [
  { status_id: "a-open", board_id: "board-a", name: "Open", is_closed: false },
  { status_id: "a-closed", board_id: "board-a", name: "Closed", is_closed: true },
  { status_id: "b-open", board_id: "board-b", name: "Open", is_closed: false },
  { status_id: "b-hold", board_id: "board-b", name: "On hold", is_closed: false },
];

describe("ticketsStatusFilter", () => {
  it("groups same-named statuses across boards", () => {
    expect(groupStatusesByName(statuses)).toEqual([
      { name: "Open", ids: ["a-open", "b-open"], isClosed: false },
      { name: "Closed", ids: ["a-closed"], isClosed: true },
      { name: "On hold", ids: ["b-hold"], isClosed: false },
    ]);
  });

  it("resolves a name selection to the ids on every board, including boards added later", () => {
    expect(resolveStatusIdsByName(statuses, ["Open"])).toEqual(["a-open", "b-open"]);
    const withNewBoard = [...statuses, { status_id: "c-open", board_id: "board-c", name: "Open", is_closed: false }];
    expect(resolveStatusIdsByName(withNewBoard, ["Open"])).toEqual(["a-open", "b-open", "c-open"]);
    expect(resolveStatusIdsByName(statuses, [])).toEqual([]);
  });

  it("recovers names from a legacy id selection", () => {
    expect(statusNamesFromIds(statuses, ["a-open", "b-hold", "gone"])).toEqual(["Open", "On hold"]);
  });
});
