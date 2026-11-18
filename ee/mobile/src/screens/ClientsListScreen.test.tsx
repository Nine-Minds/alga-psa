import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listClients: vi.fn(),
  createApiClient: vi.fn(),
  navigate: vi.fn(),
  setOptions: vi.fn(),
  refreshSession: vi.fn(),
  session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } } as Record<string, unknown> | null,
  config: { ok: true, env: "dev", baseUrl: "https://algapsa.test" } as Record<string, unknown>,
  features: { clientsCreate: true } as Record<string, boolean>,
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
  const FlatList = (props: Record<string, any>) => {
    const data: unknown[] = props.data ?? [];
    const children: React.ReactNode[] = [];
    if (props.ListHeaderComponent) children.push(R.createElement(R.Fragment, { key: "header" }, props.ListHeaderComponent));
    if (data.length === 0 && props.ListEmptyComponent) {
      children.push(R.createElement(R.Fragment, { key: "empty" }, props.ListEmptyComponent));
    } else {
      data.forEach((item, index) => {
        children.push(R.createElement(R.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index })));
      });
    }
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
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ session: mocks.session, refreshSession: mocks.refreshSession }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../api", () => ({ createApiClient: (...args: unknown[]) => mocks.createApiClient(...args) }));
vi.mock("../api/clients", () => ({ listClients: (...args: unknown[]) => mocks.listClients(...args) }));
vi.mock("../capabilities/CapabilitiesContext", () => ({ useCapabilities: () => ({ features: mocks.features }) }));
vi.mock("../features/clients/components/ClientFormModal", () => ({
  ClientFormModal: (props: Record<string, unknown>) => React.createElement("MockClientFormModal", props),
}));
vi.mock("../features/timer/components/HeaderTimerChip", () => ({ HeaderTimerChip: () => null }));
vi.mock("../ui/components/Avatar", () => ({
  Avatar: (props: Record<string, unknown>) => React.createElement("MockAvatar", props),
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { ClientsListScreen } from "./ClientsListScreen";

function page(items: unknown[], { page = 1, hasNext = false } = {}) {
  return { ok: true, data: { data: items, pagination: { page, limit: 25, total: items.length, totalPages: 1, hasNext, hasPrev: false } } };
}

const ACME = { client_id: "c-1", client_name: "Acme", phone_no: "+13202521658", email: "ops@acme.test", logoUrl: "/logos/acme.png", is_inactive: false };
const GLOBEX = { client_id: "c-2", client_name: "Globex", phone_no: null, email: null, is_inactive: true };

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(ClientsListScreen, { navigation: { navigate: mocks.navigate, setOptions: mocks.setOptions } } as never),
    );
  });
  await flush();
  return renderer;
}

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.join("") : String(c);
  });
}
const pressByLabel = async (r: ReactTestRenderer, label: string) => {
  const target = r.root.findAllByType(Pressable).find((p) => p.props.accessibilityLabel === label);
  if (!target) throw new Error(`No pressable labelled ${label}`);
  await act(async () => {
    target.props.onPress();
  });
  await flush();
};
const pressText = async (r: ReactTestRenderer, label: string) => {
  const target = r.root.findAllByType(Pressable).find((p) => p.findAllByType(Text).some((t) => t.props.children === label));
  if (!target) throw new Error(`No button with text ${label}`);
  await act(async () => {
    target.props.onPress();
  });
  await flush();
};
async function renderHeader(headerRight: () => React.ReactElement): Promise<ReactTestRenderer> {
  let header!: ReactTestRenderer;
  await act(async () => {
    header = create(headerRight());
  });
  return header;
}
const lastListArgs = () => mocks.listClients.mock.calls[mocks.listClients.mock.calls.length - 1][1];

