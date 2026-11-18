import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
  return {
    t,
    session: { accessToken: "key-1", tenantId: "tenant-1", user: { id: "u-1" } } as null | Record<string, any>,
    config: { ok: true, baseUrl: "https://psa.example.com" } as Record<string, unknown>,
    week: {
      entriesByDay: new Map<string, unknown[]>(),
      loading: false,
      error: null as string | null,
      noAccess: false,
      refresh: vi.fn(),
    },
    weekArgs: [] as Array<Record<string, unknown>>,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    clearCache: vi.fn(),
    resume: null as null | (() => void),
  };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ session: mocks.session, refreshSession: vi.fn() }) }));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/schedule", () => ({
  createScheduleEntry: (...args: unknown[]) => mocks.create(...args),
  updateScheduleEntry: (...args: unknown[]) => mocks.update(...args),
  deleteScheduleEntry: (...args: unknown[]) => mocks.remove(...args),
}));
vi.mock("../cache/scheduleCache", () => ({ clearScheduleCache: () => mocks.clearCache() }));
vi.mock("../features/schedule/useScheduleWeek", () => ({
  useScheduleWeek: (args: Record<string, unknown>) => {
    mocks.weekArgs.push(args);
    return mocks.week;
  },
}));
vi.mock("../hooks/useAppResume", () => ({
  useAppResume: (cb: () => void) => {
    mocks.resume = cb;
  },
}));
vi.mock("../features/schedule/components/ScheduleEntryDetailModal", async (importOriginal) => {
  const R = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    ScheduleEntryDetailModal: (props: Record<string, unknown>) => R.createElement("ScheduleEntryDetailModal", props),
  };
});
vi.mock("../features/schedule/components/ScheduleEntryFormModal", async () => {
  const R = await import("react");
  return { ScheduleEntryFormModal: (props: Record<string, unknown>) => R.createElement("ScheduleEntryFormModal", props) };
});

import { formatDateShort } from "../ui/formatters/dateTime";
import { ScheduleScreen } from "./ScheduleScreen";

const navigate = vi.fn();

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    entry_id: id,
    title: `Entry ${id}`,
    scheduled_start: new Date(2026, 10, 18, 9).toISOString(),
    scheduled_end: new Date(2026, 10, 18, 10).toISOString(),
    work_item_id: null,
    work_item_type: "meeting",
    notes: null,
    is_private: false,
    created_by: "u-1",
    ...overrides,
  };
}

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => [].concat(n.props.children ?? []).join(""))
    .join("\n");
const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((n) => String(n.type) === "Pressable" && n.props.accessibilityLabel === label);
const detail = (tree: ReactTestRenderer) => tree.root.find((n) => String(n.type) === "ScheduleEntryDetailModal");
const form = (tree: ReactTestRenderer) => tree.root.find((n) => String(n.type) === "ScheduleEntryFormModal");
const lastWeekKey = () => mocks.weekArgs[mocks.weekArgs.length - 1].weekStartKey;

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ScheduleScreen {...({ navigation: { navigate }, route: { key: "s", name: "ScheduleTab" } } as unknown as React.ComponentProps<typeof ScheduleScreen>)} />);
  });
  return tree;
}

function formValue(overrides: Record<string, unknown> = {}) {
  return {
    kind: "meeting",
    title: " Sync ",
    date: new Date(2026, 10, 18),
    startTime: "13:00",
    endTime: "14:00",
    notes: " agenda ",
    ticketId: null,
    ticketLabel: null,
    ...overrides,
  };
}

