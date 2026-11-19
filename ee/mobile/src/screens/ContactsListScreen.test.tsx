import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listContacts: vi.fn(),
  createApiClient: vi.fn(),
  navigate: vi.fn(),
  setOptions: vi.fn(),
  refreshSession: vi.fn(),
  session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } } as Record<string, unknown> | null,
  config: { ok: true, env: "dev", baseUrl: "https://algapsa.test" } as Record<string, unknown>,
  features: { contactsCreate: true } as Record<string, boolean>,
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
vi.mock("../api/contacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/contacts")>()),
  listContacts: (...args: unknown[]) => mocks.listContacts(...args),
}));
vi.mock("../capabilities/CapabilitiesContext", () => ({ useCapabilities: () => ({ features: mocks.features }) }));
vi.mock("../features/contacts/components/ContactFormModal", () => ({
  ContactFormModal: (props: Record<string, unknown>) => React.createElement("MockContactFormModal", props),
}));
vi.mock("../features/timer/components/HeaderTimerChip", () => ({ HeaderTimerChip: () => null }));
vi.mock("../ui/components/Avatar", () => ({
  Avatar: (props: Record<string, unknown>) => React.createElement("MockAvatar", props),
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { ContactsListScreen } from "./ContactsListScreen";

function page(items: unknown[], { page = 1, hasNext = false } = {}) {
  return { ok: true, data: { data: items, pagination: { page, limit: 25, total: items.length, totalPages: 1, hasNext, hasPrev: false } } };
}

const ADA = {
  contact_name_id: "ct-1",
  full_name: "Ada Lovelace",
  client_name: "Acme",
  default_phone_number: "+1 555 0100",
  email: "ada@acme.test",
  avatarUrl: "/avatars/ada.png",
  locations: [
    { location_id: "l-1", location_name: "HQ", is_primary: true },
    { location_id: "l-2", location_name: "Branch", is_primary: false },
  ],
};
const BOB = { contact_name_id: "ct-2", full_name: "Bob Remote", email: "bob@x.test", work_arrangement: "remote" };

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
      React.createElement(ContactsListScreen, { navigation: { navigate: mocks.navigate, setOptions: mocks.setOptions } } as never),
    );
  });
  await flush();
  return renderer;
}

