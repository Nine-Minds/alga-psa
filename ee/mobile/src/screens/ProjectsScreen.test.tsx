import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectStatuses: vi.fn(),
  listClients: vi.fn(),
  getSecureJson: vi.fn(),
  setSecureJson: vi.fn(),
  navigate: vi.fn(),
  offline: false,
  // Stable identity, like production react-i18next.
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

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  const ReactLocal = await import("react");
  const FlatList = (props: Record<string, any>) => {
    const data: unknown[] = props.data ?? [];
    const children: React.ReactNode[] = [];
    if (props.ListHeaderComponent) {
      children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: "header" }, props.ListHeaderComponent));
    }
    if (data.length === 0 && props.ListEmptyComponent) {
      children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: "empty" }, props.ListEmptyComponent));
    } else {
      data.forEach((item, index) => {
        const key = props.keyExtractor ? props.keyExtractor(item, index) : String(index);
        children.push(ReactLocal.createElement(ReactLocal.Fragment, { key }, props.renderItem({ item, index })));
      });
    }
    return ReactLocal.createElement("FlatList", { testID: props.testID, onEndReached: props.onEndReached }, children);
  };
  return { ...actual, FlatList };
});

vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } },
    refreshSession: vi.fn(),
  }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/projects")>()),
  listProjects: (...args: unknown[]) => mocks.listProjects(...args),
  listProjectStatuses: (...args: unknown[]) => mocks.listProjectStatuses(...args),
}));
vi.mock("../api/clients", () => ({ listClients: (...args: unknown[]) => mocks.listClients(...args) }));
vi.mock("../storage/secureStorage", () => ({
  getSecureJson: (...args: unknown[]) => mocks.getSecureJson(...args),
  setSecureJson: (...args: unknown[]) => mocks.setSecureJson(...args),
}));
vi.mock("../network/useNetworkStatus", () => ({
  useNetworkStatus: () => (mocks.offline ? { isConnected: false, isInternetReachable: false } : { isConnected: true, isInternetReachable: true }),
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { ProjectsScreen } from "./ProjectsScreen";

const STATUSES = [
  { status_id: "st-open", name: "In Progress", is_closed: false, order_number: 1 },
  { status_id: "st-planned", name: "Planned", is_closed: false, order_number: 2 },
  { status_id: "st-done", name: "Completed", is_closed: true, order_number: 3 },
];

function projectsPage(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      data: items,
      pagination: { page: 1, limit: 25, total: items.length, totalPages: 1, hasNext: false, hasPrev: false, ...overrides },
    },
  };
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
    renderer = create(React.createElement(ProjectsScreen, { navigation: { navigate: mocks.navigate } } as never));
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

function lastListCall() {
  return mocks.listProjects.mock.calls[mocks.listProjects.mock.calls.length - 1][1];
}

describe("ProjectsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.offline = false;
    mocks.getSecureJson.mockResolvedValue(null);
    mocks.setSecureJson.mockResolvedValue(undefined);
    mocks.listProjectStatuses.mockResolvedValue({ ok: true, data: { data: STATUSES, pagination: { total: 3 } } });
    mocks.listClients.mockResolvedValue({ ok: true, data: { data: [{ client_id: "cl-1", client_name: "ECTS" }] } });
    mocks.listProjects.mockResolvedValue(
      projectsPage([
        {
          project_id: "p-1",
          project_name: "Office move",
          client_id: "cl-1",
          client_name: "ECTS",
          status: "st-open",
          end_date: "2026-11-02",
        },
      ]),
    );
  });

  it("T013 renders rows with the client name and the registry status label", async () => {
    const renderer = await renderScreen();
    const all = texts(renderer);
    expect(all).toContain("Office move");
    expect(all).toContain("ECTS");
    expect(all).toContain("In Progress");
  });

  it("T016 asks for the open statuses only and filters the closed ones out", async () => {
    mocks.listProjects.mockResolvedValue(
      projectsPage([
        { project_id: "p-1", project_name: "Office move", client_id: "cl-1", status: "st-open" },
        { project_id: "p-2", project_name: "Finished thing", client_id: "cl-1", status: "st-done" },
      ]),
    );
    const renderer = await renderScreen();

    // Two open statuses means no server-side status filter, so the closed one
    // is dropped client-side.
    expect(lastListCall().status).toBeUndefined();
    const all = texts(renderer);
    expect(all).toContain("Office move");
    expect(all).not.toContain("Finished thing");
  });

  it("T015 issues one search request with project_name after the debounce", async () => {
    const renderer = await renderScreen();
    const initialCalls = mocks.listProjects.mock.calls.length;

    await act(async () => {
      renderer.root.find((n) => n.props?.accessibilityLabel === "Search projects" && n.props?.onChangeText)
        .props.onChangeText("off");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await flush();

    expect(mocks.listProjects.mock.calls.length).toBe(initialCalls + 1);
    expect(lastListCall().project_name).toBe("off");
  });

  it("T017 adds assigned_to when Managed by me is on", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "projects-filters").props.onPress());
    await act(async () => {
      renderer.root.find((n) => n.props?.testID === "projects-filter-managed-by-me").props.onValueChange(true);
    });
    await act(async () => renderer.root.find((n) => n.props?.testID === "projects-filter-apply").props.onPress());
    await flush();

    expect(lastListCall().assigned_to).toBe("user-1");
  });

  it("T014 requests the next page when the list end is reached and appends rows", async () => {
    mocks.listProjects.mockResolvedValueOnce(
      projectsPage([{ project_id: "p-1", project_name: "Office move", client_id: "cl-1", status: "st-open" }], {
        hasNext: true,
        total: 2,
      }),
    );
    const renderer = await renderScreen();

    mocks.listProjects.mockResolvedValueOnce(
      projectsPage([{ project_id: "p-2", project_name: "Cabling", client_id: "cl-1", status: "st-open" }], {
        page: 2,
      }),
    );
    await act(async () => renderer.root.find((n) => n.props?.testID === "projects-list").props.onEndReached());
    await flush();

    expect(lastListCall().page).toBe(2);
    const all = texts(renderer);
    expect(all).toContain("Office move");
    expect(all).toContain("Cabling");
  });

  it("T018 renders the error row with Retry and re-issues the request", async () => {
    mocks.listProjects.mockResolvedValue({ ok: false, error: { kind: "server", message: "boom", status: 500 } });
    const renderer = await renderScreen();
    const callsAfterError = mocks.listProjects.mock.calls.length;

    expect(texts(renderer)).toContain("Unable to load.");
    await act(async () => renderer.root.find((n) => n.props?.accessibilityRole === "button" && n.props?.onPress && n.props?.testID === undefined).props.onPress());
    await flush();

    expect(mocks.listProjects.mock.calls.length).toBeGreaterThan(callsAfterError);
  });

  it("T019 opens ProjectDetail with the project id on row tap", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "project-row-p-1").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("ProjectDetail", {
      projectId: "p-1",
      projectName: "Office move",
    });
  });

  it("T017 keeps the saved filters from the previous session", async () => {
    mocks.getSecureJson.mockResolvedValue({
      statusIds: ["st-done"],
      clientId: "cl-1",
      clientName: "ECTS",
      managedByMe: true,
    });
    await renderScreen();

    const call = lastListCall();
    expect(call.status).toBe("st-done");
    expect(call.client_id).toBe("cl-1");
    expect(call.assigned_to).toBe("user-1");
  });
});
