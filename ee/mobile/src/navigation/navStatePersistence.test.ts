import { describe, expect, it } from "vitest";
import { stripTransientRouteParams } from "./navStatePersistence";

describe("stripTransientRouteParams", () => {
  it("drops client and contact drill-down params from a nested TicketsList route", () => {
    const state = {
      routes: [{
        name: "Tabs",
        state: {
          routes: [{
            name: "TicketsTab",
            state: {
              routes: [
                { name: "TicketsList", params: { clientId: "c-1", clientName: "Acme", contactId: "p-1", contactName: "Sam" } },
                { name: "TicketDetail", params: { ticketId: "t-1" } },
              ],
            },
          }],
        },
      }],
    };
    const stripped = stripTransientRouteParams(state);
    const list = stripped.routes[0].state!.routes![0].state!.routes![0];
    expect(list.params).toBeUndefined();
    expect(stripped.routes[0].state!.routes![0].state!.routes![1].params).toEqual({ ticketId: "t-1" });
  });

  it("returns the same object when nothing is transient", () => {
    const state = { routes: [{ name: "TicketsList", params: { other: 1 } }, { name: "Settings" }] };
    expect(stripTransientRouteParams(state)).toBe(state);
    expect(stripTransientRouteParams(undefined)).toBeUndefined();
  });
});
