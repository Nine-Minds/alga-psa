import { describe, expect, it, vi } from "vitest";
import { resolveReminderTarget } from "./reminderTarget";

describe("resolveReminderTarget", () => {
  it("opens the ticket for entries booked directly on a ticket", async () => {
    const lookup = vi.fn();
    await expect(resolveReminderTarget({ workItemType: "ticket", workItemId: "t-1" }, lookup)).resolves.toEqual({ kind: "ticket", ticketId: "t-1" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("resolves an interaction entry to its ticket", async () => {
    const lookup = vi.fn(async () => "t-9");
    await expect(resolveReminderTarget({ workItemType: "interaction", workItemId: "i-1" }, lookup)).resolves.toEqual({ kind: "ticket", ticketId: "t-9" });
    expect(lookup).toHaveBeenCalledWith("i-1");
  });

  it("falls back to the schedule when the interaction has no ticket or the lookup fails", async () => {
    await expect(resolveReminderTarget({ workItemType: "interaction", workItemId: "i-1" }, async () => null)).resolves.toEqual({ kind: "schedule" });
    await expect(resolveReminderTarget({ workItemType: "interaction", workItemId: "i-1" }, async () => { throw new Error("offline"); })).resolves.toEqual({ kind: "schedule" });
    await expect(resolveReminderTarget({ workItemType: null }, async () => null)).resolves.toEqual({ kind: "schedule" });
  });
});
