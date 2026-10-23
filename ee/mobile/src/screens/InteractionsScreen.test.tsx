import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const { listInteractionsMock, listTypesMock, listStatusesMock, resyncMock, translate, authValue } = vi.hoisted(() => ({
  listInteractionsMock: vi.fn(),
  listTypesMock: vi.fn(),
  listStatusesMock: vi.fn(),
  resyncMock: vi.fn(),
  // Stable identity across renders (matches production react-i18next).
  translate: (key: string, opts?: Record<string, unknown>) => {
    let out = key;
    for (const [name, value] of Object.entries(opts ?? {})) out = `${out}[${name}=${String(value)}]`;
    return out;
  },
  authValue: {
    session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } },
    refreshSession: () => Promise.resolve(null),
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => authValue }));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/interactions", () => ({
  listInteractions: (...args: unknown[]) => listInteractionsMock(...args),
  listInteractionTypes: (...args: unknown[]) => listTypesMock(...args),
  listInteractionStatuses: (...args: unknown[]) => listStatusesMock(...args),
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("../notifications/reminderSync", () => ({ resyncScheduleReminders: (...args: unknown[]) => resyncMock(...args) }));
vi.mock("../ui/formatters/dateTime", () => ({ formatDateShort: (iso: string) => `d(${iso})` }));
vi.mock("../ui/components/Badge", () => ({ Badge: (props: Record<string, unknown>) => React.createElement("MockBadge", props) }));
vi.mock("../ui/components/BottomSheet", () => ({
  BottomSheet: (props: Record<string, unknown>) => (props.visible ? React.createElement("MockBottomSheet", props, props.children as React.ReactNode) : null),
}));
vi.mock("../features/interactions/components/InteractionDetailSheet", () => ({
  InteractionDetailSheet: (props: Record<string, unknown>) => React.createElement("MockDetailSheet", props),
}));
vi.mock("../features/interactions/components/LogInteractionEntry", () => ({
  LogInteractionEntry: (props: Record<string, unknown>) => React.createElement("MockLogEntry", props),
}));

// The shared RN test mock's FlatList omits the header; the filter bar lives there.
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  const ReactLocal = await import("react");
  const FlatList = (props: Record<string, any>) => {
    const data: unknown[] = props.data ?? [];
    const children: React.ReactNode[] = [];
    if (props.ListHeaderComponent) children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: "header" }, props.ListHeaderComponent));
    if (data.length === 0 && props.ListEmptyComponent) children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: "empty" }, props.ListEmptyComponent));
    data.forEach((item, index) => {
      children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: props.keyExtractor?.(item, index) ?? String(index) }, props.renderItem?.({ item, index })));
    });
    return ReactLocal.createElement("FlatList", { onEndReached: props.onEndReached }, children);
  };
  return { ...actual, FlatList };
});

import { InteractionsScreen } from "./InteractionsScreen";

const navigation = { navigate: vi.fn() };

function page(rows: unknown[], pagination: Partial<{ page: number; hasNext: boolean; total: number }> = {}) {
  return { ok: true, status: 200, data: { data: rows, pagination: { page: 1, hasNext: false, total: rows.length, ...pagination } } };
}

const ROWS = [
  { interaction_id: "i-1", type_id: "t-call", type_name: "Call", title: "Called about outage", contact_name: "Jane Doe", client_name: "Acme", user_name: "Sam", interaction_date: "2026-09-11T10:00:00.000Z", status_name: "Done", is_status_closed: true },
  { interaction_id: "i-2", type_id: "t-email", type_name: "Email", title: null, contact_name: null, client_name: "Acme", user_name: "Sam", interaction_date: "2026-09-10T10:00:00.000Z", start_time: "2026-09-20T09:00:00.000Z", status_name: null, is_status_closed: false },
];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(InteractionsScreen, { navigation } as never));
  });
  await flush();
  return renderer;
}

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((n) => (Array.isArray(n.props.children) ? n.props.children.join("") : String(n.props.children)));
const byLabel = (renderer: ReactTestRenderer, label: string) => renderer.root.find((n) => n.props?.accessibilityLabel === label && typeof n.props.onPress === "function");
const badges = (renderer: ReactTestRenderer) => renderer.root.findAll((n) => String(n.type) === "MockBadge").map((n) => [n.props.label, n.props.tone]);
const sheet = (renderer: ReactTestRenderer) => renderer.root.find((n) => String(n.type) === "MockDetailSheet");

function pressRow(renderer: ReactTestRenderer, text: string) {
  let node: ReactTestInstance | null = renderer.root.find((n) => String(n.type) === "Text" && n.props.children === text);
  while (node && String(node.type) !== "Pressable") node = node.parent;
  if (!node) throw new Error(`No row for ${text}`);
  act(() => node!.props.onPress());
}

