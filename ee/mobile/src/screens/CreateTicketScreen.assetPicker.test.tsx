import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

/**
 * The device picker on ticket create (alga-2026-0002785, customer ask via
 * ticket 2592): disabled until a client is chosen, scoped to that client,
 * multi-select, cleared when the client changes, and sent as `asset_ids`.
 */
const mocks = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listClients: vi.fn(),
  listBoards: vi.fn(),
  listContacts: vi.fn(),
  listClientLocations: vi.fn(),
  listUsers: vi.fn(),
  getTicketStatuses: vi.fn(),
  getTicketPriorities: vi.fn(),
  createTicket: vi.fn(),
  replace: vi.fn(),
  features: { assets: true, clientsCreate: false, contactsCreate: false } as Record<string, boolean>,
  authValue: {
    session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } },
    refreshSession: () => Promise.resolve(null),
  },
}));

// Resolve against the real en bundle, so the assertions below also prove the
// strings exist in the tickets namespace rather than passing on fallbacks.
vi.mock("react-i18next", async () => {
  const bundle = (await import("../i18n/locales/en/tickets.json")).default as Record<string, unknown>;
  const lookup = (key: string): string | undefined =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], bundle) as
      | string
      | undefined;
  return { useTranslation: () => ({ t: (key: string, fallback?: string) => lookup(key) ?? fallback ?? key }) };
});
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
vi.mock("../api/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/assets")>()),
  listAssets: (...args: unknown[]) => mocks.listAssets(...args),
}));
vi.mock("../api/tickets", () => ({
  createTicket: (...args: unknown[]) => mocks.createTicket(...args),
  getTicketStatuses: (...args: unknown[]) => mocks.getTicketStatuses(...args),
  getTicketPriorities: (...args: unknown[]) => mocks.getTicketPriorities(...args),
}));
vi.mock("../api/referenceData", () => ({
  listBoards: (...args: unknown[]) => mocks.listBoards(...args),
  listClients: (...args: unknown[]) => mocks.listClients(...args),
  listContacts: (...args: unknown[]) => mocks.listContacts(...args),
  listClientLocations: (...args: unknown[]) => mocks.listClientLocations(...args),
}));
vi.mock("../api/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/users")>()),
  listUsers: (...args: unknown[]) => mocks.listUsers(...args),
}));
vi.mock("../device/clientMetadata", () => ({ getClientMetadataHeaders: () => Promise.resolve({}) }));
vi.mock("../cache/ticketsCache", () => ({ invalidateTicketsListCache: vi.fn() }));
vi.mock("../features/clients/components/ClientFormModal", () => ({ ClientFormModal: () => null }));
vi.mock("../features/contacts/components/ContactFormModal", () => ({ ContactFormModal: () => null }));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { CreateTicketScreen } from "./CreateTicketScreen";

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });
const page = (items: unknown[]) => ok({ data: items, pagination: { page: 1, limit: 50, total: items.length } });

const ASSETS = [
  { asset_id: "a-1", asset_tag: "T-1", name: "Reception PC", status: "active", client_id: "cl-1", location: "HQ" },
  { asset_id: "a-2", asset_tag: "T-2", name: "Back-office NAS", status: "active", client_id: "cl-1", location: "HQ" },
];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(params?: Record<string, unknown>): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <CreateTicketScreen
        route={{ key: "r", name: "CreateTicket", params } as never}
        navigation={{ replace: mocks.replace, navigate: vi.fn(), setOptions: vi.fn() } as never}
      />,
    );
  });
  await flush();
  return renderer;
}

const host = (renderer: ReactTestRenderer, testID: string): ReactTestInstance =>
  renderer.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID)[0];

const pickerRow = (renderer: ReactTestRenderer, label: string): ReactTestInstance =>
  renderer.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === label)[0];

const byPlaceholder = (renderer: ReactTestRenderer, placeholder: string): ReactTestInstance =>
  renderer.root.findAll((node) => node.props?.placeholder === placeholder)[0];

function texts(renderer: ReactTestRenderer): string {
  const out: string[] = [];
  for (const node of renderer.root.findAll((n) => typeof n.type === "string")) {
    const children = node.props.children;
    const push = (value: unknown) => {
      if (typeof value === "string") out.push(value);
    };
    if (Array.isArray(children)) children.forEach(push);
    else push(children);
  }
  return out.join(" | ");
}

