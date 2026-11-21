import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "../api/activities";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listActivities: vi.fn(),
  listActivitiesGrouped: vi.fn(),
  listActivityGroups: vi.fn(),
  createAdHocEntry: vi.fn(),
  updateAdHocEntry: vi.fn(),
  setAdHocDone: vi.fn(),
  deleteAdHocEntry: vi.fn(),
  moveActivityToGroup: vi.fn(),
  removeActivityFromGroups: vi.fn(),
  reorderActivitiesInGroup: vi.fn(),
  listPriorities: vi.fn(),
  getCached: vi.fn(),
  setCached: vi.fn(),
  getSecureJson: vi.fn(),
  setSecureJson: vi.fn(),
  navigate: vi.fn(),
  logout: vi.fn(),
  refreshSession: () => undefined,
  session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } } as unknown,
  config: { ok: true, env: "dev", baseUrl: "https://algapsa.com" } as unknown,
  translate: (key: string, opts?: Record<string, unknown>) => {
    let out = (opts?.defaultValue as string | undefined) ?? key;
    for (const [n, v] of Object.entries(opts ?? {})) out = out.replaceAll(`{{${n}}}`, String(v));
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  const R = await import("react");
  const asNode = (c: unknown) => (c == null ? null : R.isValidElement(c) ? c : R.createElement(c as React.ComponentType));
  const FlatList = (props: Record<string, any>) => {
    const data: unknown[] = props.data ?? [];
    const children: React.ReactNode[] = [R.createElement(R.Fragment, { key: "h" }, asNode(props.ListHeaderComponent))];
    if (data.length === 0) children.push(R.createElement(R.Fragment, { key: "e" }, asNode(props.ListEmptyComponent)));
    data.forEach((item, index) =>
      children.push(R.createElement(R.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index }))),
    );
    children.push(R.createElement(R.Fragment, { key: "f" }, asNode(props.ListFooterComponent)));
    return R.createElement("FlatList", { onEndReached: props.onEndReached, refreshControl: props.refreshControl }, children);
  };
  const SectionList = (props: Record<string, any>) => {
    const sections: Array<{ key: string; data: unknown[] }> = props.sections ?? [];
    const children: React.ReactNode[] = [R.createElement(R.Fragment, { key: "h" }, asNode(props.ListHeaderComponent))];
    if (sections.length === 0) children.push(R.createElement(R.Fragment, { key: "e" }, asNode(props.ListEmptyComponent)));
    for (const section of sections) {
      children.push(R.createElement(R.Fragment, { key: `s:${section.key}` }, props.renderSectionHeader({ section })));
      section.data.forEach((item, index) =>
        children.push(R.createElement(R.Fragment, { key: `${section.key}:${props.keyExtractor(item, index)}` }, props.renderItem({ item, index }))),
      );
    }
    return R.createElement("SectionList", { refreshControl: props.refreshControl }, children);
  };
  return { ...actual, FlatList, SectionList };
});

vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ session: mocks.session, refreshSession: mocks.refreshSession, logout: mocks.logout }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/activities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/activities")>()),
  listActivities: (...a: unknown[]) => mocks.listActivities(...a),
  listActivitiesGrouped: (...a: unknown[]) => mocks.listActivitiesGrouped(...a),
  listActivityGroups: (...a: unknown[]) => mocks.listActivityGroups(...a),
  createAdHocEntry: (...a: unknown[]) => mocks.createAdHocEntry(...a),
  updateAdHocEntry: (...a: unknown[]) => mocks.updateAdHocEntry(...a),
  setAdHocDone: (...a: unknown[]) => mocks.setAdHocDone(...a),
  deleteAdHocEntry: (...a: unknown[]) => mocks.deleteAdHocEntry(...a),
  moveActivityToGroup: (...a: unknown[]) => mocks.moveActivityToGroup(...a),
  removeActivityFromGroups: (...a: unknown[]) => mocks.removeActivityFromGroups(...a),
  reorderActivitiesInGroup: (...a: unknown[]) => mocks.reorderActivitiesInGroup(...a),
}));
vi.mock("../api/priorities", () => ({ listPriorities: (...a: unknown[]) => mocks.listPriorities(...a) }));
vi.mock("../cache/userActivitiesCache", () => ({
  getCachedUserActivities: (...a: unknown[]) => mocks.getCached(...a),
  setCachedUserActivities: (...a: unknown[]) => mocks.setCached(...a),
}));
vi.mock("../storage/secureStorage", () => ({
  getSecureJson: (...a: unknown[]) => mocks.getSecureJson(...a),
  setSecureJson: (...a: unknown[]) => mocks.setSecureJson(...a),
}));
vi.mock("../hooks/useAppResume", () => ({ useAppResume: () => undefined }));
vi.mock("../ui/formatters/dateTime", () => ({ formatDateShort: (v: string) => `D(${v})` }));
vi.mock("../features/userActivities/components/AdHocEntryFormModal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/userActivities/components/AdHocEntryFormModal")>();
  return {
    ...actual,
    AdHocEntryFormModal: (p: Record<string, unknown>) => React.createElement("AdHocEntryFormModal", p),
  };
});
vi.mock("../features/userActivities/components/DraggableGroupedList", () => ({
  DraggableGroupedList: (p: Record<string, any>) =>
    React.createElement("DraggableGroupedList", p, p.header, p.groups.length === 0 ? p.emptyComponent : null),
}));

import { UserActivitiesScreen } from "./UserActivitiesScreen";
import { ActivityRow } from "../features/userActivities/components/ActivityRow";

function activity(id: string, extra: Record<string, unknown> = {}): Activity {
  return {
    id,
    title: `Title ${id}`,
    status: "open",
    priority: "low",
    sourceId: id,
    sourceType: "ticket",
    actions: [],
    tenant: "t",
    createdAt: "",
    updatedAt: "",
    type: "ticket",
    ...extra,
  } as Activity;
}

function page(items: Activity[], pagination: Record<string, unknown> = {}) {
  return { ok: true, data: { data: items, pagination: { page: 1, hasNext: false, total: items.length, ...pagination } } };
}

function groupedResult(groups: Array<{ key: string; label: string; activities: Activity[] }>, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      data: {
        groupBy: "status",
        groups: groups.map((g) => ({ ...g, count: g.activities.length })),
        totalCount: groups.reduce((n, g) => n + g.activities.length, 0),
        truncated: false,
        ...extra,
      },
    },
  };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
  });
}

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<UserActivitiesScreen {...({ navigation: { navigate: mocks.navigate }, route: {} } as unknown as React.ComponentProps<typeof UserActivitiesScreen>)} />);
  });
  await flush();
  await flush();
  return r;
}

const texts = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map((n) => {
    const v = n.props.children;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" || typeof x === "number").join("") : String(v);
  });
const pressables = (r: ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.type === Pressable && n.props.accessibilityLabel === label);
const press = async (r: ReactTestRenderer, label: string, index = 0) => {
  const target = pressables(r, label)[index];
  if (!target) throw new Error(`No pressable "${label}"`);
  await act(async () => {
    await target.props.onPress();
  });
  await flush();
};
const host = (r: ReactTestRenderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type)[0];
// ActivityRow is memo()-wrapped; match its inner render function.
const rows = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.type === (ActivityRow as unknown as { type: unknown }).type);
const lastListParams = () => mocks.listActivities.mock.calls[mocks.listActivities.mock.calls.length - 1][1];
const lastGroupedParams = () => mocks.listActivitiesGrouped.mock.calls[mocks.listActivitiesGrouped.mock.calls.length - 1][1];

