import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  readRecent: vi.fn(),
  writeRecent: vi.fn(),
  navigate: vi.fn(),
  features: { assets: true, projects: true },
  offline: false,
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
vi.mock("../api/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/search")>()),
  search: (...args: unknown[]) => mocks.search(...args),
}));
vi.mock("../features/search/recentSearches", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/search/recentSearches")>()),
  readRecentSearches: (...args: unknown[]) => mocks.readRecent(...args),
  writeRecentSearches: (...args: unknown[]) => mocks.writeRecent(...args),
}));
vi.mock("../network/useNetworkStatus", () => ({
  useNetworkStatus: () =>
    mocks.offline ? { isConnected: false, isInternetReachable: false } : { isConnected: true, isInternetReachable: true },
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { SearchScreen } from "./SearchScreen";

function payload(results: unknown[], nextCursor?: string) {
  return { ok: true, data: { data: { results, nextCursor } } };
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
    renderer = create(
      React.createElement(SearchScreen, {
        navigation: { navigate: mocks.navigate },
        route: { params: undefined },
      } as never),
    );
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

async function type(renderer: ReactTestRenderer, value: string) {
  await act(async () => {
    renderer.root.find((n) => n.props?.accessibilityLabel === "Search" && n.props?.onChangeText).props.onChangeText(value);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  await flush();
}

describe("SearchScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.offline = false;
    mocks.features = { assets: true, projects: true };
    mocks.readRecent.mockResolvedValue([]);
    mocks.writeRecent.mockResolvedValue(undefined);
    mocks.search.mockResolvedValue(payload([]));
  });

  it("T090 searches after the debounce for two characters and not for one", async () => {
    const renderer = await renderScreen();

    await type(renderer, "f");
    expect(mocks.search).not.toHaveBeenCalled();

    await type(renderer, "fl");
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search.mock.calls[0][1]).toMatchObject({ query: "fl" });
  });

  it("T091 groups results in the fixed order and More asks for one type with its cursor", async () => {
    mocks.search.mockResolvedValue(
      payload(
        [
          { type: "client", id: "c-1", title: "ECTS", subtitle: "Client" },
          { type: "client", id: "c-2", title: "ECTS North" },
          { type: "client", id: "c-3", title: "ECTS South" },
          { type: "client", id: "c-4", title: "ECTS East" },
          { type: "client", id: "c-5", title: "ECTS West" },
          { type: "ticket", id: "t-1", title: "Printer jam" },
        ],
        "cursor-1",
      ),
    );
    const renderer = await renderScreen();
    await type(renderer, "ects");

    // This harness's t() echoes the default, which is the raw group type.
    const all = texts(renderer);
    expect(all.indexOf("ticket")).toBeGreaterThanOrEqual(0);
    expect(all.indexOf("ticket")).toBeLessThan(all.indexOf("client"));

    await act(async () => renderer.root.find((n) => n.props?.testID === "search-more-client").props.onPress());
    await flush();

    const lastCall = mocks.search.mock.calls[mocks.search.mock.calls.length - 1][1];
    expect(lastCall).toMatchObject({ types: ["client"], cursor: "cursor-1" });
  });

  it("T092 opens a ticket result", async () => {
    mocks.search.mockResolvedValue(payload([{ type: "ticket", id: "t-1", title: "Printer jam" }]));
    const renderer = await renderScreen();
    await type(renderer, "printer");

    await act(async () => renderer.root.find((n) => n.props?.testID === "search-result-ticket-t-1").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "t-1" });
  });

  it("T093 records the query in recent searches and Clear empties them", async () => {
    const renderer = await renderScreen();
    await type(renderer, "flagg");

    expect(mocks.writeRecent).toHaveBeenCalledWith(expect.stringContaining("user-1"), ["flagg"]);

    await type(renderer, "");
    expect(texts(renderer)).toContain("flagg");

    await act(async () => renderer.root.find((n) => n.props?.testID === "search-clear-recent").props.onPress());
    expect(texts(renderer)).not.toContain("flagg");
  });

  it("T094 ignores a response for an older query", async () => {
    let resolveFirst: ((value: unknown) => void) | null = null;
    mocks.search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    mocks.search.mockResolvedValueOnce(payload([{ type: "ticket", id: "t-new", title: "Newest" }]));

    const renderer = await renderScreen();
    await type(renderer, "old");
    await type(renderer, "new");

    // The stale answer lands last and must not replace the newer results.
    await act(async () => {
      resolveFirst?.(payload([{ type: "ticket", id: "t-old", title: "Stale" }]));
      await flush();
    });

    expect(texts(renderer)).toContain("Newest");
    expect(texts(renderer)).not.toContain("Stale");
  });

  it("T089 asks only for the capability-backed types", async () => {
    mocks.features = { assets: false, projects: false };
    const renderer = await renderScreen();
    await type(renderer, "ab");

    expect(mocks.search.mock.calls[0][1].types).toEqual(["ticket", "client", "contact"]);
  });

  it("T125 Retry re-issues the search for the same query", async () => {
    mocks.search.mockResolvedValue({ ok: false, error: { kind: "server", message: "boom", status: 500 } });
    const renderer = await renderScreen();
    await type(renderer, "flagg");

    expect(renderer.root.find((n) => n.props?.testID === "search-error")).toBeTruthy();
    const callsBefore = mocks.search.mock.calls.length;

    mocks.search.mockResolvedValue(payload([{ type: "client", id: "c-1", title: "Flagg Inc" }]));
    await act(async () => renderer.root.find((n) => n.props?.testID === "search-retry").props.onPress());
    await flush();

    expect(mocks.search.mock.calls.length).toBe(callsBefore + 1);
    expect(mocks.search.mock.calls[callsBefore][1]).toMatchObject({ query: "flagg" });
    expect(texts(renderer)).toContain("Flagg Inc");
  });

  it("shows the empty state and the offline state", async () => {
    const renderer = await renderScreen();
    await type(renderer, "nothing");
    expect(renderer.root.find((n) => n.props?.testID === "search-empty")).toBeTruthy();

    mocks.offline = true;
    const offlineRenderer = await renderScreen();
    await type(offlineRenderer, "anything");
    expect(offlineRenderer.root.find((n) => n.props?.testID === "search-error")).toBeTruthy();
  });
});
