import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const { getClientMock, getClientContactsMock, getClientLocationsMock, placeCallMock, translate, authValue, capabilities } = vi.hoisted(() => ({
  capabilities: { features: { clientsCreate: false, clientsUpdate: false, contactsCreate: false, contactsUpdate: false }, defaultCountry: "US", loaded: true },
  getClientMock: vi.fn(),
  getClientContactsMock: vi.fn(),
  getClientLocationsMock: vi.fn(),
  placeCallMock: vi.fn(),
  // Stable identity across renders so the screen's fetch callback does not refire on every render.
  translate: (key: string) => key,
  authValue: {
    session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } },
    refreshSession: () => Promise.resolve(null),
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("@react-navigation/native", () => ({ CommonActions: { navigate: vi.fn() } }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => authValue }));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/clients", () => ({
  getClient: (...args: unknown[]) => getClientMock(...args),
  getClientContacts: (...args: unknown[]) => getClientContactsMock(...args),
  getClientLocations: (...args: unknown[]) => getClientLocationsMock(...args),
  updateClient: vi.fn(),
}));
vi.mock("../api/contacts", () => ({ buildContactAvatarUri: () => null, getContactReachLine: () => null }));
vi.mock("../device/clientMetadata", () => ({ getClientMetadataHeaders: async () => ({}) }));
vi.mock("../capabilities/CapabilitiesContext", () => ({ useCapabilities: () => capabilities }));
vi.mock("../features/clients/components/ClientFormModal", () => ({
  ClientFormModal: (props: Record<string, unknown>) => React.createElement("MockClientFormModal", props),
}));
vi.mock("../features/contacts/components/ContactFormModal", () => ({
  ContactFormModal: (props: Record<string, unknown>) => React.createElement("MockContactFormModal", props),
}));
vi.mock("../ui/components/Avatar", () => ({ Avatar: () => null }));
vi.mock("../features/clients/components/AccountManagerPickerModal", () => ({ AccountManagerPickerModal: () => null }));
vi.mock("../features/clients/components/ClientNotesSection", () => ({ ClientNotesSection: () => null }));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("../features/interactions/hooks/usePlaceCall", () => ({ usePlaceCall: () => placeCallMock }));
vi.mock("../features/interactions/components/CallPromptHost", () => ({
  CallPromptHost: (props: Record<string, unknown>) => React.createElement("MockCallPromptHost", props),
}));

import { ClientDetailScreen } from "./ClientDetailScreen";

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(ClientDetailScreen, {
        route: { params: { clientId: "client-1", clientName: "Acme" } } as never,
        navigation: { navigate: vi.fn(), setParams: vi.fn(), dispatch: vi.fn(), setOptions: vi.fn() } as never,
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

describe("ClientDetailScreen calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientMock.mockResolvedValue({ ok: true, data: { data: { client_id: "client-1", client_name: "Acme", phone_no: " +13202521658 ", email: null, url: null } } });
    getClientLocationsMock.mockResolvedValue({ ok: true, data: { data: [] } });
    getClientContactsMock.mockResolvedValue({ ok: true, data: { data: [], pagination: { total: 0 } } });
  });

  it("dials the client's number through the shared call flow, attributed to the client", async () => {
    const renderer = await renderScreen();

    const row = renderer.root.find((n) => n.props?.accessibilityLabel === "detail.phone: +1 320 252 1658");
    act(() => row.props.onPress());

    expect(placeCallMock).toHaveBeenCalledWith({
      origin: { kind: "client", id: "client-1" },
      phone: "+13202521658",
      name: "Acme",
      contactId: null,
      clientId: "client-1",
    });
  });

  it("hosts the log-this-call prompt for calls placed from this client", async () => {
    const renderer = await renderScreen();

    const host = renderer.root.find((n) => String(n.type) === "MockCallPromptHost");
    expect(host.props).toMatchObject({ origin: { kind: "client", id: "client-1" }, apiKey: "api-key", userId: "user-1" });
  });

  it("offers no call action when the client has no phone", async () => {
    getClientMock.mockResolvedValue({ ok: true, data: { data: { client_id: "client-1", client_name: "Acme", phone_no: null, email: null, url: null } } });
    const renderer = await renderScreen();

    expect(renderer.root.findAll((n) => typeof n.props?.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("detail.phone:"))).toHaveLength(0);
  });
});

