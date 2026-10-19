import { describe, expect, it } from "vitest";
import { stripTransientRouteParams } from "./navStatePersistence";

/**
 * T099: an audit session is server-authoritative, so its auditId survives a
 * relaunch while the display-only params do not.
 */
describe("navStatePersistence audit session", () => {
  it("keeps auditId and drops the transient names", () => {
    const state = {
      routes: [
        {
          name: "AuditSession",
          params: { auditId: "au-1", clientName: "ECTS", locationName: "HQ" },
        },
      ],
    };

    const stripped = stripTransientRouteParams(state);

    expect(stripped.routes[0].params).toEqual({ auditId: "au-1" });
  });

  it("drops the tickets assignee preset so a relaunch is not stuck on it", () => {
    const state = {
      routes: [{ name: "TicketsList", params: { assignee: "me", clientId: "cl-1" } }],
    };

    expect(stripTransientRouteParams(state).routes[0].params).toBeUndefined();
  });

  it("T139 drops the Inventory scan segment so a relaunch does not open the camera", () => {
    const state = {
      routes: [
        {
          name: "Tabs",
          params: { screen: "InventoryTab", params: { segment: "scan" } },
          state: { routes: [{ name: "InventoryTab", params: { segment: "scan" } }] },
        },
      ],
    };

    const stripped = stripTransientRouteParams(state);

    expect(stripped.routes[0].params).toEqual({ screen: "InventoryTab" });
    expect(stripped.routes[0].state!.routes![0].params).toBeUndefined();
  });
});