describe("InteractionsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInteractionsMock.mockResolvedValue(page(ROWS));
    listTypesMock.mockResolvedValue({ ok: true, data: { data: [{ type_id: "t-call", type_name: "Call" }, { type_id: "t-email", type_name: "Email" }] } });
    listStatusesMock.mockResolvedValue({ ok: true, data: { data: [{ status_id: "s-done", name: "Done", is_closed: true, is_default: true }] } });
  });

  it("loads my interactions first and renders each with type, counterpart, date, and status", async () => {
    const renderer = await renderScreen();

    expect(listInteractionsMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: "api-key", page: 1, limit: 25, userId: "user-1" }));
    expect(listInteractionsMock.mock.calls[0][1]).not.toHaveProperty("isClosed");
    const shown = texts(renderer);
    expect(shown).toContain("Called about outage");
    expect(shown).toContain("Call • Jane Doe • d(2026-09-11T10:00:00.000Z)");
    // Untitled rows fall back to the type; scheduled ones show their start time.
    expect(shown).toContain("Email");
    expect(shown).toContain("Email • Acme • list.scheduledPrefix d(2026-09-20T09:00:00.000Z)");
    expect(badges(renderer)).toEqual(expect.arrayContaining([["Done", "success"], ["list.open", "warning"]]));
    // Authors are noise while the list is scoped to me.
    expect(shown.some((line) => line.includes("Sam"))).toBe(false);
  });

  it("switching to Everyone drops the user scope and shows who logged each entry", async () => {
    const renderer = await renderScreen();

    act(() => byLabel(renderer, "list.everyone").props.onPress());
    await flush();

    const last = listInteractionsMock.mock.calls.at(-1)![1];
    expect(last).not.toHaveProperty("userId");
    expect(texts(renderer)).toContain("Call • Jane Doe • Sam • d(2026-09-11T10:00:00.000Z)");
  });

  it("applies and clears filters from the sheet, reflecting them as chips", async () => {
    const renderer = await renderScreen();

    act(() => byLabel(renderer, "list.filtersButton").props.onPress());
    act(() => byLabel(renderer, "filters.statusClosed").props.onPress());
    await flush();
    expect(listInteractionsMock.mock.calls.at(-1)![1]).toMatchObject({ isClosed: true, userId: "user-1" });

    act(() => byLabel(renderer, "✓ filters.statusClosed").props.onPress());
    act(() => byLabel(renderer, "Call").props.onPress());
    await flush();
    expect(listInteractionsMock.mock.calls.at(-1)![1]).toMatchObject({ isClosed: true, typeId: "t-call" });
    expect(badges(renderer)).toEqual(expect.arrayContaining([
      ["filters.statusLabel[status=filters.statusClosed]", "info"],
      ["filters.typeLabel[type=Call]", "info"],
    ]));

    act(() => byLabel(renderer, "filters.apply").props.onPress());
    act(() => byLabel(renderer, "filters.clearAll").props.onPress());
    await flush();
    const cleared = listInteractionsMock.mock.calls.at(-1)![1];
    expect(cleared).not.toHaveProperty("isClosed");
    expect(cleared).not.toHaveProperty("typeId");
    expect(cleared).toMatchObject({ userId: "user-1" });
  });

  it("distinguishes an empty list from a filter with no matches", async () => {
    listInteractionsMock.mockResolvedValue(page([]));
    const renderer = await renderScreen();
    expect(texts(renderer)).toContain("list.empty");

    act(() => byLabel(renderer, "list.filtersButton").props.onPress());
    act(() => byLabel(renderer, "filters.whenToday").props.onPress());
    await flush();
    expect(texts(renderer)).toContain("list.noResults");
  });

  it("explains a permission denial instead of showing a generic error", async () => {
    listInteractionsMock.mockResolvedValue({ ok: false, status: 403, error: { kind: "permission", message: "nope" } });
    const renderer = await renderScreen();
    expect(texts(renderer)).toContain("list.noAccess");
    expect(texts(renderer)).not.toContain("list.unableToLoad");
  });

  it("opens a row in the detail sheet and folds status updates back into the list", async () => {
    const renderer = await renderScreen();
    expect(sheet(renderer).props.interaction).toBeNull();

    pressRow(renderer, "Called about outage");
    expect(sheet(renderer).props.interaction).toMatchObject({ interaction_id: "i-1" });
    expect(sheet(renderer).props.statuses).toEqual([{ status_id: "s-done", name: "Done", is_closed: true, is_default: true }]);

    act(() => sheet(renderer).props.onUpdated({ ...ROWS[0], status_name: "Open", is_status_closed: false }));
    expect(sheet(renderer).props.interaction).toMatchObject({ status_name: "Open" });
    expect(badges(renderer)).toEqual(expect.arrayContaining([["Open", "warning"]]));
    expect(badges(renderer)).not.toEqual(expect.arrayContaining([["Done", "success"]]));

    act(() => sheet(renderer).props.onOpenTicket("ticket-7"));
    expect(navigation.navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "ticket-7" });
    expect(sheet(renderer).props.interaction).toBeNull();
  });

  it("appends the next page when the end of the list is reached", async () => {
    listInteractionsMock
      .mockResolvedValueOnce(page([ROWS[0]], { page: 1, hasNext: true, total: 2 }))
      .mockResolvedValueOnce(page([ROWS[1]], { page: 2, hasNext: false, total: 2 }));
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.find((n) => String(n.type) === "FlatList").props.onEndReached();
    });
    await flush();

    expect(listInteractionsMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ page: 2 }));
    expect(texts(renderer)).toEqual(expect.arrayContaining(["Called about outage", "Email"]));
  });

  it("refreshes the list and re-arms reminders after logging a new interaction", async () => {
    const renderer = await renderScreen();
    const entry = renderer.root.find((n) => String(n.type) === "MockLogEntry");
    expect(entry.props).toMatchObject({ visible: false, apiKey: "api-key", userId: "user-1" });

    act(() => byLabel(renderer, "list.logInteraction").props.onPress());
    expect(renderer.root.find((n) => String(n.type) === "MockLogEntry").props.visible).toBe(true);

    const callsBefore = listInteractionsMock.mock.calls.length;
    await act(async () => renderer.root.find((n) => String(n.type) === "MockLogEntry").props.onLogged());
    await flush();
    expect(listInteractionsMock.mock.calls.length).toBe(callsBefore + 1);
    expect(resyncMock).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "api-key", userId: "user-1" }));
  });
});