describe("ClientsListScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } };
    mocks.config = { ok: true, env: "dev", baseUrl: "https://algapsa.test" };
    mocks.features = { clientsCreate: true };
    mocks.appStateListener = null;
    mocks.createApiClient.mockReturnValue({ request: vi.fn() });
    mocks.listClients.mockResolvedValue(page([ACME, GLOBEX]));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the first page and renders rows with contact snippet, logo and inactive badge", async () => {
    const r = await render();
    expect(mocks.createApiClient).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "https://algapsa.test" }));
    expect(lastListArgs()).toEqual(expect.objectContaining({ apiKey: "api-key", page: 1, limit: 25, search: undefined }));
    const all = texts(r);
    expect(all).toContain("Acme");
    expect(all).toContain("Globex");
    expect(all.some((s) => s.includes("ops@acme.test") && s.includes(" • "))).toBe(true);
    expect(all).toContain("detail.inactive");
    const avatars = r.root.findAll((n) => (n.type as unknown) === "MockAvatar");
    expect(avatars[0].props.imageUri).toBe("https://algapsa.test/logos/acme.png");
    expect(avatars[0].props.authToken).toBe("api-key");
    expect(avatars[1].props.imageUri).toBeNull();
  });

  it("shows a loading state while the first page is in flight", async () => {
    mocks.listClients.mockReturnValue(new Promise(() => undefined));
    const r = await render();
    expect(texts(r)).toContain("list.loadingClients");
  });

  it("navigates to the client detail when a row is pressed", async () => {
    const r = await render();
    await pressByLabel(r, "list.clientAccessibility");
    expect(mocks.navigate).toHaveBeenCalledWith("ClientDetail", { clientId: "c-1", clientName: "Acme" });
  });

  it("shows the no-access state on a permission error", async () => {
    mocks.listClients.mockResolvedValue({ ok: false, error: { kind: "permission" } });
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["list.noAccess", "list.noAccessDescription"]));
  });

  it("shows an error with retry, and retry reloads the list", async () => {
    mocks.listClients.mockResolvedValueOnce({ ok: false, error: { kind: "http", status: 500 } });
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["list.unableToLoad", "list.unableToLoadDescription"]));
    await pressText(r, "common:retry");
    expect(mocks.listClients).toHaveBeenCalledTimes(2);
    expect(texts(r)).toContain("Acme");
  });

  it("ignores canceled requests without showing an error", async () => {
    mocks.listClients.mockResolvedValue({ ok: false, error: { kind: "canceled" } });
    const r = await render();
    expect(texts(r)).not.toContain("list.unableToLoad");
  });

  it("shows the empty state with a refresh action when there are no clients", async () => {
    mocks.listClients.mockResolvedValue(page([]));
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["list.noClients", "list.noClientsDescription"]));
    await pressText(r, "common:refresh");
    expect(mocks.listClients).toHaveBeenCalledTimes(2);
  });

  it("debounces search, sends the trimmed term, and shows no-results; clear resets it", async () => {
    vi.useFakeTimers();
    const r = await render();
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText("  glob ");
    });
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(mocks.listClients).toHaveBeenCalledTimes(1);
    mocks.listClients.mockResolvedValue(page([]));
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(lastListArgs()).toEqual(expect.objectContaining({ search: "glob", page: 1 }));
    expect(texts(r)).toEqual(expect.arrayContaining(["list.noResults", "list.noResultsDescription"]));

    mocks.listClients.mockResolvedValue(page([ACME]));
    await pressByLabel(r, "Clear search");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await flush();
    expect(lastListArgs()).toEqual(expect.objectContaining({ search: undefined }));
    expect(texts(r)).toContain("Acme");
  });

  it("loads the next page on end reached and appends rows; stops when there is no next page", async () => {
    mocks.listClients.mockResolvedValueOnce(page([ACME], { hasNext: true }));
    mocks.listClients.mockResolvedValueOnce(page([GLOBEX], { page: 2, hasNext: false }));
    const r = await render();
    const list = () => r.root.find((n) => (n.type as unknown) === "FlatList");
    await act(async () => {
      await list().props.onEndReached();
    });
    await flush();
    expect(lastListArgs()).toEqual(expect.objectContaining({ page: 2 }));
    expect(texts(r)).toEqual(expect.arrayContaining(["Acme", "Globex"]));
    await act(async () => {
      await list().props.onEndReached();
    });
    expect(mocks.listClients).toHaveBeenCalledTimes(2);
  });

  it("pull-to-refresh and app resume reload page one", async () => {
    const r = await render();
    const refresh = r.root.find((n) => (n.type as unknown) === "FlatList").props.refreshControl.props.onRefresh;
    await act(async () => {
      await refresh();
    });
    expect(mocks.listClients).toHaveBeenCalledTimes(2);
    expect(mocks.appStateListener).toBeTypeOf("function");
    await act(async () => {
      mocks.appStateListener!("background");
    });
    await act(async () => {
      mocks.appStateListener!("active");
    });
    await flush();
    expect(mocks.listClients).toHaveBeenCalledTimes(3);
    expect(lastListArgs()).toEqual(expect.objectContaining({ page: 1 }));
  });

  it("exposes a create button in the header that opens the form, and navigates to the saved client", async () => {
    const r = await render();
    const headerRight = mocks.setOptions.mock.calls[mocks.setOptions.mock.calls.length - 1][0].headerRight;
    const header = await renderHeader(headerRight);
    const addButton = header.root.findAllByType(Pressable).find((p) => p.props.testID === "clients-create")!;
    expect(addButton.props.accessibilityLabel).toBe("list.create");

    const modal = () => r.root.find((n) => (n.type as unknown) === "MockClientFormModal");
    expect(modal().props.visible).toBe(false);
    await act(async () => {
      addButton.props.onPress();
    });
    expect(modal().props.visible).toBe(true);
    expect(modal().props.apiKey).toBe("api-key");

    await act(async () => {
      (modal().props.onSaved as (c: unknown) => void)({ client_id: "c-new", client_name: "Initech" });
    });
    await flush();
    expect(mocks.navigate).toHaveBeenCalledWith("ClientDetail", { clientId: "c-new", clientName: "Initech" });
    expect(mocks.listClients).toHaveBeenCalledTimes(2);

    await act(async () => {
      (modal().props.onClose as () => void)();
    });
    expect(modal().props.visible).toBe(false);
  });

  it("hides the create button without the clientsCreate capability", async () => {
    mocks.features = { clientsCreate: false };
    await render();
    const headerRight = mocks.setOptions.mock.calls[mocks.setOptions.mock.calls.length - 1][0].headerRight;
    const header = await renderHeader(headerRight);
    expect(header.root.findAllByType(Pressable).some((p) => p.props.testID === "clients-create")).toBe(false);
  });

  it("shows a signed-out state and makes no requests without a session", async () => {
    mocks.session = null;
    const r = await render();
    expect(texts(r)).toContain("common:signedOut");
    expect(mocks.listClients).not.toHaveBeenCalled();
  });

  it("shows a configuration error when the app config is invalid", async () => {
    mocks.config = { ok: false, error: "Missing base URL" };
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["common:configurationError", "Missing base URL"]));
    expect(mocks.listClients).not.toHaveBeenCalled();
  });
});
