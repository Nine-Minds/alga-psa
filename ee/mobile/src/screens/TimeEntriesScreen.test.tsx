import React from "react";
import { Pressable, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  getCurrentTimePeriod: vi.fn(),
  listTimePeriods: vi.fn(),
  listTimeEntries: vi.fn(),
  createApiClient: vi.fn(),
  refreshSession: vi.fn(),
  session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } } as Record<string, unknown> | null,
  config: { ok: true, env: "dev", baseUrl: "https://algapsa.test" } as Record<string, unknown>,
  appStateListener: null as null | ((state: string) => void),
  t: (key: string, opts?: Record<string, unknown>) => {
    let out = (opts?.defaultValue as string | undefined) ?? key;
    if (opts) for (const [k, v] of Object.entries(opts)) out = out.replaceAll(`{{${k}}}`, String(v));
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  const R = await import("react");
  const SectionList = (props: Record<string, any>) => {
    const sections: Array<{ key: string; data: unknown[] }> = props.sections ?? [];
    const children: React.ReactNode[] = [];
    if (props.ListHeaderComponent) children.push(R.createElement(R.Fragment, { key: "header" }, props.ListHeaderComponent));
    if (sections.length === 0 && props.ListEmptyComponent) {
      children.push(R.createElement(R.Fragment, { key: "empty" }, props.ListEmptyComponent));
    }
    for (const section of sections) {
      children.push(R.createElement(R.Fragment, { key: `s-${section.key}` }, props.renderSectionHeader({ section })));
      section.data.forEach((item, index) => {
        children.push(R.createElement(R.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index, section })));
      });
    }
    return R.createElement("SectionList", { refreshControl: props.refreshControl }, children);
  };
  const AppState = {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.appStateListener = listener;
      return { remove: () => undefined };
    },
  };
  return { ...actual, SectionList, AppState };
});
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ session: mocks.session, refreshSession: mocks.refreshSession }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../api", () => ({ createApiClient: (...args: unknown[]) => mocks.createApiClient(...args) }));
vi.mock("../api/timeEntries", () => ({
  getCurrentTimePeriod: (...args: unknown[]) => mocks.getCurrentTimePeriod(...args),
  listTimePeriods: (...args: unknown[]) => mocks.listTimePeriods(...args),
  listTimeEntries: (...args: unknown[]) => mocks.listTimeEntries(...args),
}));
vi.mock("../ui/formatters/dateTime", () => ({
  getDateTimeLocale: () => "en-US",
  formatDateShort: (value: string) => `day:${value}`,
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { TimeEntriesScreen } from "./TimeEntriesScreen";

const PERIOD = { period_id: "p-1", start_date: "2026-11-01", end_date: "2026-12-01" };

function entriesPage(items: unknown[], hasNext = false) {
  return { ok: true, data: { data: items, pagination: { page: 1, limit: 100, total: items.length, totalPages: 1, hasNext, hasPrev: false } } };
}

const ENTRY_A = {
  entry_id: "e-1",
  work_date: "2026-11-17",
  start_time: "2026-11-17T09:00:00Z",
  end_time: "2026-11-17T10:30:00Z",
  service_name: "Remote support",
  work_item_type: "ticket",
  notes: "Reset the VPN",
  approval_status: "APPROVED",
  is_billable: true,
};
const ENTRY_B = {
  entry_id: "e-2",
  work_date: "2026-11-16",
  billable_duration: 0,
  start_time: null,
  end_time: null,
  service_name: null,
  work_item_type: "non_billable_category",
  approval_status: "CHANGES_REQUESTED",
};

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(TimeEntriesScreen));
  });
  await flush();
  return renderer;
}

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.filter((x) => typeof x === "string").join("") : String(c);
  });
}
const pressText = async (r: ReactTestRenderer, label: string) => {
  const target = r.root.findAllByType(Pressable).find((p) => p.findAllByType(Text).some((t) => t.props.children === label));
  if (!target) throw new Error(`No button with text ${label}`);
  await act(async () => {
    target.props.onPress();
  });
  await flush();
};