describe("ClientDetailScreen maps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientContactsMock.mockResolvedValue({ ok: true, data: { data: [], pagination: { total: 0 } } });
  });

  it("opens the client's address in the maps app", async () => {
    const { Linking } = await import("react-native");
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    getClientMock.mockResolvedValue({ ok: true, data: { data: { client_id: "client-1", client_name: "Acme", phone_no: null, email: null, url: null, address: "1 Main St\nSpringfield, IL" } } });
    getClientLocationsMock.mockResolvedValue({ ok: true, data: { data: [] } });
    const renderer = await renderScreen();

    const row = renderer.root.find((n) => n.props?.accessibilityLabel === "detail.address: 1 Main St\nSpringfield, IL");
    act(() => row.props.onPress());

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl.mock.calls[0][0]).toMatch(/^(maps|geo):0,0\?q=1%20Main%20St%2C%20Springfield%2C%20IL$/);
  });

  it("opens each listed location in the maps app", async () => {
    const { Linking } = await import("react-native");
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    getClientMock.mockResolvedValue({ ok: true, data: { data: { client_id: "client-1", client_name: "Acme", phone_no: null, email: null, url: null, address: null } } });
    getClientLocationsMock.mockResolvedValue({
      ok: true,
      data: { data: [{ location_id: "loc-1", location_name: "Warehouse", address_line1: "9 Dock Rd", city: "Springfield", state_province: "IL", postal_code: "62701", country_name: "United States", is_default: false, phone: null }] },
    });
    const renderer = await renderScreen();

    const link = renderer.root.find((n) => n.props?.accessibilityLabel === "detail.openInMaps");
    act(() => link.props.onPress());

    expect(openUrl.mock.calls[0][0]).toMatch(/^(maps|geo):0,0\?q=9%20Dock%20Rd%2C%20Springfield%2C%20IL%2C%2062701%2C%20United%20States$/);
  });
});

describe("ClientDetailScreen editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilities.features = { clientsCreate: false, clientsUpdate: false, contactsCreate: false, contactsUpdate: false };
    getClientMock.mockResolvedValue({ ok: true, data: { data: { client_id: "client-1", client_name: "Acme", phone_no: null, email: null, url: null } } });
    getClientLocationsMock.mockResolvedValue({ ok: true, data: { data: [] } });
    getClientContactsMock.mockResolvedValue({ ok: true, data: { data: [], pagination: { total: 0 } } });
  });

  it("hides the edit and add-contact actions without write permission", async () => {
    const renderer = await renderScreen();
    expect(renderer.root.findAll((n) => n.props?.testID === "client-detail-add-contact")).toHaveLength(0);
    const editModal = renderer.root.findByType("MockClientFormModal" as never);
    expect(editModal.props.visible).toBe(false);
  });

  it("offers add-contact and opens the contact form locked to this client", async () => {
    capabilities.features = { ...capabilities.features, contactsCreate: true };
    const renderer = await renderScreen();

    const add = renderer.root.find((n) => n.props?.testID === "client-detail-add-contact");
    act(() => add.props.onPress());

    const modal = renderer.root.findByType("MockContactFormModal" as never);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.presetClient).toEqual({ id: "client-1", name: "Acme" });
    expect(modal.props.lockClient).toBe(true);
  });

  it("opens the edit form from the header when the user may update clients", async () => {
    capabilities.features = { ...capabilities.features, clientsUpdate: true };
    const renderer = await renderScreen();
    const setOptions = (renderer.root.findByType(ClientDetailScreen).props.navigation as { setOptions: ReturnType<typeof vi.fn> }).setOptions;
    const headerRight = setOptions.mock.calls.at(-1)?.[0]?.headerRight;
    expect(typeof headerRight).toBe("function");

    let header!: ReactTestRenderer;
    act(() => { header = create(headerRight()); });
    act(() => header.root.find((n) => n.props?.testID === "client-detail-edit").props.onPress());

    const modal = renderer.root.findByType("MockClientFormModal" as never);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.mode).toBe("edit");
    expect(modal.props.initial.detail.client_name).toBe("Acme");
  });

  it("only offers the account manager change to users who may update clients", async () => {
    const withoutRights = await renderScreen();
    // A read-only row renders without a pressable wrapper.
    expect(withoutRights.root.findAll((n) => typeof n.props?.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("detail.accountManager"))).toHaveLength(0);

    capabilities.features = { ...capabilities.features, clientsUpdate: true };
    const withRights = await renderScreen();
    const editable = withRights.root.find((n) => typeof n.props?.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("detail.accountManager") && n.props.accessibilityRole === "button");
    expect(typeof editable.props.onPress).toBe("function");
  });
});
