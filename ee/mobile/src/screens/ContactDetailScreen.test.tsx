import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const { getContactMock, placeCallMock, translate, authValue, capabilities } = vi.hoisted(() => ({
  capabilities: { features: { clientsCreate: false, clientsUpdate: false, contactsCreate: false, contactsUpdate: false }, defaultCountry: "US", loaded: true },
  getContactMock: vi.fn(),
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
vi.mock("../api/contacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/contacts")>()),
  getContact: (...args: unknown[]) => getContactMock(...args),
}));
vi.mock("../capabilities/CapabilitiesContext", () => ({ useCapabilities: () => capabilities }));
vi.mock("../features/contacts/components/ContactFormModal", () => ({
  ContactFormModal: (props: Record<string, unknown>) => React.createElement("MockContactFormModal", props),
}));
vi.mock("../ui/components/Avatar", () => ({ Avatar: () => null }));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("../features/interactions/hooks/usePlaceCall", () => ({ usePlaceCall: () => placeCallMock }));
vi.mock("../features/interactions/components/CallPromptHost", () => ({
  CallPromptHost: (props: Record<string, unknown>) => React.createElement("MockCallPromptHost", props),
}));

import { ContactDetailScreen } from "./ContactDetailScreen";

const CONTACT = {
  ok: true,
  status: 200,
  data: {
    data: {
      contact_name_id: "contact-1",
      full_name: "Jane Doe",
      client_id: "client-1",
      client_name: "Acme",
      email: "jane@acme.com",
      phone_numbers: [
        { contact_phone_number_id: "p1", phone_number: "+13202521658", canonical_type: "mobile", is_default: true },
        { contact_phone_number_id: "p2", phone_number: "+442079460958", canonical_type: "work" },
      ],
    },
  },
};

const withLocations = (locations: unknown[], workArrangement: string | null = "on_site") => ({
  ...CONTACT,
  data: { data: { ...CONTACT.data.data, locations, work_arrangement: workArrangement } },
});

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(ContactDetailScreen, {
        route: { params: { contactId: "contact-1", contactName: "Jane Doe" } } as never,
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

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((n) => (Array.isArray(n.props.children) ? n.props.children.join("") : String(n.props.children)));

describe("ContactDetailScreen calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContactMock.mockResolvedValue(CONTACT);
  });

  it("dials a phone number through the shared call flow, attributed to this contact and their client", async () => {
    const renderer = await renderScreen();
    expect(texts(renderer)).toEqual(expect.arrayContaining(["+1 320 252 1658", "+44 20 7946 0958"]));

    act(() => renderer.root.find((n) => n.props?.testID === "contact-detail-call-p2").props.onPress());

    expect(placeCallMock).toHaveBeenCalledWith({
      origin: { kind: "contact", id: "contact-1" },
      phone: "+442079460958",
      name: "Jane Doe",
      contactId: "contact-1",
      clientId: "client-1",
    });
  });

  it("T080: lists the contact's locations with the primary marked and hands the address to maps", async () => {
    const { Linking } = await import("react-native");
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    getContactMock.mockResolvedValue(withLocations([
      {
        location_id: "loc-1",
        location_name: "Warehouse",
        is_primary: true,
        address_line1: "9 Dock Rd",
        city: "Springfield",
        state_province: "IL",
        postal_code: "62701",
        country_name: "United States",
      },
      { location_id: "loc-2", location_name: "Head office", is_primary: false },
    ]));

    const renderer = await renderScreen();
    expect(texts(renderer)).toEqual(expect.arrayContaining(["Warehouse • detail.primaryLocation", "Head office"]));

    const links = renderer.root.findAll(
      (n) => n.props?.accessibilityLabel === "detail.openInMaps" && String(n.type) === "Pressable",
    );
    expect(links).toHaveLength(2);
    act(() => links[0].props.onPress());
    expect(openUrl.mock.calls[0][0]).toMatch(/^(maps|geo):0,0\?q=9%20Dock%20Rd%2C%20Springfield%2C%20IL%2C%2062701%2C%20United%20States$/);

    // No address lines: the name is the best query there is.
    act(() => links[1].props.onPress());
    expect(openUrl.mock.calls[1][0]).toMatch(/^(maps|geo):0,0\?q=Head%20office$/);
  });

  it("T081: marks a remote contact and shows no section when there is nothing to show", async () => {
    getContactMock.mockResolvedValue(withLocations([], "remote"));
    expect(texts(await renderScreen())).toEqual(expect.arrayContaining(["detail.remote"]));

    getContactMock.mockResolvedValue(withLocations([], null));
    expect(texts(await renderScreen())).not.toEqual(expect.arrayContaining(["detail.locations"]));
  });

  it("hosts the log-this-call prompt for calls placed from this contact", async () => {
    const renderer = await renderScreen();

    const host = renderer.root.find((n) => String(n.type) === "MockCallPromptHost");
    expect(host.props).toMatchObject({ origin: { kind: "contact", id: "contact-1" }, apiKey: "api-key", userId: "user-1" });
    expect(host.props.client).toBeTruthy();
  });
});