describe("TimeEntriesScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 18, 12, 0, 0));
    mocks.session = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } };
    mocks.config = { ok: true, env: "dev", baseUrl: "https://algapsa.test" };
    mocks.appStateListener = null;
    mocks.createApiClient.mockReturnValue({ request: vi.fn() });
    mocks.getCurrentTimePeriod.mockResolvedValue({ ok: true, data: { data: PERIOD } });
    mocks.listTimePeriods.mockResolvedValue({ ok: true, data: { data: [] } });
    mocks.listTimeEntries.mockResolvedValue(entriesPage([ENTRY_A, ENTRY_B]));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the current period and the user's entries for it, grouped by day", async () => {
    const r = await render();
    expect(mocks.getCurrentTimePeriod).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: "api-key", date: "2026-11-18" }));
    expect(mocks.listTimePeriods).not.toHaveBeenCalled();
    expect(mocks.listTimeEntries).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 1, limit: 100, user_id: "user-1", date_from: "2026-11-01", date_to: "2026-11-30" }),
    );
    const all = texts(r);
    expect(all).toContain("Current period");
    expect(all).toContain("1h 30m logged");
    expect(all).not.toContain("No time period is configured, showing the current month.");
    expect(all).toEqual(expect.arrayContaining(["day:2026-11-17", "day:2026-11-16"]));
    expect(all).toContain("Remote support • Ticket");
    expect(all).toContain("Reset the VPN");
    expect(all).toEqual(expect.arrayContaining(["Approved", "Billable", "Changes Requested", "No service • Non-billable"]));
    expect(all.indexOf("day:2026-11-17")).toBeLessThan(all.indexOf("day:2026-11-16"));
  });

  it("falls back to the configured period list when /current has no usable period", async () => {
    mocks.getCurrentTimePeriod.mockResolvedValue({ ok: true, data: { data: [] } });
    mocks.listTimePeriods.mockResolvedValue({ ok: true, data: { data: [{ period_id: "p-2", start_date: "2026-11-15", end_date: "2026-11-22" }] } });
    await render();
    expect(mocks.listTimePeriods).toHaveBeenCalled();
    expect(mocks.listTimeEntries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ date_from: "2026-11-15", date_to: "2026-11-21" }));
  });

  it("uses the calendar month and says so when no period is configured", async () => {
    mocks.getCurrentTimePeriod.mockResolvedValue({ ok: false, error: { kind: "http", status: 404 } });
    mocks.listTimePeriods.mockResolvedValue({ ok: false, error: { kind: "permission" } });
    const r = await render();
    expect(mocks.listTimeEntries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ date_from: "2026-11-01", date_to: "2026-11-30" }));
    expect(texts(r)).toContain("No time period is configured, showing the current month.");
  });

  it("shows an error with retry when the period list fails", async () => {
    mocks.getCurrentTimePeriod.mockResolvedValue({ ok: false, error: { kind: "network" } });
    mocks.listTimePeriods.mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    mocks.listTimePeriods.mockResolvedValueOnce({ ok: true, data: { data: [PERIOD] } });
    const r = await render();
    expect(mocks.listTimeEntries).not.toHaveBeenCalled();
    expect(texts(r)).toEqual(expect.arrayContaining(["Unable to load time entries", "Please check your connection and try again."]));
    await pressText(r, "common:retry");
    expect(mocks.listTimeEntries).toHaveBeenCalledTimes(1);
    expect(texts(r)).toContain("Remote support • Ticket");
  });

  it("shows an error when entries fail to load", async () => {
    mocks.listTimeEntries.mockResolvedValue({ ok: false, error: { kind: "http", status: 500 } });
    const r = await render();
    expect(texts(r)).toContain("Unable to load time entries");
  });

  it("shows the no-access state on a permission error from entries", async () => {
    mocks.listTimeEntries.mockResolvedValue({ ok: false, error: { kind: "permission" } });
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["No access to time entries"]));
  });

  it("stays quiet when the period request is canceled", async () => {
    mocks.getCurrentTimePeriod.mockResolvedValue({ ok: false, error: { kind: "canceled" } });
    const r = await render();
    expect(mocks.listTimeEntries).not.toHaveBeenCalled();
    expect(texts(r)).not.toContain("Unable to load time entries");
  });

  it("follows pagination and caps at five pages with a truncation note", async () => {
    mocks.listTimeEntries.mockImplementation((_c: unknown, params: { page: number }) =>
      Promise.resolve(entriesPage([{ ...ENTRY_A, entry_id: `e-p${params.page}` }], true)),
    );
    const r = await render();
    expect(mocks.listTimeEntries).toHaveBeenCalledTimes(5);
    expect(mocks.listTimeEntries.mock.calls.map((c) => c[1].page)).toEqual([1, 2, 3, 4, 5]);
    expect(texts(r)).toContain("Showing the most recent 5 entries for this period.");
  });

  it("shows the empty state with a refresh action", async () => {
    mocks.listTimeEntries.mockResolvedValue(entriesPage([]));
    const r = await render();
    expect(texts(r)).toContain("No time entries this period");
    expect(texts(r)).toContain("0m logged");
    await pressText(r, "common:refresh");
    expect(mocks.listTimeEntries).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state while the first load is in flight", async () => {
    mocks.getCurrentTimePeriod.mockReturnValue(new Promise(() => undefined));
    const r = await render();
    expect(texts(r)).toContain("Loading time entries…");
  });

  it("reloads on pull-to-refresh and on app resume", async () => {
    const r = await render();
    const list = r.root.find((n) => (n.type as unknown) === "SectionList");
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });
    expect(mocks.listTimeEntries).toHaveBeenCalledTimes(2);
    await act(async () => {
      mocks.appStateListener!("background");
    });
    await act(async () => {
      mocks.appStateListener!("active");
    });
    await flush();
    expect(mocks.listTimeEntries).toHaveBeenCalledTimes(3);
  });

  it("shows a signed-out state and makes no requests without a session", async () => {
    mocks.session = null;
    const r = await render();
    expect(texts(r)).toContain("common:signedOut");
    expect(mocks.getCurrentTimePeriod).not.toHaveBeenCalled();
  });

  it("shows a configuration error when the app config is invalid", async () => {
    mocks.config = { ok: false, error: "Missing base URL" };
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["common:configurationError", "Missing base URL"]));
  });
});
