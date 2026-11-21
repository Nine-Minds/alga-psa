import React from "react";
import { Modal, Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listTickets: vi.fn(),
  getTicketStats: vi.fn(),
  getTicketById: vi.fn(),
  getTicketPriorities: vi.fn(),
  getTicketStatuses: vi.fn(),
  getSecureJson: vi.fn(),
  setSecureJson: vi.fn(),
  createApiClient: vi.fn(),
  refreshSession: vi.fn(),
  logout: vi.fn(),
  listCache: new Map<string, unknown>(),
  detailCache: new Map<string, unknown>(),
  refCache: new Map<string, unknown>(),
  session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } } as Record<string, any> | null,
  config: { ok: true, env: "dev", baseUrl: "https://algapsa.test" } as Record<string, unknown>,
  offline: false,
  focusCallback: null as null | (() => void),
  appStateListener: null as null | ((state: string) => void),
  t: (key: string, defOrOpts?: string | Record<string, unknown>, maybeOpts?: Record<string, unknown>) => {
    const opts = typeof defOrOpts === "object" ? defOrOpts : maybeOpts;
    let out = key;
    if (opts) for (const [k, v] of Object.entries(opts)) if (k !== "defaultValue") out += `|${k}=${String(v)}`;
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  const R = await import("react");
  const FlatList = (props: Record<string, any>) => {
    const data: unknown[] = props.data ?? [];
    const children: React.ReactNode[] = [];
    if (props.ListHeaderComponent) children.push(R.createElement(R.Fragment, { key: "header" }, props.ListHeaderComponent));
    data.forEach((item, index) => {
      children.push(R.createElement(R.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index })));
    });
    if (props.ListFooterComponent) children.push(R.createElement(R.Fragment, { key: "footer" }, props.ListFooterComponent));
    return R.createElement("FlatList", { onEndReached: props.onEndReached, refreshControl: props.refreshControl }, children);
  };
  const AppState = {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.appStateListener = listener;
      return { remove: () => undefined };
    },
  };
  return { ...actual, FlatList, AppState };
});
vi.mock("@react-navigation/native", async () => {
  const R = await import("react");
  return {
    useFocusEffect: (callback: () => void) => {
      mocks.focusCallback = callback;
      R.useEffect(() => callback(), [callback]);
    },
  };
});
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ session: mocks.session, refreshSession: mocks.refreshSession, logout: mocks.logout }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../api", () => ({ createApiClient: (...args: unknown[]) => mocks.createApiClient(...args) }));
vi.mock("../api/tickets", () => ({
  listTickets: (...args: unknown[]) => mocks.listTickets(...args),
  getTicketStats: (...args: unknown[]) => mocks.getTicketStats(...args),
  getTicketById: (...args: unknown[]) => mocks.getTicketById(...args),
  getTicketPriorities: (...args: unknown[]) => mocks.getTicketPriorities(...args),
  getTicketStatuses: (...args: unknown[]) => mocks.getTicketStatuses(...args),
}));
vi.mock("../storage/secureStorage", () => ({
  getSecureJson: (...args: unknown[]) => mocks.getSecureJson(...args),
  setSecureJson: (...args: unknown[]) => mocks.setSecureJson(...args),
}));
vi.mock("../cache/ticketsCache", () => ({
  getCachedTicketsList: (key: string) => mocks.listCache.get(key) ?? null,
  setCachedTicketsList: (key: string, value: unknown) => mocks.listCache.set(key, value),
  getCachedTicketDetail: (id: string) => mocks.detailCache.get(id) ?? null,
  setCachedTicketDetail: (id: string, value: unknown) => mocks.detailCache.set(id, value),
}));
vi.mock("../cache/referenceDataCache", () => ({
  getCachedTicketStatuses: (key: string) => mocks.refCache.get(`statuses:${key}`) ?? null,
  setCachedTicketStatuses: (key: string, value: unknown) => mocks.refCache.set(`statuses:${key}`, value),
  getCachedTicketPriorities: (key: string) => mocks.refCache.get(`priorities:${key}`) ?? null,
  setCachedTicketPriorities: (key: string, value: unknown) => mocks.refCache.set(`priorities:${key}`, value),
}));
vi.mock("../ui/formatters/dateTime", () => ({
  formatDateShort: (value: string) => `short:${value}`,
  formatDateTimeWithRelative: (value: string) => `rel:${value}`,
}));
vi.mock("../network/useNetworkStatus", () => ({
  useNetworkStatus: () => (mocks.offline ? { isConnected: false, isInternetReachable: false } : { isConnected: true, isInternetReachable: true }),
}));
vi.mock("../ui/components/DatePickerField", () => ({
  DatePickerField: (props: Record<string, unknown>) => React.createElement("MockDatePickerField", props),
}));
vi.mock("../features/ticketDetail/components/AgentPickerModal", () => ({
  AgentPickerModal: (props: Record<string, unknown>) => React.createElement("MockAgentPickerModal", props),
}));
vi.mock("../features/ticketDetail/components/TagPickerModal", () => ({
  TagPickerModal: (props: Record<string, unknown>) => React.createElement("MockTagPickerModal", props),
}));
vi.mock("../ui/components/DisplayTagBadges", () => ({ DisplayTagBadges: () => null }));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { TicketsListScreen } from "./TicketsListScreen";