describe("UserActivitiesScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } };
    mocks.config = { ok: true, env: "dev", baseUrl: "https://algapsa.com" };
    mocks.getSecureJson.mockResolvedValue(null);
    mocks.setSecureJson.mockResolvedValue(undefined);
    mocks.getCached.mockReturnValue(null);
    mocks.listActivities.mockResolvedValue(page([activity("a"), activity("b")]));
    mocks.listActivitiesGrouped.mockResolvedValue(groupedResult([]));
    mocks.listActivityGroups.mockResolvedValue({ ok: true, data: { data: [] } });
    mocks.listPriorities.mockResolvedValue({ ok: true, data: { data: [{ priority_id: "p-high", priority_name: "High" }] } });
    for (const fn of [
      mocks.createAdHocEntry,
      mocks.updateAdHocEntry,
      mocks.setAdHocDone,
      mocks.deleteAdHocEntry,
      mocks.moveActivityToGroup,
      mocks.removeActivityFromGroups,
      mocks.reorderActivitiesInGroup,
    ]) {
      fn.mockResolvedValue({ ok: true, data: { data: {} } });
    }
  });

  describe("guards", () => {
    it("shows a configuration error", async () => {
      mocks.config = { ok: false, error: "missing base url" };
      const r = await render();
      expect(texts(r)).toEqual(expect.arrayContaining(["common:configurationError", "missing base url"]));
      expect(mocks.listActivities).not.toHaveBeenCalled();
    });

    it("shows signed-out state without a session", async () => {
      mocks.session = null;
      const r = await render();
      expect(texts(r)).toContain("common:signedOut");
      expect(mocks.listActivities).not.toHaveBeenCalled();
    });
  });

  describe("flat list", () => {
    it("loads the first page with default filters, renders rows and caches the page", async () => {
      const r = await render();
      expect(mocks.getSecureJson).toHaveBeenCalledWith("alga.mobile.activities.filters.user-1");
      expect(lastListParams()).toEqual(
        expect.objectContaining({ apiKey: "api-key", page: 1, pageSize: 25, status: "open", search: undefined }),
      );
      expect(lastListParams().type.length).toBeGreaterThan(0);
      expect(rows(r).map((n) => n.props.activity.id)).toEqual(["a", "b"]);
      expect(texts(r)).toContain("2 activities");
      expect(mocks.setCached).toHaveBeenCalledWith(
        expect.stringContaining("alga.mobile.activities.list.user-1."),
        expect.objectContaining({ items: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })], page: 1, hasNext: false }),
      );
      expect(mocks.setSecureJson).toHaveBeenCalledWith("alga.mobile.activities.filters.user-1", expect.objectContaining({ status: "open" }));
    });

    it("seeds rows from the cache before the network answers", async () => {
      mocks.getCached.mockReturnValue({ items: [activity("cached")], page: 1, hasNext: true });
      mocks.listActivities.mockReturnValue(new Promise(() => undefined));
      const r = await render();
      expect(rows(r).map((n) => n.props.activity.id)).toEqual(["cached"]);
    });

    it("shows the loading state while the first page is pending", async () => {
      mocks.listActivities.mockReturnValue(new Promise(() => undefined));
      const r = await render();
      expect(texts(r)).toContain("Loading your activities…");
    });

    it("shows the empty state", async () => {
      mocks.listActivities.mockResolvedValue(page([]));
      const r = await render();
      expect(texts(r)).toContain("Nothing here yet");
    });

    it("shows an error with retry that reloads", async () => {
      mocks.listActivities.mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
      const r = await render();
      expect(texts(r)).toContain("Unable to load activities");
      const retry = r.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === "button")[0];
      await act(async () => retry.props.onPress());
      await flush();
      expect(rows(r)).toHaveLength(2);
    });

    it("ignores canceled requests", async () => {
      mocks.listActivities.mockResolvedValue({ ok: false, error: { kind: "canceled" } });
      const r = await render();
      expect(texts(r)).not.toContain("Unable to load activities");
    });

    it("shows no-access with a sign-out action on permission errors", async () => {
      mocks.listActivities.mockResolvedValue({ ok: false, error: { kind: "permission" } });
      const r = await render();
      expect(texts(r)).toContain("No access");
      const signOut = r.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === "button")[0];
      act(() => signOut.props.onPress());
      expect(mocks.logout).toHaveBeenCalled();
    });

    it("loads the next page on end reached and appends it, stopping when hasNext is false", async () => {
      mocks.listActivities
        .mockResolvedValueOnce(page([activity("a")], { hasNext: true, total: 2 }))
        .mockResolvedValueOnce(page([activity("b")], { page: 2, hasNext: false, total: 2 }));
      const r = await render();
      await act(async () => {
        await host(r, "FlatList").props.onEndReached();
      });
      await flush();
      expect(lastListParams()).toEqual(expect.objectContaining({ page: 2 }));
      expect(rows(r).map((n) => n.props.activity.id)).toEqual(["a", "b"]);
      await act(async () => {
        await host(r, "FlatList").props.onEndReached();
      });
      expect(mocks.listActivities).toHaveBeenCalledTimes(2);
    });

    it("pull-to-refresh reloads page 1", async () => {
      const r = await render();
      await act(async () => {
        await host(r, "FlatList").props.refreshControl.props.onRefresh();
      });
      await flush();
      expect(mocks.listActivities).toHaveBeenCalledTimes(2);
      expect(lastListParams().page).toBe(1);
    });

    it("restores persisted filters and sanitizes malformed arrays", async () => {
      mocks.getSecureJson.mockResolvedValue({ status: "closed", types: "bad", priorityIds: null, sortField: "title", sortOrder: "desc" });
      const r = await render();
      expect(lastListParams()).toEqual(expect.objectContaining({ status: "closed", sortBy: "title", sortDirection: "desc" }));
      expect(texts(r)).toEqual(expect.arrayContaining(["Filters (1)", "closed", "Sort: title"]));
      await press(r, "Remove closed filter");
      expect(lastListParams().status).toBe("open");
      await press(r, "Remove Sort: title filter");
      expect(lastListParams().sortBy).toBeUndefined();
    });
  });

  describe("search and quick filters", () => {
    it("commits a trimmed search and clears it", async () => {
      const r = await render();
      const input = r.root.findAllByType(TextInput)[0];
      act(() => input.props.onChangeText("  printer "));
      await act(async () => input.props.onSubmitEditing());
      await flush();
      expect(lastListParams().search).toBe("printer");
      // With text present, the first pressable with this label is the clear (x) inside the field.
      expect(pressables(r, "Search activities")).toHaveLength(2);
      await press(r, "Search activities", 0);
      expect(lastListParams().search).toBeUndefined();
    });

    it("toggles Overdue / Due today quick chips into due-date params and clears via the chip bar", async () => {
      const r = await render();
      await press(r, "Overdue");
      expect(lastListParams().dueDateEnd).toBeDefined();
      expect(pressables(r, "Overdue")[0].props.accessibilityState).toEqual({ selected: true });
      expect(texts(r)).toContain("Filters (1)");
      await press(r, "Due today");
      expect(lastListParams().dueDateStart).toBeDefined();
      await press(r, "Due today");
      expect(lastListParams().dueDateStart).toBeUndefined();
      await press(r, "Overdue");
      await press(r, "Clear all");
      expect(lastListParams().dueDateEnd).toBeUndefined();
    });
  });

  describe("navigation", () => {
    const pressRow = async (r: ReactTestRenderer, a: Activity) => {
      await act(async () => {
        rows(r)[0].props.onPress(a);
      });
    };

    it.each([
      [activity("t1"), ["TicketDetail", { ticketId: "t1" }]],
      [activity("w1", { type: "workflowTask" }), ["WorkflowTaskDetail", { taskId: "w1" }]],
      [activity("s1", { type: "schedule", workItemType: "opportunity", workItemId: "opp-1" }), ["OpportunityDetail", { opportunityId: "opp-1", title: "Title s1" }]],
      [activity("s2", { type: "schedule", workItemType: "ticket", workItemId: "tk-9" }), ["TicketDetail", { ticketId: "tk-9" }]],
      [activity("s3", { type: "schedule", workItemType: "meeting" }), ["ScheduleTab"]],
    ])("routes %#", async (a, expected) => {
      const r = await render();
      await pressRow(r, a);
      expect(mocks.navigate).toHaveBeenCalledWith(...expected);
    });

    it("passes the activity to ProjectTaskDetail and ignores types without a detail screen", async () => {
      const r = await render();
      const task = activity("pt1", { type: "projectTask" });
      await pressRow(r, task);
      expect(mocks.navigate).toHaveBeenCalledWith("ProjectTaskDetail", { taskId: "pt1", activity: task });
      mocks.navigate.mockClear();
      await pressRow(r, activity("n1", { type: "notification" }));
      expect(mocks.navigate).not.toHaveBeenCalled();
    });
  });

  describe("ad-hoc to-dos", () => {
    it("creates a dated, timed to-do and refreshes", async () => {
      const r = await render();
      await press(r, "New to-do");
      const modal = host(r, "AdHocEntryFormModal");
      expect(modal.props).toEqual(expect.objectContaining({ visible: true, mode: "create" }));
      const date = new Date(2026, 10, 18);
      await act(async () =>
        modal.props.onSubmit({ title: " Call vendor ", notes: " re: quote ", date, includeTime: true, startTime: "09:30", endTime: "10:15" }),
      );
      await flush();
      expect(mocks.createAdHocEntry).toHaveBeenCalledWith(expect.anything(), {
        apiKey: "api-key",
        entry: {
          title: "Call vendor",
          notes: "re: quote",
          scheduledStart: new Date(2026, 10, 18, 9, 30).toISOString(),
          scheduledEnd: new Date(2026, 10, 18, 10, 15).toISOString(),
        },
      });
      expect(host(r, "AdHocEntryFormModal").props.visible).toBe(false);
      expect(mocks.listActivities).toHaveBeenCalledTimes(2);
    });

    it("sends midnight-only start for an all-day to-do and null times without a date", async () => {
      const r = await render();
      await press(r, "New to-do");
      const date = new Date(2026, 10, 18);
      await act(async () =>
        host(r, "AdHocEntryFormModal").props.onSubmit({ title: "A", notes: "", date, includeTime: false, startTime: "09:00", endTime: "10:00" }),
      );
      expect(mocks.createAdHocEntry.mock.calls[0][1].entry).toEqual({
        title: "A",
        scheduledStart: new Date(2026, 10, 18, 0, 0).toISOString(),
        scheduledEnd: null,
      });
      await press(r, "New to-do");
      await act(async () =>
        host(r, "AdHocEntryFormModal").props.onSubmit({ title: "B", notes: "", includeTime: false, startTime: "09:00", endTime: "10:00" }),
      );
      expect(mocks.createAdHocEntry.mock.calls[1][1].entry).toEqual({ title: "B", scheduledStart: null, scheduledEnd: null });
    });

    it("surfaces save errors in the sheet (validation message vs generic fallback)", async () => {
      const r = await render();
      await press(r, "New to-do");
      mocks.createAdHocEntry.mockResolvedValueOnce({ ok: false, error: { kind: "validation", message: "Title too long" } });
      await act(async () => host(r, "AdHocEntryFormModal").props.onSubmit({ title: "x", notes: "", includeTime: false, startTime: "", endTime: "" }));
      expect(host(r, "AdHocEntryFormModal").props).toEqual(expect.objectContaining({ visible: true, error: "Title too long" }));
      mocks.createAdHocEntry.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
      await act(async () => host(r, "AdHocEntryFormModal").props.onSubmit({ title: "x", notes: "", includeTime: false, startTime: "", endTime: "" }));
      expect(host(r, "AdHocEntryFormModal").props.error).toBe("Unable to save. Please try again.");
      act(() => host(r, "AdHocEntryFormModal").props.onClose());
      expect(host(r, "AdHocEntryFormModal").props.visible).toBe(false);
    });

    describe("editing an existing to-do", () => {
      const adHoc = activity("ah1", {
        type: "schedule",
        workItemType: "ad_hoc",
        title: "Order toner",
        description: "black",
        startDate: new Date(2026, 10, 20, 14, 0).toISOString(),
        endDate: new Date(2026, 10, 20, 15, 30).toISOString(),
        isClosed: true,
      });

      async function openEdit() {
        const r = await render();
        await act(async () => {
          rows(r)[0].props.onPress(adHoc);
        });
        return r;
      }

      it("opens the sheet prefilled from the activity and updates it", async () => {
        const r = await openEdit();
        const modal = host(r, "AdHocEntryFormModal");
        expect(modal.props).toEqual(
          expect.objectContaining({
            visible: true,
            mode: "edit",
            isDone: true,
            initial: {
              title: "Order toner",
              notes: "black",
              date: new Date(2026, 10, 20),
              includeTime: true,
              startTime: "14:00",
              endTime: "15:30",
            },
          }),
        );
        await act(async () => modal.props.onSubmit({ ...modal.props.initial, notes: "" }));
        await flush();
        expect(mocks.updateAdHocEntry).toHaveBeenCalledWith(expect.anything(), {
          apiKey: "api-key",
          id: "ah1",
          entry: {
            title: "Order toner",
            notes: null,
            scheduledStart: new Date(2026, 10, 20, 14, 0).toISOString(),
            scheduledEnd: new Date(2026, 10, 20, 15, 30).toISOString(),
          },
        });
      });

      it("prefills defaults when the to-do has no dates", async () => {
        const r = await render();
        await act(async () => {
          rows(r)[0].props.onPress(
            activity("ah2", { type: "schedule", workItemType: "ad_hoc", startDate: "not-a-date" }),
          );
        });
        expect(host(r, "AdHocEntryFormModal").props.initial).toEqual({
          title: "Title ah2",
          notes: "",
          date: undefined,
          includeTime: false,
          startTime: "09:00",
          endTime: "10:00",
        });
      });

      it("toggles done and deletes, reporting failures", async () => {
        const r = await openEdit();
        mocks.setAdHocDone.mockResolvedValueOnce({ ok: false, error: { kind: "permission" } });
        await act(async () => host(r, "AdHocEntryFormModal").props.onToggleDone(false));
        expect(host(r, "AdHocEntryFormModal").props.error).toBe("You don't have permission to do that.");
        await act(async () => host(r, "AdHocEntryFormModal").props.onToggleDone(false));
        await flush();
        expect(mocks.setAdHocDone).toHaveBeenLastCalledWith(expect.anything(), { apiKey: "api-key", id: "ah1", done: false });
        expect(host(r, "AdHocEntryFormModal").props.visible).toBe(false);

        await act(async () => {
          rows(r)[0].props.onPress(adHoc);
        });
        mocks.deleteAdHocEntry.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
        await act(async () => host(r, "AdHocEntryFormModal").props.onDelete());
        expect(host(r, "AdHocEntryFormModal").props.error).toBe("Unable to delete. Please try again.");
        await act(async () => host(r, "AdHocEntryFormModal").props.onDelete());
        await flush();
        expect(mocks.deleteAdHocEntry).toHaveBeenLastCalledWith(expect.anything(), { apiKey: "api-key", id: "ah1" });
        expect(host(r, "AdHocEntryFormModal").props.visible).toBe(false);
      });
    });
  });

  describe("filters modal and grouping", () => {
    it("applies status, type, priority, sort and order from the modal", async () => {
      const r = await render();
      await press(r, "Filters");
      expect(host(r, "Modal")).toBeDefined();
      expect(texts(r)).toContain("Select a single type — Tickets or Project tasks — to filter by priority.");

      await press(r, "Closed");
      expect(lastListParams().status).toBe("closed");

      await press(r, "ticket");
      expect(lastListParams().type).toEqual(["ticket"]);
      expect(mocks.listPriorities).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key", itemType: "ticket" });
      await press(r, "High");
      expect(lastListParams().priorityIds).toEqual(["p-high"]);
      expect(texts(r)).toEqual(expect.arrayContaining(["Types (1)", "Priority (1)"]));

      // "dueDate" is both a group-by and a sort option; the sort chip renders second.
      await press(r, "dueDate", 1);
      await press(r, "Descending");
      expect(lastListParams()).toEqual(expect.objectContaining({ sortBy: "dueDate", sortDirection: "desc" }));
      expect(texts(r)).toContain("View 2 results");

      // Adding a second type drops the type-scoped priority filter.
      await press(r, "projectTask");
      expect(lastListParams().type).toEqual(["ticket", "projectTask"]);
      expect(lastListParams().priorityIds).toBeUndefined();

      await press(r, "Clear all", pressables(r, "Clear all").length - 1);
      expect(lastListParams()).toEqual(expect.objectContaining({ status: "open" }));
      expect(lastListParams().sortBy).toBeUndefined();
      await press(r, "View 2 results");
    });

    it("shows priority load errors and empty priority sets", async () => {
      mocks.listPriorities.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
      const r = await render();
      await press(r, "Filters");
      await press(r, "ticket");
      expect(texts(r)).toContain("Couldn't load priorities.");
      mocks.listPriorities.mockResolvedValueOnce({ ok: true, data: { data: [] } });
      await press(r, "ticket");
      await press(r, "projectTask");
      expect(texts(r)).toContain("No priorities defined for this type.");
    });

    it("groups by status via the server, renders sections and collapses them", async () => {
      mocks.listActivitiesGrouped.mockResolvedValue(
        groupedResult(
          [
            { key: "active", label: "Active Work", activities: [activity("g1"), activity("g2")] },
            { key: "done", label: "Done", activities: [activity("g3")] },
          ],
          { truncated: true },
        ),
      );
      const r = await render();
      await press(r, "Filters");
      await press(r, "status");
      expect(lastGroupedParams()).toEqual(expect.objectContaining({ groupBy: "status", apiKey: "api-key" }));
      expect(texts(r)).toEqual(expect.arrayContaining(["Active Work", "Done", "3 activities • showing the first results"]));
      expect(rows(r)).toHaveLength(3);
      await press(r, "Active Work");
      expect(rows(r).map((n) => n.props.activity.id)).toEqual(["g3"]);
      expect(pressables(r, "Active Work")[0].props.accessibilityState).toEqual({ expanded: false });
      await press(r, "Active Work");
      expect(rows(r)).toHaveLength(3);
    });

    it("localizes type group titles and shows grouped empty/error/no-access states", async () => {
      mocks.listActivitiesGrouped.mockResolvedValueOnce(groupedResult([{ key: "ticket", label: "Tickets", activities: [activity("x")] }]));
      const r = await render();
      await press(r, "Filters");
      await press(r, "type");
      expect(pressables(r, "Tickets")[0].props.accessibilityState).toEqual({ expanded: true });

      mocks.listActivitiesGrouped.mockResolvedValueOnce(groupedResult([]));
      await press(r, "dueDate", 0);
      expect(texts(r)).toContain("Nothing here yet");

      mocks.listActivitiesGrouped.mockResolvedValueOnce({ ok: false, error: { kind: "permission" } });
      await press(r, "status");
      expect(texts(r)).toContain("No access");
    });

    it("shows an error when grouped loading fails", async () => {
      mocks.getSecureJson.mockResolvedValue({ groupBy: "status" });
      mocks.listActivitiesGrouped.mockResolvedValue({ ok: false, error: { kind: "server" } });
      const r = await render();
      expect(texts(r)).toContain("Unable to load activities");
    });

    it("shows the grouped error even after the flat list had loaded", async () => {
      const r = await render();
      expect(rows(r)).toHaveLength(2);
      mocks.listActivitiesGrouped.mockResolvedValue({ ok: false, error: { kind: "server" } });
      await press(r, "Filters");
      await press(r, "status");
      expect(texts(r)).toContain("Unable to load activities");
      expect(texts(r)).not.toContain("Nothing here yet");
    });
  });

  describe("My groups (custom)", () => {
    const a = activity("a");
    const b = activity("b");
    const c = activity("c");

    function setupCustom() {
      mocks.listActivitiesGrouped.mockResolvedValue(groupedResult([{ key: "ticket", label: "Tickets", activities: [a, b, c] }]));
      mocks.listActivityGroups.mockResolvedValue({
        ok: true,
        data: {
          data: [
            {
              groupId: "grp-1",
              groupName: "Urgent",
              sortOrder: 0,
              isCollapsed: false,
              items: [{ itemId: "i1", activityId: "a", activityType: "ticket", sortOrder: 0 }],
            },
          ],
        },
      });
    }

    it("loads the full set plus saved groups and buckets them", async () => {
      setupCustom();
      const r = await render();
      await press(r, "My groups");
      expect(lastGroupedParams()).toEqual(expect.objectContaining({ groupBy: "type" }));
      expect(mocks.listActivityGroups).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: "api-key" }));
      const list = host(r, "DraggableGroupedList");
      expect(list.props.groups.map((g: { key: string; count: number }) => [g.key, g.count])).toEqual([
        ["grp-1", 1],
        ["__ungrouped__", 2],
      ]);
      expect(list.props.titleForGroup(list.props.groups[1])).toBe("Ungrouped");
      expect(list.props.titleForGroup(list.props.groups[0])).toBe("Urgent");
      act(() => list.props.onToggleCollapsed("grp-1"));
      expect(host(r, "DraggableGroupedList").props.collapsed.has("grp-1")).toBe(true);
      await press(r, "My groups");
      expect(host(r, "DraggableGroupedList")).toBeUndefined();
    });

    it("commits move / reorder / remove plans and reconciles with the server", async () => {
      setupCustom();
      const r = await render();
      await press(r, "My groups");
      const commit = async (mutation: Record<string, unknown>) => {
        await act(async () => {
          host(r, "DraggableGroupedList").props.onCommit({ nextGroups: host(r, "DraggableGroupedList").props.groups, mutation });
        });
        await flush();
      };
      const groupCalls = mocks.listActivityGroups.mock.calls.length;
      await commit({ kind: "move", groupKey: "grp-1", activityId: "b", activityType: "ticket", sortOrder: 1 });
      expect(mocks.moveActivityToGroup).toHaveBeenCalledWith(expect.anything(), {
        apiKey: "api-key",
        activityId: "b",
        activityType: "ticket",
        groupId: "grp-1",
        sortOrder: 1,
      });
      expect(mocks.listActivityGroups.mock.calls.length).toBe(groupCalls + 1);

      const items = [{ activityId: "a", activityType: "ticket", sortOrder: 0 }];
      await commit({ kind: "reorder", groupKey: "grp-1", items });
      expect(mocks.reorderActivitiesInGroup).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key", groupId: "grp-1", items });

      await commit({ kind: "remove", activityId: "a", activityType: "ticket" });
      expect(mocks.removeActivityFromGroups).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key", activityId: "a", activityType: "ticket" });

      const before = mocks.listActivityGroups.mock.calls.length;
      await commit({ kind: "noop" });
      expect(mocks.listActivityGroups.mock.calls.length).toBe(before);
    });

    it("reverts the optimistic arrangement when the save fails", async () => {
      setupCustom();
      const r = await render();
      await press(r, "My groups");
      const original = host(r, "DraggableGroupedList").props.groups;
      mocks.moveActivityToGroup.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
      await act(async () => {
        host(r, "DraggableGroupedList").props.onCommit({
          nextGroups: [{ key: "grp-1", label: "Urgent", count: 0, activities: [] }],
          mutation: { kind: "move", groupKey: "grp-1", activityId: "b", activityType: "ticket", sortOrder: 0 },
        });
      });
      expect(host(r, "DraggableGroupedList").props.groups).toBe(original);
    });

    it("handles custom-group load failures", async () => {
      setupCustom();
      // The error view only shows when no stale flat rows remain (see report: stale rows mask it).
      mocks.listActivities.mockResolvedValue(page([]));
      mocks.listActivityGroups.mockResolvedValue({ ok: false, error: { kind: "server" } });
      const r = await render();
      await press(r, "My groups");
      expect(texts(r)).toContain("Unable to load activities");

      mocks.getSecureJson.mockResolvedValue({ groupBy: "custom" });
      mocks.listActivityGroups.mockResolvedValue({ ok: false, error: { kind: "permission" } });
      const restored = await render();
      expect(texts(restored)).toContain("No access");
    });
  });
});
