import { describe, expect, it } from "vitest";
import type { Activity } from "../../api/activities";
import { scheduleActivityTarget } from "./scheduleActivityTarget";

function scheduleActivity(over: Partial<Activity> & Record<string, unknown>): Activity {
  return {
    id: "a1",
    title: "Follow up with Acme",
    type: "schedule",
    status: "open",
    priority: "medium",
    sourceId: "s1",
    sourceType: "schedule",
    actions: [],
    tenant: "t1",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...over,
  } as unknown as Activity;
}

describe("scheduleActivityTarget", () => {
  it("routes an opportunity next-action to the deal, not the calendar", () => {
    const activity = scheduleActivity({ workItemType: "opportunity", workItemId: "opp-9", title: "Call the buyer" });
    expect(scheduleActivityTarget(activity)).toEqual({
      kind: "opportunity",
      opportunityId: "opp-9",
      title: "Call the buyer",
    });
  });

  it("treats an ad_hoc entry as an editable personal to-do", () => {
    const activity = scheduleActivity({ workItemType: "ad_hoc" });
    expect(scheduleActivityTarget(activity)).toEqual({ kind: "adhoc" });
  });

  it("routes a ticket-linked schedule entry to the ticket", () => {
    const activity = scheduleActivity({ workItemType: "ticket", workItemId: "tk-3" });
    expect(scheduleActivityTarget(activity)).toEqual({ kind: "ticket", ticketId: "tk-3" });
  });

  it("falls back to the calendar for a plain schedule entry", () => {
    const activity = scheduleActivity({ workItemType: "meeting", workItemId: "entry-1" });
    expect(scheduleActivityTarget(activity)).toEqual({ kind: "calendar" });
  });

  it("falls back to the calendar when an opportunity activity is missing its id", () => {
    const activity = scheduleActivity({ workItemType: "opportunity" });
    expect(scheduleActivityTarget(activity)).toEqual({ kind: "calendar" });
  });
});
