import { describe, expect, it } from "vitest";
import type { TicketDetail } from "../../api/tickets";
import {
  dateInputToIso,
  extractDescription,
  getApiErrorMessage,
  getDueDateIso,
  getTicketAttributes,
  getWatcherUserIds,
  isoToDateInput,
  minutesToHHMM,
  parseHHMM,
  stringOrDash,
  ticketUpdateSuccessMessage,
  toMinutesOfDay,
} from "./utils";

const ticket = (fields: Partial<TicketDetail>) => ({ ticket_id: "t-1", ...fields }) as TicketDetail;
const t = (key: string) => key;

describe("ticketDetail utils", () => {
  it("ticketUpdateSuccessMessage prefers the strongest suppression, else the fallback", () => {
    expect(
      ticketUpdateSuccessMessage(t, { suppressInternalNotifications: true, suppressContactNotifications: true }, "fb"),
    ).toBe("notifications.suppression.successAll");
    expect(ticketUpdateSuccessMessage(t, { suppressContactNotifications: true, suppressInternalNotifications: false }, "fb")).toBe(
      "notifications.suppression.successCustomer",
    );
    expect(ticketUpdateSuccessMessage(t, undefined, "fb")).toBe("fb");
  });

  it("stringOrDash shows a dash for blank or non-string values", () => {
    expect(stringOrDash("Acme")).toBe("Acme");
    expect(stringOrDash("  ")).toBe("—");
    expect(stringOrDash(42)).toBe("—");
    expect(stringOrDash(null)).toBe("—");
  });

  it("extractDescription handles string, block array, ProseMirror doc and unknown shapes", () => {
    expect(extractDescription(ticket({ attributes: { description: " Plain " } }))).toBe("Plain");
    expect(extractDescription(ticket({ attributes: { description: "   " } }))).toBeNull();
    expect(extractDescription(ticket({ attributes: { description: [{ type: "p" }] } }))).toBe('[{"type":"p"}]');
    expect(extractDescription(ticket({ attributes: { description: [] } }))).toBeNull();
    const doc = { type: "doc", content: [] };
    expect(extractDescription(ticket({ attributes: { description: doc } }))).toBe(JSON.stringify(doc));
    expect(extractDescription(ticket({ attributes: { description: { type: "other" } } }))).toBeNull();
    expect(extractDescription(ticket({ attributes: null as any }))).toBeNull();
  });

  it("getTicketAttributes returns a copy, or empty for missing attributes", () => {
    const attrs = { a: 1 };
    const copy = getTicketAttributes(ticket({ attributes: attrs }));
    expect(copy).toEqual(attrs);
    expect(copy).not.toBe(attrs);
    expect(getTicketAttributes(ticket({ attributes: undefined }))).toEqual({});
  });

  it("getDueDateIso reads the column first, then attributes", () => {
    expect(getDueDateIso(ticket({ due_date: "2026-01-01T00:00:00Z" }))).toBe("2026-01-01T00:00:00Z");
    expect(getDueDateIso(ticket({ due_date: " ", attributes: { due_date: "2026-02-02" } }))).toBe("2026-02-02");
    expect(getDueDateIso(ticket({ attributes: { due_date: "" } }))).toBeNull();
    expect(getDueDateIso(ticket({}))).toBeNull();
  });

  it("getWatcherUserIds keeps only non-blank string ids", () => {
    expect(getWatcherUserIds(ticket({ attributes: { watcher_user_ids: ["u1", "", 3, " ", "u2"] } as any }))).toEqual(["u1", "u2"]);
    expect(getWatcherUserIds(ticket({ attributes: { watcher_user_ids: "u1" } as any }))).toEqual([]);
    expect(getWatcherUserIds(ticket({}))).toEqual([]);
  });

  it("isoToDateInput and dateInputToIso validate their input", () => {
    expect(isoToDateInput("2026-03-04T12:00:00.000Z")).toBe("2026-03-04");
    expect(isoToDateInput(null)).toBeNull();
    expect(isoToDateInput("garbage")).toBeNull();
    expect(dateInputToIso("2026-03-04")).toBe(new Date("2026-03-04T00:00:00").toISOString());
    expect(dateInputToIso("03/04/2026")).toBeNull();
    expect(dateInputToIso("2026-13-45")).toBeNull();
  });

  it("getApiErrorMessage prefers details over the message", () => {
    expect(getApiErrorMessage(null)).toBeNull();
    expect(getApiErrorMessage({})).toBeNull();
    expect(getApiErrorMessage({ error: { message: " Bad " } })).toBe("Bad");
    expect(getApiErrorMessage({ error: { message: "  " } })).toBeNull();
    expect(getApiErrorMessage({ error: { message: "Bad", details: " Specific " } })).toBe("Specific");
    expect(
      getApiErrorMessage({ error: { message: "Bad", details: [{ message: "Required", path: ["items", 0, "name"] }] } }),
    ).toBe("items.0.name: Required");
    expect(getApiErrorMessage({ error: { message: "Bad", details: [{ message: "Required" }] } })).toBe("Required");
    expect(getApiErrorMessage({ error: { message: "Bad", details: [{ path: ["x"] }] } })).toBe("Bad");
    expect(getApiErrorMessage({ error: { message: "Bad", details: {} } })).toBe("Bad");
  });

  it("parses and formats HH:MM times", () => {
    expect(parseHHMM(" 9:05 ")).toEqual({ hours: 9, minutes: 5 });
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("12:60")).toBeNull();
    expect(parseHHMM("noon")).toBeNull();
    expect(toMinutesOfDay("01:30")).toBe(90);
    expect(toMinutesOfDay("bad")).toBeNull();
    expect(minutesToHHMM(90)).toBe("01:30");
    expect(minutesToHHMM(24 * 60 + 5)).toBe("00:05");
  });
});
