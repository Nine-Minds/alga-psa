import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listScheduleEntries: vi.fn(),
  listTickets: vi.fn(),
  listActivities: vi.fn(),
  navigate: vi.fn(),
  openStopModal: vi.fn(),
  startTimer: vi.fn(),
  features: { inventory: true, assets: true, projects: true },
  offline: false,
  timer: {
    status: "idle" as string,
    session: null as Record<string, unknown> | null,
    offsetMs: 0,
    client: { request: vi.fn() },
    apiKey: "api-key",
    openStopModal: (...args: unknown[]) => mocks.openStopModal(...args),
    start: (...args: unknown[]) => mocks.startTimer(...args),
  },
  elapsedMs: null as number | null,
  authValue: {
    session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } },
    refreshSession: () => Promise.resolve(null),
  },
  translate: (key: string, defOrOpts?: string | Record<string, unknown>, optsArg?: Record<string, unknown>) => {
    const def = typeof defOrOpts === "string" ? defOrOpts : undefined;
    const opts = typeof defOrOpts === "object" ? defOrOpts : optsArg;
    let out = def ?? key;
    if (opts) {
      for (const [name, value] of Object.entries(opts)) out = out.replaceAll(`{{${name}}}`, String(value));
    }
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mocks.authValue }));
vi.mock("../capabilities/CapabilitiesContext", () => ({
  useCapabilities: () => ({ features: mocks.features, loaded: true }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/schedule", () => ({ listScheduleEntries: (...args: unknown[]) => mocks.listScheduleEntries(...args) }));
vi.mock("../api/tickets", () => ({ listTickets: (...args: unknown[]) => mocks.listTickets(...args) }));
vi.mock("../api/activities", () => ({ listActivities: (...args: unknown[]) => mocks.listActivities(...args) }));
vi.mock("../features/timer/TimerContext", () => ({
  useTimer: () => mocks.timer,
  useTimerElapsedMs: () => mocks.elapsedMs,
}));
vi.mock("../features/timer/components/ServicePickerModal", () => ({
  ServicePickerModal: (props: Record<string, unknown>) => React.createElement("MockServicePicker", props),
}));
vi.mock("../features/interactions/components/LogInteractionEntry", () => ({
  LogInteractionEntry: (props: Record<string, unknown>) => React.createElement("MockLogInteraction", props),
}));
vi.mock("../network/useNetworkStatus", () => ({
  useNetworkStatus: () =>
    mocks.offline ? { isConnected: false, isInternetReachable: false } : { isConnected: true, isInternetReachable: true },
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { HomeScreen, localDayWindow } from "./HomeScreen";
import { clearHomeCache } from "../cache/homeCache";

const SCHEDULE = [
  {
    entry_id: "s-2",
    title: "Afternoon visit",
    scheduled_start: "2026-10-16T14:00:00Z",
    scheduled_end: "2026-10-16T15:00:00Z",
    work_item_id: "tkt-2",
    work_item_type: "ticket",
    notes: null,
    is_private: false,
  },
  {
    entry_id: "s-1",
    title: "Morning visit",
    scheduled_start: "2026-10-16T09:00:00Z",
    scheduled_end: "2026-10-16T10:00:00Z",
    work_item_id: "task-1",
    work_item_type: "project_task",
    notes: null,
    is_private: false,
  },
];

function ok<T>(data: T) {
  return { ok: true as const, status: 200, data };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(HomeScreen, { navigation: { navigate: mocks.navigate } } as never));
  });
  await flush();
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

describe("HomeScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearHomeCache();
    mocks.offline = false;
    mocks.features = { inventory: true, assets: true, projects: true };
    mocks.timer.status = "idle";
    mocks.timer.session = null;
    mocks.elapsedMs = null;
    mocks.listScheduleEntries.mockResolvedValue(ok({ data: SCHEDULE }));
    mocks.listTickets.mockResolvedValue(
      ok({
        data: [{ ticket_id: "tkt-1", ticket_number: "TKT-1", title: "Printer jam", client_name: "ECTS" }],
        pagination: { page: 1, limit: 5, total: 7, totalPages: 2, hasNext: true, hasPrev: false },
      }),
    );
    mocks.listActivities.mockResolvedValue(
      ok({
        data: [{ type: "ticket", id: "act-1", title: "Call back", dueDate: "2020-01-01" }],
        pagination: { page: 1, limit: 5, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
      }),
    );
  });

  it("T079 asks for the local-day window and sorts the entries by start", async () => {
    const renderer = await renderScreen();

    const { startDate, endDate } = localDayWindow();
    const call = mocks.listScheduleEntries.mock.calls[0][1];
    expect(call.startDate.slice(0, 10)).toBe(startDate.slice(0, 10));
    expect(call.endDate.slice(0, 10)).toBe(endDate.slice(0, 10));
    expect(call.userId).toBe("user-1");

    const all = texts(renderer);
    expect(all.indexOf("Morning visit")).toBeLessThan(all.indexOf("Afternoon visit"));
  });

  it("T074 renders the cards it has data for and collapses Today when empty", async () => {
    const renderer = await renderScreen();
    const all = texts(renderer);
    expect(all).toContain("Today");
    expect(all).toContain("My tickets");
    expect(all).toContain("Activities");
    expect(all).toContain("Quick actions");

    mocks.listScheduleEntries.mockResolvedValue(ok({ data: [] }));
    const without = await renderScreen();
    expect(texts(without)).not.toContain("Today");
  });

  it("T077 asks for my open tickets and shows the total", async () => {
    const renderer = await renderScreen();

    expect(mocks.listTickets.mock.calls[0][1]).toMatchObject({
      limit: 5,
      sort: "updated_at",
      filters: { assigned_to: "user-1", is_open: true },
    });
    expect(texts(renderer)).toContain("7");
  });

  it("T078 View all opens the Tickets tab with the assignee preset", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "home-tickets-view-all").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("TicketsTab", {
      screen: "TicketsList",
      params: { assignee: "me" },
    });
  });

  it("T080 a ticket schedule row opens the ticket and a task row the task", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "home-today-s-2").props.onPress());
    expect(mocks.navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "tkt-2" });

    await act(async () => renderer.root.find((n) => n.props?.testID === "home-today-s-1").props.onPress());
    expect(mocks.navigate).toHaveBeenCalledWith("ProjectTaskDetail", { taskId: "task-1" });
  });

  it("T081 asks activities for open items due by the end of today and badges overdue ones", async () => {
    const renderer = await renderScreen();

    expect(mocks.listActivities.mock.calls[0][1]).toMatchObject({ status: "open", sortBy: "dueDate" });
    expect(mocks.listActivities.mock.calls[0][1].dueDateEnd).toBeTruthy();
    expect(texts(renderer)).toContain("Overdue");
  });

  it("T075 one failing card shows its own error row while the others render", async () => {
    mocks.listTickets.mockResolvedValue({ ok: false, error: { kind: "server", message: "boom", status: 500 } });
    const renderer = await renderScreen();

    expect(renderer.root.find((n) => n.props?.testID === "home-tickets-error")).toBeTruthy();
    expect(texts(renderer)).toContain("Morning visit");

    mocks.listTickets.mockResolvedValue(
      ok({
        data: [{ ticket_id: "tkt-9", ticket_number: "TKT-9", title: "Back up", client_name: "ECTS" }],
        pagination: { page: 1, limit: 5, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
      }),
    );
    await act(async () => renderer.root.find((n) => n.props?.testID === "home-tickets-error-retry").props.onPress());
    await flush();

    expect(texts(renderer)).toContain("Back up");
  });

  it("T082 the timer card is hidden when idle and shows elapsed when running", async () => {
    expect(texts(await renderScreen())).not.toContain("Running timer");

    mocks.timer.status = "running";
    mocks.timer.session = { work_item_title: "Printer jam", status: "running" };
    mocks.elapsedMs = 65_000;
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain("Running timer");
    expect(texts(renderer)).toContain("Printer jam");
    await act(async () => renderer.root.find((n) => n.props?.testID === "home-timer-stop").props.onPress());
    expect(mocks.openStopModal).toHaveBeenCalled();
  });

  it("T083 the Scan quick action is absent without the inventory capability", async () => {
    const withInventory = await renderScreen();
    expect(withInventory.root.findAll((n) => n.props?.testID === "home-action-scan").length).toBeGreaterThan(0);

    mocks.features = { inventory: false, assets: true, projects: true };
    const without = await renderScreen();
    expect(without.root.findAll((n) => n.props?.testID === "home-action-scan")).toHaveLength(0);
  });

  it("T084 the Start timer quick action disappears while a timer runs", async () => {
    const idle = await renderScreen();
    expect(idle.root.findAll((n) => n.props?.testID === "home-action-start-timer").length).toBeGreaterThan(0);

    mocks.timer.status = "running";
    mocks.timer.session = { work_item_title: "Printer jam", status: "running" };
    mocks.elapsedMs = 1_000;
    const running = await renderScreen();
    expect(running.root.findAll((n) => n.props?.testID === "home-action-start-timer")).toHaveLength(0);
  });

  it("T085 offline renders the cached cards with the banner and issues no requests", async () => {
    await renderScreen();
    expect(mocks.listTickets).toHaveBeenCalledTimes(1);

    mocks.offline = true;
    vi.clearAllMocks();
    const renderer = await renderScreen();

    expect(mocks.listTickets).not.toHaveBeenCalled();
    expect(mocks.listScheduleEntries).not.toHaveBeenCalled();
    expect(mocks.listActivities).not.toHaveBeenCalled();
    expect(renderer.root.find((n) => n.props?.testID === "home-offline")).toBeTruthy();
    expect(texts(renderer)).toContain("Printer jam");
  });

  it("the New ticket action opens the create screen", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "home-action-new-ticket").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("CreateTicket");
  });
});