const STATUSES = [
  { status_id: "st-new-a", name: "New", is_closed: false },
  { status_id: "st-new-b", name: "New", is_closed: false },
  { status_id: "st-wait", name: "Waiting", is_closed: false },
  { status_id: "st-done", name: "Done", is_closed: true },
];

const T1 = {
  ticket_id: "tk-1",
  ticket_number: "T-001",
  title: "Printer down",
  client_name: "Acme",
  updated_at: "2026-11-17T10:00:00Z",
  status_id: "st-new-a",
  status_name: "New",
  status_is_closed: false,
  priority_name: "High",
  assigned_to_name: "Ada",
  tags: [{ tag_id: "tg-1", tag_text: "hardware" }],
  bundle_child_count: 2,
};
const T2 = {
  ticket_id: "tk-2",
  ticket_number: "T-002",
  title: "VPN flaky",
  entered_at: "2026-11-16T10:00:00Z",
  status_name: null,
  master_ticket_id: "tk-1",
  bundle_master_ticket_number: "T-001",
};

function page(items: unknown[], { page = 1, hasNext = false, total = items.length } = {}) {
  return { ok: true, data: { data: items, pagination: { page, limit: 25, total, totalPages: 1, hasNext, hasPrev: false } } };
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

type RenderProps = { params?: Record<string, unknown>; onSelectTicket?: (id: string) => void; selectedTicketId?: string | null };

function makeNavigation() {
  const parentParent = { setParams: vi.fn(), getParent: () => undefined };
  const parent = { setParams: vi.fn(), getParent: () => parentParent };
  return { navigate: vi.fn(), setParams: vi.fn(), getParent: () => parent, parent, parentParent };
}

async function render(props: RenderProps = {}) {
  const navigation = makeNavigation();
  let renderer!: ReactTestRenderer;
  const element = (p: RenderProps) =>
    React.createElement(TicketsListScreen, {
      navigation,
      route: { key: "r", name: "TicketsList", params: p.params },
      onSelectTicket: p.onSelectTicket,
      selectedTicketId: p.selectedTicketId,
    } as never);
  await act(async () => {
    renderer = create(element(props));
  });
  await flush();
  return {
    r: renderer,
    navigation,
    rerender: async (next: RenderProps) => {
      await act(async () => {
        renderer.update(element(next));
      });
      await flush();
    },
  };
}

function textOf(node: ReactTestInstance): string {
  const c = node.props.children;
  return Array.isArray(c) ? c.filter((x) => typeof x === "string").join("") : String(c);
}
const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map(textOf);
const outsideModal = (r: ReactTestRenderer) => {
  const modal = r.root.findByType(Modal);
  const inModal = new Set(modal.findAllByType(Text));
  return r.root.findAllByType(Text).filter((n) => !inModal.has(n)).map(textOf);
};
function pressables(root: ReactTestInstance, label: string) {
  return root.findAllByType(Pressable).filter((p) => p.props.accessibilityLabel === label);
}
async function press(root: ReactTestInstance, label: string, index = 0) {
  const target = pressables(root, label)[index];
  if (!target) throw new Error(`No pressable labelled ${label}`);
  await act(async () => {
    target.props.onPress();
  });
  await flush();
}
async function pressText(root: ReactTestInstance, label: string) {
  const target = root.findAllByType(Pressable).find((p) => p.findAllByType(Text).some((n) => textOf(n) === label));
  if (!target) throw new Error(`No button with text ${label}`);
  await act(async () => {
    target.props.onPress();
  });
  await flush();
}
const lastListParams = () => mocks.listTickets.mock.lastCall![1];
const lastFilters = () => lastListParams().filters as Record<string, unknown>;
const modalRoot = (r: ReactTestRenderer) => r.root.findByType(Modal);
const byType = (root: ReactTestInstance, type: string) => root.find((n) => (n.type as unknown) === type);

describe("TicketsListScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCache.clear();
    mocks.detailCache.clear();
    mocks.refCache.clear();
    mocks.session = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } };
    mocks.config = { ok: true, env: "dev", baseUrl: "https://algapsa.test" };
    mocks.offline = false;
    mocks.focusCallback = null;
    mocks.appStateListener = null;
    mocks.createApiClient.mockReturnValue({ request: vi.fn() });
    mocks.getSecureJson.mockResolvedValue(null);
    mocks.setSecureJson.mockResolvedValue(undefined);
    mocks.listTickets.mockResolvedValue(page([T1, T2]));
    mocks.getTicketStats.mockResolvedValue({ ok: true, data: { data: { open_tickets: 12, unassigned_tickets: 3, overdue_tickets: 1 } } });
    mocks.getTicketById.mockImplementation((_c: unknown, { ticketId }: { ticketId: string }) =>
      Promise.resolve({ ok: true, data: { data: { ticket_id: ticketId } } }),
    );
    mocks.getTicketStatuses.mockResolvedValue({ ok: true, data: { data: STATUSES } });
    mocks.getTicketPriorities.mockResolvedValue({
      ok: true,
      data: { data: [{ priority_id: "p-hi", priority_name: "High" }, { priority_id: "p-lo", priority_name: "Low" }] },
    });
  });

  describe("loading the list", () => {
    it("requests open, bundled tickets newest first and renders rows with their badges", async () => {
      const { r } = await render();
      expect(lastListParams()).toEqual(
        expect.objectContaining({ apiKey: "api-key", page: 1, limit: 25, search: undefined, sort: "entered_at", order: "desc" }),
      );
      expect(lastFilters()).toEqual({ is_open: true, bundle_view: "bundled" });
      const all = texts(r);
      expect(all).toEqual(
        expect.arrayContaining([
          "T-001 • Acme • short:2026-11-17T10:00:00Z",
          "Printer down",
          "New",
          "High",
          "list.bundleCount|count=2",
          "hardware",
          "list.assignedTo|name=Ada",
          "T-002 • short:2026-11-16T10:00:00Z",
          "common:unknown",
          "list.bundledUnder|number=T-001",
          "list.summary",
        ]),
      );
      expect(all.some((s) => s.includes("list.openCount|count=12"))).toBe(true);
      expect(all.some((s) => s.startsWith("list.lastRefreshed|date=rel:"))).toBe(true);
    });

    it("fetches the list and stats once per mount", async () => {
      await render();
      expect(mocks.listTickets).toHaveBeenCalledTimes(1);
      expect(mocks.getTicketStats).toHaveBeenCalledTimes(1);
    });

    it("caches page one and warms uncached ticket details one at a time", async () => {
      mocks.detailCache.set("tk-2", { ticket_id: "tk-2" });
      await render();
      expect(mocks.listCache.size).toBe(1);
      const [key, value] = [...mocks.listCache.entries()][0];
      expect(key.startsWith("alga.mobile.tickets.list.user-1.")).toBe(true);
      expect(value).toEqual(expect.objectContaining({ items: [T1, T2], page: 1, hasNext: false }));
      expect(mocks.getTicketById).toHaveBeenCalledTimes(1);
      expect(mocks.getTicketById).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key", ticketId: "tk-1" });
      expect(mocks.detailCache.get("tk-1")).toEqual({ ticket_id: "tk-1" });
    });

    it("shows cached rows immediately while the network request is pending", async () => {
      const first = await render();
      const [key] = [...mocks.listCache.keys()];
      first.r.unmount();
      mocks.listCache.set(key, { items: [T2], page: 1, hasNext: false, lastRefreshedAtIso: "2026-11-18T08:00:00Z" });
      mocks.listTickets.mockReturnValue(new Promise(() => undefined));
      const { r } = await render();
      const all = texts(r);
      expect(all).toContain("VPN flaky");
      expect(all).not.toContain("list.loadingTickets");
      expect(all).toContain("list.lastRefreshed|date=rel:2026-11-18T08:00:00Z");
    });

    it("shows a loading state while the first page is in flight", async () => {
      mocks.listTickets.mockReturnValue(new Promise(() => undefined));
      const { r } = await render();
      expect(texts(r)).toContain("list.loadingTickets");
    });

    it("loads the next page on end reached and stops when there are no more", async () => {
      mocks.listTickets.mockImplementation((_c: unknown, params: { page: number }) =>
        Promise.resolve(
          params.page === 1 ? page([T1], { hasNext: true, total: 2 }) : page([T2], { page: 2, hasNext: false, total: 2 }),
        ),
      );
      const { r } = await render();
      const before = mocks.listTickets.mock.calls.length;
      const list = () => byType(r.root, "FlatList");
      await act(async () => {
        await list().props.onEndReached();
      });
      await flush();
      expect(lastListParams().page).toBe(2);
      expect(texts(r)).toEqual(expect.arrayContaining(["Printer down", "VPN flaky"]));
      await act(async () => {
        await list().props.onEndReached();
      });
      expect(mocks.listTickets.mock.calls.length).toBe(before + 1);
    });

    it("reloads list and stats on pull-to-refresh and on app resume", async () => {
      const { r } = await render();
      const listBefore = mocks.listTickets.mock.calls.length;
      const statsBefore = mocks.getTicketStats.mock.calls.length;
      await act(async () => {
        await byType(r.root, "FlatList").props.refreshControl.props.onRefresh();
      });
      expect(mocks.listTickets.mock.calls.length).toBe(listBefore + 1);
      expect(mocks.getTicketStats.mock.calls.length).toBe(statsBefore + 1);
      await act(async () => {
        mocks.appStateListener!("background");
      });
      await act(async () => {
        mocks.appStateListener!("active");
      });
      await flush();
      expect(mocks.listTickets.mock.calls.length).toBe(listBefore + 2);
    });

    it("merges fresher cached ticket details into rows on focus", async () => {
      const { r } = await render();
      mocks.detailCache.set("tk-1", { status_name: "Waiting", priority_name: "Low", assigned_to_name: "Grace" });
      await act(async () => {
        mocks.focusCallback!();
      });
      const all = texts(r);
      expect(all).toEqual(expect.arrayContaining(["Waiting", "Low", "list.assignedTo|name=Grace"]));
      expect(all).not.toContain("list.assignedTo|name=Ada");
    });
  });

  describe("navigation", () => {
    it("opens the ticket detail when a row is pressed", async () => {
      const { r, navigation } = await render();
      await press(r.root, "list.ticketAccessibility|number=T-001|title=Printer down");
      expect(navigation.navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "tk-1" });
    });

    it("reports the tap instead of navigating in the split layout and highlights the selected row", async () => {
      const onSelectTicket = vi.fn();
      const { r, navigation } = await render({ onSelectTicket, selectedTicketId: "tk-2" });
      await press(r.root, "list.ticketAccessibility|number=T-001|title=Printer down");
      expect(onSelectTicket).toHaveBeenCalledWith("tk-1");
      expect(navigation.navigate).not.toHaveBeenCalled();
      const row = pressables(r.root, "list.ticketAccessibility|number=T-002|title=VPN flaky")[0];
      expect(row.props.style({ pressed: false }).borderWidth).toBe(2);
    });
  });

  describe("error states", () => {
    it("shows no-access with a sign-out action on a permission error", async () => {
      mocks.listTickets.mockResolvedValue({ ok: false, error: { kind: "permission" } });
      const { r } = await render();
      expect(texts(r)).toEqual(expect.arrayContaining(["list.noAccess", "list.noAccessDescription"]));
      await pressText(r.root, "list.signOut");
      expect(mocks.logout).toHaveBeenCalled();
    });

    it("treats a stats permission error as no access", async () => {
      mocks.getTicketStats.mockResolvedValue({ ok: false, error: { kind: "permission" } });
      const { r } = await render();
      expect(texts(r)).toContain("list.noAccess");
    });

    it("shows an error with retry for a server failure", async () => {
      mocks.listTickets.mockResolvedValue({ ok: false, error: { kind: "http", status: 500 } });
      const { r } = await render();
      expect(outsideModal(r)).toEqual(expect.arrayContaining(["list.unableToLoad", "list.unableToLoadDescription"]));
      mocks.listTickets.mockResolvedValue(page([T1]));
      await pressText(r.root, "common:retry");
      expect(texts(r)).toContain("Printer down");
    });

    it("shows the offline state with retry disabled, and refreshes once the connection is back", async () => {
      mocks.offline = true;
      mocks.listTickets.mockResolvedValue({ ok: false, error: { kind: "network" } });
      const { r, rerender } = await render();
      expect(outsideModal(r)).toEqual(expect.arrayContaining(["list.offlineTitle", "list.offlineDescription"]));
      const retry = r.root.findAllByType(Pressable).find((p) => p.findAllByType(Text).some((n) => textOf(n) === "common:retry"))!;
      expect(retry.props.disabled).toBe(true);

      mocks.listTickets.mockResolvedValue(page([T1]));
      const before = mocks.listTickets.mock.calls.length;
      mocks.offline = false;
      await rerender({});
      expect(mocks.listTickets.mock.calls.length).toBeGreaterThan(before);
      expect(texts(r)).toContain("Printer down");
    });

    it("ignores canceled requests", async () => {
      mocks.listTickets.mockResolvedValue({ ok: false, error: { kind: "canceled" } });
      const { r } = await render();
      expect(outsideModal(r)).not.toContain("list.unableToLoad");
    });

    it("shows a signed-out state without a session", async () => {
      mocks.session = null;
      const { r } = await render();
      expect(texts(r)).toContain("common:signedOut");
      expect(mocks.listTickets).not.toHaveBeenCalled();
    });

    it("shows a configuration error when the app config is invalid", async () => {
      mocks.config = { ok: false, error: "Missing base URL" };
      const { r } = await render();
      expect(texts(r)).toEqual(expect.arrayContaining(["common:configurationError", "Missing base URL"]));
    });
  });

  describe("empty states", () => {
    it("offers create and refresh when there are no tickets and no filters beyond the defaults", async () => {
      mocks.listTickets.mockResolvedValue(page([]));
      const { r, navigation } = await render();
      expect(outsideModal(r)).toEqual(expect.arrayContaining(["list.noTickets", "list.noTicketsDescription"]));
      await pressText(r.root, "list.createTicket");
      expect(navigation.navigate).toHaveBeenCalledWith("CreateTicket");
      const before = mocks.listTickets.mock.calls.length;
      await pressText(r.root, "common:refresh");
      expect(mocks.listTickets.mock.calls.length).toBe(before + 1);
    });

    it("keeps search and filters visible when filtered results are empty, and clear-all resets them", async () => {
      const { r } = await render();
      mocks.listTickets.mockResolvedValue(page([]));
      await press(r.root, "quickFilters.unassigned");
      expect(lastFilters()).toEqual(expect.objectContaining({ has_assignment: false }));
      expect(outsideModal(r)).toEqual(expect.arrayContaining(["list.noTickets", "filters.assigneeLabel|assignee=quickFilters.unassigned"]));
      expect(r.root.findAllByType(TextInput)).toHaveLength(1);

      mocks.listTickets.mockResolvedValue(page([T1]));
      const emptyStateClear = r.root
        .findAllByType(Pressable)
        .filter((p) => p.findAllByType(Text).some((n) => textOf(n) === "filters.clearAll") && p.props.accessibilityLabel === undefined)[0];
      await act(async () => {
        emptyStateClear.props.onPress();
      });
      await flush();
      expect(lastFilters()).toEqual({ is_open: true, bundle_view: "bundled" });
      expect(texts(r)).toContain("Printer down");
    });
  });

  describe("search", () => {
    it("commits the trimmed search on submit and drops it when the field is cleared", async () => {
      const { r } = await render();
      const input = () => r.root.findByType(TextInput);
      const before = mocks.listTickets.mock.calls.length;
      await act(async () => {
        input().props.onChangeText("  printer ");
      });
      expect(mocks.listTickets.mock.calls.length).toBe(before);
      await act(async () => {
        input().props.onSubmitEditing();
      });
      await flush();
      expect(lastListParams().search).toBe("printer");

      await press(r.root, "Clear search");
      expect(input().props.value).toBe("");
      expect(lastListParams().search).toBeUndefined();
    });

    it("commits via the search button and drops the search when the text is deleted", async () => {
      const { r } = await render();
      await act(async () => {
        r.root.findByType(TextInput).props.onChangeText("vpn");
      });
      await press(r.root, "list.searchAccessibility");
      expect(lastListParams().search).toBe("vpn");
      await act(async () => {
        r.root.findByType(TextInput).props.onChangeText("");
      });
      await flush();
      expect(lastListParams().search).toBeUndefined();
    });
  });

  describe("quick filters", () => {
    it.each([
      ["quickFilters.myTickets", { assigned_to: "user-1" }],
      ["quickFilters.highPriority", { priority_name: "high" }],
    ])("%s narrows the request", async (label, expected) => {
      const { r } = await render();
      await press(r.root, label);
      expect(lastFilters()).toEqual(expect.objectContaining(expected));
    });

    it("recently updated sends an updated_from a week back", async () => {
      const { r } = await render();
      await press(r.root, "quickFilters.recentlyUpdated");
      const from = Date.parse(String(lastFilters().updated_from));
      expect(Date.now() - from).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
      expect(Date.now() - from).toBeLessThan(7.1 * 24 * 3600 * 1000);
      expect(outsideModal(r)).toContain("filters.updatedDays|days=7");
    });
  });

  describe("saved filters", () => {
    it("restores saved filters per user and resolves status names to every board's ids", async () => {
      mocks.getSecureJson.mockResolvedValue({
        status: "any",
        statusNames: ["New"],
        assignee: "agent",
        assigneeUserId: "u-9",
        assigneeName: "Grace",
        tags: ["vip", " VIP ", "network"],
        sortField: "updated_at",
        sortOrder: "asc",
        bundleView: "individual",
        updatedSinceDate: "2026-11-01",
      });
      const { r } = await render();
      expect(mocks.getSecureJson).toHaveBeenCalledWith("alga.mobile.tickets.filters.user-1");
      expect(lastListParams()).toEqual(expect.objectContaining({ sort: "updated_at", order: "asc" }));
      expect(lastFilters()).toEqual({
        status_ids: "st-new-a,st-new-b",
        assigned_to: "u-9",
        tags: "vip,network",
        updated_from: "2026-11-01T00:00:00.000Z",
      });
      expect(outsideModal(r)).toEqual(
        expect.arrayContaining([
          "filters.statusesCount|count=1",
          "filters.assigneeLabel|assignee=Grace",
          "filters.tagsCount|count=2",
          "filters.updatedDate|date=2026-11-01",
          "filters.sortLabel|field=updated_at|order=asc",
          "filters.bundleIndividualLabel",
        ]),
      );
      expect(mocks.setSecureJson).toHaveBeenCalledWith(
        "alga.mobile.tickets.filters.user-1",
        expect.objectContaining({ statusNames: ["New"], tags: ["vip", "network"] }),
      );
    });

    it("migrates a legacy id-based status selection to names", async () => {
      mocks.getSecureJson.mockResolvedValue({ status: "any", statusIds: ["st-new-b"] });
      await render();
      expect(lastFilters()).toEqual(expect.objectContaining({ status_ids: "st-new-a,st-new-b" }));
      expect(mocks.setSecureJson).toHaveBeenLastCalledWith(
        "alga.mobile.tickets.filters.user-1",
        expect.objectContaining({ statusIds: [], statusNames: ["New"] }),
      );
    });

    it("does not persist filters for a session without a user id", async () => {
      mocks.session = { accessToken: "api-key", tenantId: "tenant-1" };
      await render();
      expect(mocks.getSecureJson).not.toHaveBeenCalled();
      expect(mocks.setSecureJson).not.toHaveBeenCalled();
    });
  });

  describe("route drill-downs", () => {
    it("scopes to a client and contact from route params and clears them with the chips", async () => {
      const { r, navigation } = await render({
        params: { clientId: "c-1", clientName: "Acme", contactId: "ct-1", contactName: "Ada" },
      });
      expect(lastFilters()).toEqual(expect.objectContaining({ client_id: "c-1", contact_name_id: "ct-1" }));
      expect(outsideModal(r)).toEqual(expect.arrayContaining(["ticketsFilter.chip|name=Acme", "ticketsFilter.chip|name=Ada"]));

      await press(r.root, "ticketsFilter.clear");
      expect(navigation.setParams).toHaveBeenCalledWith({ clientId: undefined, clientName: undefined });
      expect(navigation.parent.setParams).toHaveBeenCalledWith({ screen: undefined, params: undefined });
      expect(navigation.parentParent.setParams).toHaveBeenCalledWith({ screen: undefined, params: undefined });

      await press(r.root, "ticketsFilter.clear", 1);
      expect(navigation.setParams).toHaveBeenCalledWith({ contactId: undefined, contactName: undefined });
    });

    it("applies an assignee preset from Home", async () => {
      await render({ params: { assignee: "me" } });
      expect(lastFilters()).toEqual(expect.objectContaining({ assigned_to: "user-1" }));
    });

    it("clear-all from the chip bar also drops route drill-downs", async () => {
      const { r, navigation } = await render({ params: { clientId: "c-1" } });
      const chipBarClear = pressables(r.root, "filters.clearAll").find((p) => !modalRoot(r).findAllByType(Pressable).includes(p))!;
      await act(async () => {
        chipBarClear.props.onPress();
      });
      expect(navigation.setParams).toHaveBeenCalledWith({ clientId: undefined, clientName: undefined });
      expect(navigation.setParams).toHaveBeenCalledWith({ contactId: undefined, contactName: undefined });
    });
  });

  describe("filters sheet", () => {
    async function openFilters() {
      const ctx = await render();
      await press(ctx.r.root, "list.openFilters");
      expect(modalRoot(ctx.r).props.visible).toBe(true);
      return ctx;
    }

    it("loads priorities once opened and filters by a tapped priority, toggling it off again", async () => {
      const { r } = await openFilters();
      expect(mocks.getTicketPriorities).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key" });
      expect(mocks.refCache.get("priorities:tenant-1")).toHaveLength(2);
      await press(modalRoot(r), "Low");
      expect(lastFilters()).toEqual(expect.objectContaining({ priority_name: "Low" }));
      await press(modalRoot(r), "Low");
      expect(lastFilters().priority_name).toBeUndefined();
    });

    it("uses cached priorities without a request", async () => {
      mocks.refCache.set("priorities:tenant-1", [{ priority_id: "p-x", priority_name: "Urgent" }]);
      const { r } = await openFilters();
      expect(mocks.getTicketPriorities).not.toHaveBeenCalled();
      expect(pressables(modalRoot(r), "Urgent")).toHaveLength(1);
    });

    it("shows priority and status load errors", async () => {
      mocks.getTicketPriorities.mockResolvedValue({ ok: false, error: { kind: "http" } });
      mocks.getTicketStatuses.mockResolvedValue({ ok: false, error: { kind: "http" } });
      const { r } = await openFilters();
      const modalTexts = modalRoot(r).findAllByType(Text).map(textOf);
      expect(modalTexts).toEqual(expect.arrayContaining(["filters.unableToLoadPriorities", "filters.unableToLoadStatuses"]));
    });

    it("switches the open/closed status and bundle view", async () => {
      const { r } = await openFilters();
      await press(modalRoot(r), "filters.closed");
      expect(lastFilters()).toEqual(expect.objectContaining({ is_closed: true }));
      await press(modalRoot(r), "filters.any", 0);
      expect(lastFilters().is_closed).toBeUndefined();
      expect(lastFilters().is_open).toBeUndefined();
      await press(modalRoot(r), "filters.individual");
      expect(lastFilters().bundle_view).toBeUndefined();
    });

    it("toggles grouped status chips by name across boards", async () => {
      const { r } = await openFilters();
      await press(modalRoot(r), "New");
      expect(lastFilters()).toEqual(expect.objectContaining({ status_ids: "st-new-a,st-new-b" }));
      expect(lastFilters().is_open).toBeUndefined();
      await press(modalRoot(r), "Done");
      expect(lastFilters().status_ids).toBe("st-new-a,st-new-b,st-done");
      await press(modalRoot(r), "New");
      expect(lastFilters().status_ids).toBe("st-done");
    });

    it("filters by assignee choice and by a picked agent", async () => {
      const { r } = await openFilters();
      await press(modalRoot(r), "filters.me");
      expect(lastFilters().assigned_to).toBe("user-1");
      await press(modalRoot(r), "quickFilters.unassigned", 0);
      expect(lastFilters().has_assignment).toBe(false);

      await pressText(modalRoot(r), "filters.pickAgent");
      expect(byType(modalRoot(r), "MockAgentPickerModal").props.visible).toBe(true);
      await act(async () => {
        byType(modalRoot(r), "MockAgentPickerModal").props.onSelect("u-7", "Grace");
      });
      await flush();
      expect(lastFilters().assigned_to).toBe("u-7");
      expect(byType(modalRoot(r), "MockAgentPickerModal").props.visible).toBe(false);
      expect(modalRoot(r).findAllByType(Text).map(textOf)).toContain("filters.agent: Grace");
    });

    it("adds tags from the picker and removes a tag chip", async () => {
      const { r } = await openFilters();
      await press(modalRoot(r), "filters.addTag");
      expect(byType(modalRoot(r), "MockTagPickerModal").props.visible).toBe(true);
      await act(async () => {
        byType(modalRoot(r), "MockTagPickerModal").props.onApply(["vip", "network"]);
      });
      await flush();
      expect(lastFilters().tags).toBe("vip,network");
      await press(modalRoot(r), "tags.removeTag|tag=vip");
      expect(lastFilters().tags).toBe("network");
      await act(async () => {
        byType(modalRoot(r), "MockTagPickerModal").props.onClose();
      });
      expect(byType(modalRoot(r), "MockTagPickerModal").props.visible).toBe(false);
    });

    it("sets updated-since by preset or date, and sort field and order", async () => {
      const { r } = await openFilters();
      await press(modalRoot(r), "filters.option24h");
      expect(typeof lastFilters().updated_from).toBe("string");

      await act(async () => {
        byType(modalRoot(r), "MockDatePickerField").props.onChange(new Date(2026, 10, 3));
      });
      await flush();
      expect(lastFilters().updated_from).toBe("2026-11-03T00:00:00.000Z");
      expect(byType(modalRoot(r), "MockDatePickerField").props.value).toEqual(new Date(2026, 10, 3));
      await act(async () => {
        byType(modalRoot(r), "MockDatePickerField").props.onChange(undefined);
      });
      await flush();
      expect(lastFilters().updated_from).toBeUndefined();

      await press(modalRoot(r), "filters.client");
      await press(modalRoot(r), "filters.asc");
      expect(lastListParams()).toEqual(expect.objectContaining({ sort: "client_name", order: "asc" }));
    });

    it("labels the results button with the total and closes the sheet", async () => {
      mocks.listTickets.mockResolvedValue(page([T1, T2], { total: 42 }));
      const { r } = await openFilters();
      await press(modalRoot(r), "filters.viewResultsCount|count=42");
      expect(modalRoot(r).props.visible).toBe(false);
    });

    it("clear-all in the sheet restores the defaults", async () => {
      const { r } = await openFilters();
      await press(modalRoot(r), "filters.closed");
      await press(modalRoot(r), "filters.clearAll");
      expect(lastFilters()).toEqual({ is_open: true, bundle_view: "bundled" });
    });

    it("closes from the header close button", async () => {
      const { r } = await openFilters();
      await press(modalRoot(r), "common:close");
      expect(modalRoot(r).props.visible).toBe(false);
    });
  });
});