describe("CreateTicketScreen assets picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.features = { assets: true, clientsCreate: false, contactsCreate: false };
    mocks.listBoards.mockResolvedValue(ok({ data: [{ board_id: "b-1", board_name: "Support", is_default: true }] }));
    mocks.listClients.mockResolvedValue(page([
      { client_id: "cl-1", client_name: "Acme" },
      { client_id: "cl-2", client_name: "Globex" },
    ]));
    mocks.listContacts.mockResolvedValue(page([]));
    mocks.listClientLocations.mockResolvedValue(ok({ data: [] }));
    mocks.listUsers.mockResolvedValue(page([]));
    mocks.getTicketStatuses.mockResolvedValue(ok({ data: [{ status_id: "st-1", name: "New", is_closed: false }] }));
    mocks.getTicketPriorities.mockResolvedValue(ok({ data: [{ priority_id: "pr-1", priority_name: "High" }] }));
    mocks.listAssets.mockResolvedValue(page(ASSETS));
    mocks.createTicket.mockResolvedValue(ok({ data: { ticket_id: "tk-1" } }));
  });

  it("stays disabled until a client is chosen", async () => {
    const renderer = await renderScreen();

    const field = host(renderer, "create-ticket-assets");
    expect(field.props.disabled).toBe(true);
    expect(texts(renderer)).toContain("Select a client first");

    act(() => field.props.onPress());
    await flush();
    expect(mocks.listAssets).not.toHaveBeenCalled();
  });

  it("lists only the chosen client's assets and multi-selects them", async () => {
    const renderer = await renderScreen();

    act(() => host(renderer, "create-ticket-client").props.onPress());
    await flush();
    act(() => pickerRow(renderer, "Acme").props.onPress());
    await flush();

    const field = host(renderer, "create-ticket-assets");
    expect(field.props.disabled).toBe(false);
    act(() => field.props.onPress());
    await flush();

    expect(mocks.listAssets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ client_id: "cl-1" }),
    );

    // Two taps keep both devices; the sheet stays open between them.
    act(() => pickerRow(renderer, "Reception PC").props.onPress());
    act(() => pickerRow(renderer, "Back-office NAS").props.onPress());
    await flush();
    expect(texts(renderer)).toContain("Reception PC, Back-office NAS");

    // A third tap on a picked device unticks it.
    act(() => pickerRow(renderer, "Reception PC").props.onPress());
    await flush();
    expect(texts(renderer)).toContain("Back-office NAS");
    expect(texts(renderer)).not.toContain("Reception PC, Back-office NAS");
  });

  it("clears the picked devices when the client changes", async () => {
    const renderer = await renderScreen({ clientId: "cl-1", clientName: "Acme", assets: [{ asset_id: "a-1", name: "Reception PC" }] });

    // The preset survives the first render — it belongs to the preset client.
    expect(texts(renderer)).toContain("Reception PC");

    act(() => host(renderer, "create-ticket-client").props.onPress());
    await flush();
    act(() => pickerRow(renderer, "Globex").props.onPress());
    await flush();

    expect(texts(renderer)).not.toContain("Reception PC");
    expect(texts(renderer)).toContain("Select assets");  // the empty-but-enabled label
  });

  it("sends the picked devices as asset_ids on save", async () => {
    const renderer = await renderScreen({ clientId: "cl-1", clientName: "Acme", assets: [{ asset_id: "a-1", name: "Reception PC" }] });

    act(() => byPlaceholder(renderer, "Enter ticket title").props.onChangeText("Reception PC won't boot"));
    act(() => host(renderer, "create-ticket-priority").props.onPress());
    await flush();
    act(() => pickerRow(renderer, "High").props.onPress());
    await flush();
    act(() => host(renderer, "create-ticket-assets").props.onPress());
    await flush();
    act(() => pickerRow(renderer, "Back-office NAS").props.onPress());
    await flush();

    await act(async () => pickerRow(renderer, "Create Ticket").props.onPress());
    await flush();

    expect(mocks.createTicket).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        client_id: "cl-1",
        asset_ids: ["a-1", "a-2"],
      }),
    );
    expect(mocks.replace).toHaveBeenCalledWith("TicketDetail", { ticketId: "tk-1" });
  });

  it("hides the field entirely when the assets capability is off", async () => {
    mocks.features = { assets: false, clientsCreate: false, contactsCreate: false };
    const renderer = await renderScreen();
    expect(host(renderer, "create-ticket-assets")).toBeUndefined();
  });
});
