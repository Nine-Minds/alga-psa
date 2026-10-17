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
});