async function renderHeader(headerRight: () => React.ReactElement): Promise<ReactTestRenderer> {
  let header!: ReactTestRenderer;
  await act(async () => {
    header = create(headerRight());
  });
  return header;
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
const lastListArgs = () => mocks.listContacts.mock.calls[mocks.listContacts.mock.calls.length - 1][1];
const flatList = (r: ReactTestRenderer) => r.root.find((n) => (n.type as unknown) === "FlatList");

describe("ContactsListScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } };
    mocks.config = { ok: true, env: "dev", baseUrl: "https://algapsa.test" };
    mocks.features = { contactsCreate: true };
    mocks.createApiClient.mockReturnValue({ request: vi.fn() });
    mocks.listContacts.mockResolvedValue(page([ADA, BOB]));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the first page and renders name, client, reach line and location label", async () => {
    const r = await render();
    expect(lastListArgs()).toEqual(expect.objectContaining({ apiKey: "api-key", page: 1, limit: 25, search: undefined }));
    const all = texts(r);
    expect(all).toEqual(expect.arrayContaining(["Ada Lovelace", "Acme", "+1 555 0100", "HQ +1", "Bob Remote", "bob@x.test", "Remote"]));
    const avatars = r.root.findAll((n) => (n.type as unknown) === "MockAvatar");
    expect(avatars[0].props.imageUri).toBe("https://algapsa.test/avatars/ada.png");
    expect(avatars[0].props.authToken).toBe("api-key");
    expect(avatars[1].props.imageUri).toBeUndefined();
  });

  it("shows a loading state while the first page is in flight", async () => {
    mocks.listContacts.mockReturnValue(new Promise(() => undefined));
    const r = await render();
    expect(texts(r)).toContain("list.loadingContacts");
  });

  it("navigates to the contact detail when a row is pressed", async () => {
    const r = await render();
    await pressByLabel(r, "list.contactAccessibility");
    expect(mocks.navigate).toHaveBeenCalledWith("ContactDetail", { contactId: "ct-1", contactName: "Ada Lovelace" });
  });

  it("shows the no-access state on a permission error", async () => {
    mocks.listContacts.mockResolvedValue({ ok: false, error: { kind: "permission" } });
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["list.noAccess", "list.noAccessDescription"]));
  });

  it("shows an error with retry, and retry reloads the list", async () => {
    mocks.listContacts.mockResolvedValueOnce({ ok: false, error: { kind: "http", status: 500 } });
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["list.unableToLoad", "list.unableToLoadDescription"]));
    await pressText(r, "common:retry");
    expect(mocks.listContacts).toHaveBeenCalledTimes(2);
    expect(texts(r)).toContain("Ada Lovelace");
  });

  it("keeps rows and shows an inline error when a later page fails", async () => {
    mocks.listContacts.mockResolvedValueOnce(page([ADA], { hasNext: true }));
    mocks.listContacts.mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    const r = await render();
    await act(async () => {
      await flatList(r).props.onEndReached();
    });
    await flush();
    const all = texts(r);
    expect(all).toContain("Ada Lovelace");
    expect(all).toContain("list.unableToLoadDescription");
  });

  it("shows the empty state with a refresh action when there are no contacts", async () => {
    mocks.listContacts.mockResolvedValue(page([]));
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["list.noContacts", "list.noContactsDescription"]));
    await pressText(r, "common:refresh");
    expect(mocks.listContacts).toHaveBeenCalledTimes(2);
  });

  it("debounces search, sends the trimmed term, and offers clear from the no-results state", async () => {
    vi.useFakeTimers();
    const r = await render();
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText("  ada ");
    });
    expect(r.root.findByType(TextInput).props.value).toBe("  ada ");
    await act(async () => {
      vi.advanceTimersByTime(349);
    });
    expect(mocks.listContacts).toHaveBeenCalledTimes(1);
    mocks.listContacts.mockResolvedValue(page([]));
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(lastListArgs()).toEqual(expect.objectContaining({ search: "ada", page: 1 }));
    expect(texts(r)).toEqual(expect.arrayContaining(["list.noResults", "list.noResultsDescription"]));

    mocks.listContacts.mockResolvedValue(page([BOB]));
    await pressText(r, "common:clear");
    expect(lastListArgs()).toEqual(expect.objectContaining({ search: undefined }));
    expect(r.root.findByType(TextInput).props.value).toBe("");
    expect(texts(r)).toContain("Bob Remote");
  });

  it("clears the search immediately from the field's clear button, cancelling a pending debounce", async () => {
    vi.useFakeTimers();
    const r = await render();
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText("bo");
    });
    await pressByLabel(r, "Clear search");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flush();
    expect(mocks.listContacts).toHaveBeenCalledTimes(1);
    expect(r.root.findByType(TextInput).props.value).toBe("");
  });

  it("loads the next page on end reached and appends rows; stops when there is no next page", async () => {
    mocks.listContacts.mockResolvedValueOnce(page([ADA], { hasNext: true }));
    mocks.listContacts.mockResolvedValueOnce(page([BOB], { page: 2, hasNext: false }));
    const r = await render();
    await act(async () => {
      await flatList(r).props.onEndReached();
    });
    await flush();
    expect(lastListArgs()).toEqual(expect.objectContaining({ page: 2 }));
    expect(texts(r)).toEqual(expect.arrayContaining(["Ada Lovelace", "Bob Remote"]));
    await act(async () => {
      await flatList(r).props.onEndReached();
    });
    expect(mocks.listContacts).toHaveBeenCalledTimes(2);
  });

  it("pull-to-refresh reloads page one", async () => {
    const r = await render();
    await act(async () => {
      await flatList(r).props.refreshControl.props.onRefresh();
    });
    expect(mocks.listContacts).toHaveBeenCalledTimes(2);
    expect(lastListArgs()).toEqual(expect.objectContaining({ page: 1 }));
  });

  it("exposes a create button that opens the form, and navigates to the saved contact", async () => {
    const r = await render();
    const headerRight = mocks.setOptions.mock.calls[mocks.setOptions.mock.calls.length - 1][0].headerRight;
    const header = await renderHeader(headerRight);
    const addButton = header.root.findAllByType(Pressable).find((p) => p.props.testID === "contacts-create")!;
    expect(addButton.props.accessibilityLabel).toBe("list.create");

    const modal = () => r.root.find((n) => (n.type as unknown) === "MockContactFormModal");
    expect(modal().props.visible).toBe(false);
    await act(async () => {
      addButton.props.onPress();
    });
    expect(modal().props.visible).toBe(true);

    await act(async () => {
      (modal().props.onSaved as (c: unknown) => void)({ contact_name_id: "ct-new", full_name: "Grace Hopper" });
    });
    await flush();
    expect(mocks.navigate).toHaveBeenCalledWith("ContactDetail", { contactId: "ct-new", contactName: "Grace Hopper" });
    expect(mocks.listContacts).toHaveBeenCalledTimes(2);

    await act(async () => {
      (modal().props.onClose as () => void)();
    });
    expect(modal().props.visible).toBe(false);
  });

  it("hides the create button without the contactsCreate capability", async () => {
    mocks.features = { contactsCreate: false };
    await render();
    const headerRight = mocks.setOptions.mock.calls[mocks.setOptions.mock.calls.length - 1][0].headerRight;
    const header = await renderHeader(headerRight);
    expect(header.root.findAllByType(Pressable).some((p) => p.props.testID === "contacts-create")).toBe(false);
  });

  it("shows a signed-out state and makes no requests without a session", async () => {
    mocks.session = null;
    const r = await render();
    expect(texts(r)).toContain("common:signedOut");
    expect(mocks.listContacts).not.toHaveBeenCalled();
  });

  it("shows a configuration error when the app config is invalid", async () => {
    mocks.config = { ok: false, error: "Missing base URL" };
    const r = await render();
    expect(texts(r)).toEqual(expect.arrayContaining(["common:configurationError", "Missing base URL"]));
    expect(mocks.listContacts).not.toHaveBeenCalled();
  });
});
