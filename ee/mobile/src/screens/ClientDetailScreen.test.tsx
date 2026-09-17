import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const { getClientMock, getClientContactsMock, getClientLocationsMock, placeCallMock, translate, authValue } = vi.hoisted(() => ({
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

describe("ClientDetailScreen calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientMock.mockResolvedValue({ ok: true, data: { data: { client_id: "client-1", client_name: "Acme", phone_no: " +15550200 ", email: null, url: null } } });
    getClientLocationsMock.mockResolvedValue({ ok: true, data: { data: [] } });
    getClientContactsMock.mockResolvedValue({ ok: true, data: { data: [], pagination: { total: 0 } } });
  });

  it("dials the client's number through the shared call flow, attributed to the client", async () => {
    const renderer = await renderScreen();

    const row = renderer.root.find((n) => n.props?.accessibilityLabel === "detail.phone:  +15550200 ");
    act(() => row.props.onPress());

    expect(placeCallMock).toHaveBeenCalledWith({
      origin: { kind: "client", id: "client-1" },
      phone: "+15550200",
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
