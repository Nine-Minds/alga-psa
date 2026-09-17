import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const { getContactMock, placeCallMock, translate, authValue } = vi.hoisted(() => ({
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
        { contact_phone_number_id: "p1", phone_number: "+15550100", canonical_type: "mobile", is_default: true },
        { contact_phone_number_id: "p2", phone_number: "+15550101", canonical_type: "work" },
      ],
    },
  },
};

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(ContactDetailScreen, {
        route: { params: { contactId: "contact-1", contactName: "Jane Doe" } } as never,
        navigation: { navigate: vi.fn(), setParams: vi.fn(), dispatch: vi.fn() } as never,
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
    expect(texts(renderer)).toEqual(expect.arrayContaining(["+15550100", "+15550101"]));

    act(() => renderer.root.find((n) => n.props?.testID === "contact-detail-call-p2").props.onPress());

    expect(placeCallMock).toHaveBeenCalledWith({
      origin: { kind: "contact", id: "contact-1" },
      phone: "+15550101",
      name: "Jane Doe",
      contactId: "contact-1",
      clientId: "client-1",
    });
  });

  it("hosts the log-this-call prompt for calls placed from this contact", async () => {
    const renderer = await renderScreen();

    const host = renderer.root.find((n) => String(n.type) === "MockCallPromptHost");
    expect(host.props).toMatchObject({ origin: { kind: "contact", id: "contact-1" }, apiKey: "api-key", userId: "user-1" });
    expect(host.props.client).toBeTruthy();
  });
});