describe("ScheduleScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 18, 10, 0) });
    vi.clearAllMocks();
    mocks.weekArgs = [];
    mocks.session = { accessToken: "key-1", tenantId: "tenant-1", user: { id: "u-1" } };
    mocks.config = { ok: true, baseUrl: "https://psa.example.com" };
    mocks.week = {
      entriesByDay: new Map([["2026-11-18", [entry("e-1"), entry("e-2", { work_item_type: "ticket", work_item_id: "t-1", is_private: true, recurrence_pattern: "weekly" })]]]),
      loading: false,
      error: null,
      noAccess: false,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    mocks.create.mockResolvedValue({ ok: true, data: {} });
    mocks.update.mockResolvedValue({ ok: true, data: {} });
    mocks.remove.mockResolvedValue({ ok: true, data: {} });
  });
  afterEach(() => vi.useRealTimers());

  it("loads the current week for the signed-in user and lists today's entries", async () => {
    const tree = await render();
    expect(mocks.weekArgs[0]).toMatchObject({ apiKey: "key-1", userId: "u-1", weekStartKey: "2026-11-16" });
    const all = text(tree);
    expect(all).toContain("Entry e-1");
    expect(all).toContain("Entry e-2");
    expect(all).toContain("Meeting");
    expect(all).toContain("Ticket");
  });

  it("shows configuration, signed-out and no-access states", async () => {
    mocks.config = { ok: false, error: "bad config" };
    expect(text(await render())).toContain("bad config");
    mocks.config = { ok: true, baseUrl: "https://psa.example.com" };
    mocks.session = null;
    expect(text(await render())).toContain("common:signInAgain");
    mocks.session = { accessToken: "key-1", tenantId: "tenant-1", user: { id: "u-1" } };
    mocks.week.noAccess = true;
    expect(text(await render())).toContain("No schedule access");
  });

  it("shows loading only while there is nothing to show", async () => {
    mocks.week.loading = true;
    mocks.week.entriesByDay = new Map();
    expect(text(await render())).toContain("Loading your schedule…");
  });

  it("shows a full error with retry when nothing loaded, and an inline error otherwise", async () => {
    mocks.week.error = "Network down";
    const withData = await render();
    expect(text(withData)).toContain("Network down");
    expect(text(withData)).toContain("Entry e-1");

    mocks.week.entriesByDay = new Map();
    const tree = await render();
    expect(text(tree)).toContain("Unable to load schedule");
    const retry = tree.root.find((n) => String(n.type) === "Pressable" && n.findAll((c) => c.props.children === "common:retry").length > 0);
    await act(async () => retry.props.onPress());
    expect(mocks.week.refresh).toHaveBeenCalled();
  });

  it("shows the empty-day state when a day has no entries", async () => {
    const tree = await render();
    act(() => pressable(tree, formatDateShort("2026-11-20")).props.onPress());
    expect(text(tree)).toContain("Nothing scheduled");
  });

  it("navigates weeks keeping the weekday, and Today jumps back", async () => {
    const tree = await render();
    act(() => pressable(tree, "Next week").props.onPress());
    expect(lastWeekKey()).toBe("2026-11-23");
    expect(text(tree)).toContain(formatDateShort("2026-11-25"));
    act(() => pressable(tree, "Previous week").props.onPress());
    act(() => pressable(tree, "Previous week").props.onPress());
    expect(lastWeekKey()).toBe("2026-11-09");
    act(() => pressable(tree, "Today").props.onPress());
    expect(lastWeekKey()).toBe("2026-11-16");
  });

  it("refreshes on app resume and pull to refresh", async () => {
    const tree = await render();
    await act(async () => mocks.resume?.());
    expect(mocks.week.refresh).toHaveBeenCalledTimes(1);
    await act(async () => tree.root.find((n) => String(n.type) === "FlatList").props.refreshControl.props.onRefresh());
    expect(mocks.week.refresh).toHaveBeenCalledTimes(2);
  });

  it("opens entry detail and navigates to ticket, client and contact", async () => {
    const tree = await render();
    expect(detail(tree).props.visible).toBe(false);
    act(() => pressable(tree, "Entry e-2").props.onPress());
    expect(detail(tree).props.visible).toBe(true);
    expect(detail(tree).props.entry.entry_id).toBe("e-2");
    expect(detail(tree).props.currentUserId).toBe("u-1");
    act(() => detail(tree).props.onOpenTicket("t-1"));
    expect(navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "t-1" });
    expect(detail(tree).props.visible).toBe(false);
    act(() => detail(tree).props.onOpenClient("c-1", "ECTS"));
    expect(navigate).toHaveBeenCalledWith("ClientDetail", { clientId: "c-1", clientName: "ECTS" });
    act(() => detail(tree).props.onOpenContact("p-1", "Ann"));
    expect(navigate).toHaveBeenCalledWith("ContactDetail", { contactId: "p-1", contactName: "Ann" });
    act(() => pressable(tree, "Entry e-1").props.onPress());
    act(() => detail(tree).props.onClose());
    expect(detail(tree).props.visible).toBe(false);
  });

  it("deletes an entry, clears the cache and refreshes", async () => {
    const tree = await render();
    act(() => pressable(tree, "Entry e-1").props.onPress());
    await act(async () => detail(tree).props.onDelete(detail(tree).props.entry));
    expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), { apiKey: "key-1", entryId: "e-1" });
    expect(mocks.clearCache).toHaveBeenCalled();
    expect(mocks.week.refresh).toHaveBeenCalled();
    expect(detail(tree).props.visible).toBe(false);
  });

  it("keeps the detail open with an error when delete fails", async () => {
    mocks.remove.mockResolvedValue({ ok: false, error: { kind: "permission", message: "x" } });
    const tree = await render();
    act(() => pressable(tree, "Entry e-1").props.onPress());
    await act(async () => detail(tree).props.onDelete(detail(tree).props.entry));
    expect(detail(tree).props.visible).toBe(true);
    expect(detail(tree).props.error).toBe("You don't have permission to do that.");
    mocks.remove.mockResolvedValue({ ok: false, error: { kind: "server", message: "x" } });
    await act(async () => detail(tree).props.onDelete(detail(tree).props.entry));
    expect(detail(tree).props.error).toBe("Unable to delete. Please try again.");
  });

  it("creates an entry for the current user from the FAB", async () => {
    const tree = await render();
    act(() => pressable(tree, "Add schedule entry").props.onPress());
    expect(form(tree).props.visible).toBe(true);
    expect(form(tree).props.mode).toBe("create");
    expect(form(tree).props.initial).toMatchObject({ kind: "meeting", title: "", startTime: "11:00", endTime: "12:00" });
    await act(async () => form(tree).props.onSubmit(formValue()));
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), {
      apiKey: "key-1",
      entry: {
        title: "Sync",
        scheduled_start: new Date(2026, 10, 18, 13).toISOString(),
        scheduled_end: new Date(2026, 10, 18, 14).toISOString(),
        work_item_type: "meeting",
        notes: "agenda",
        assigned_user_ids: ["u-1"],
      },
    });
    expect(form(tree).props.visible).toBe(false);
    expect(mocks.clearCache).toHaveBeenCalled();
    expect(mocks.week.refresh).toHaveBeenCalled();
  });

  it("creating a ticket entry in another week jumps to that week instead of refreshing", async () => {
    const tree = await render();
    act(() => pressable(tree, "Add schedule entry").props.onPress());
    await act(async () =>
      form(tree).props.onSubmit(formValue({ kind: "ticket", ticketId: "t-7", notes: "  ", date: new Date(2026, 11, 2) })),
    );
    const body = mocks.create.mock.calls[0][1].entry;
    expect(body.work_item_id).toBe("t-7");
    expect(body.notes).toBeUndefined();
    expect(lastWeekKey()).toBe("2026-11-30");
    expect(mocks.week.refresh).not.toHaveBeenCalled();
  });

  it("rejects invalid times without calling the API", async () => {
    const tree = await render();
    act(() => pressable(tree, "Add schedule entry").props.onPress());
    await act(async () => form(tree).props.onSubmit(formValue({ endTime: "12:00" })));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(form(tree).props.error).toBe("End time must be after start time.");
  });

  it("shows validation messages from the server, else a generic save error", async () => {
    const tree = await render();
    act(() => pressable(tree, "Add schedule entry").props.onPress());
    mocks.create.mockResolvedValueOnce({ ok: false, error: { kind: "validation", message: "Title too long" } });
    await act(async () => form(tree).props.onSubmit(formValue()));
    expect(form(tree).props.error).toBe("Title too long");
    expect(form(tree).props.visible).toBe(true);
    mocks.create.mockResolvedValueOnce({ ok: false, error: { kind: "validation", message: "HTTP 422" } });
    await act(async () => form(tree).props.onSubmit(formValue()));
    expect(form(tree).props.error).toBe("Unable to save. Please try again.");
    act(() => form(tree).props.onClose());
    expect(form(tree).props.visible).toBe(false);
  });

  it("edits an entry from detail, sending a changed ticket", async () => {
    const tree = await render();
    act(() => pressable(tree, "Entry e-2").props.onPress());
    act(() => detail(tree).props.onEdit(detail(tree).props.entry));
    expect(detail(tree).props.visible).toBe(false);
    expect(form(tree).props.mode).toBe("edit");
    expect(form(tree).props.initial).toMatchObject({ kind: "ticket", title: "Entry e-2", startTime: "09:00", endTime: "10:00", ticketId: "t-1" });
    await act(async () => form(tree).props.onSubmit(formValue({ kind: "ticket", ticketId: "t-2" })));
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), {
      apiKey: "key-1",
      entryId: "e-2",
      entry: {
        title: "Sync",
        scheduled_start: new Date(2026, 10, 18, 13).toISOString(),
        scheduled_end: new Date(2026, 10, 18, 14).toISOString(),
        notes: "agenda",
        work_item_id: "t-2",
      },
    });
    expect(form(tree).props.visible).toBe(false);
  });

  it("edit maps entry kinds and falls back on unparsable times", async () => {
    mocks.week.entriesByDay = new Map([
      ["2026-11-18", [entry("b", { work_item_type: "break" }), entry("o", { work_item_type: "ad_hoc", scheduled_start: "bad", scheduled_end: "bad", notes: "n" })]],
    ]);
    const tree = await render();
    act(() => pressable(tree, "Entry b").props.onPress());
    act(() => detail(tree).props.onEdit(detail(tree).props.entry));
    expect(form(tree).props.initial.kind).toBe("break");
    act(() => pressable(tree, "Entry o").props.onPress());
    act(() => detail(tree).props.onEdit(detail(tree).props.entry));
    expect(form(tree).props.initial).toMatchObject({ kind: "other", startTime: "09:00", endTime: "10:00", notes: "n", ticketId: null });
    await act(async () => form(tree).props.onSubmit(formValue()));
    expect(mocks.update.mock.calls[0][1].entry.work_item_id).toBeUndefined();
  });
});
