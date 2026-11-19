import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

type PickerProps = {
  title: string;
  items: Array<{ id: string; label: string; subtitle?: string | null; imageUri?: string | null }>;
  loading: boolean;
  error: string | null;
  onSelect: (id: string, label: string) => void;
  onSearch?: (query: string) => void;
  onClose: () => void;
  onCreate?: () => void;
  createLabel?: string;
};
type FormModalProps = { visible: boolean; onSaved: (created: Record<string, string>) => void; onClose: () => void };

const mocks = vi.hoisted(() => ({
  listClients: vi.fn(),
  listBoards: vi.fn(),
  listContacts: vi.fn(),
  listClientLocations: vi.fn(),
  listUsers: vi.fn(),
  listAssets: vi.fn(),
  getTicketStatuses: vi.fn(),
  getTicketPriorities: vi.fn(),
  createTicket: vi.fn(),
  invalidateTicketsListCache: vi.fn(),
  replace: vi.fn(),
  picker: null as PickerProps | null,
  clientForm: null as FormModalProps | null,
  contactForm: null as FormModalProps | null,
  capabilities: {
    features: { assets: false, clientsCreate: false, contactsCreate: false } as Record<string, boolean>,
    operationalScope: null as null | { client: { clientId: string; clientName: string } | null; creatableBoardIds: string[] },
  },
  session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } } as Record<string, unknown> | null,
  // Stable identities, like production: the screen memoizes its API client on them.
  refreshSession: () => Promise.resolve(null),
  t: (key: string) => key,
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ session: mocks.session, refreshSession: mocks.refreshSession }),
}));
vi.mock("../capabilities/CapabilitiesContext", () => ({
  useCapabilities: () => ({ ...mocks.capabilities, loaded: true }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/assets", () => ({ listAssets: (...args: unknown[]) => mocks.listAssets(...args) }));
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
vi.mock("../device/clientMetadata", () => ({ getClientMetadataHeaders: () => Promise.resolve({ "x-device": "d" }) }));
vi.mock("../cache/ticketsCache", () => ({ invalidateTicketsListCache: () => mocks.invalidateTicketsListCache() }));
vi.mock("../ui/components/EntityPickerModal", () => ({
  EntityPickerModal: (props: PickerProps) => {
    mocks.picker = props;
    return null;
  },
}));
vi.mock("../features/clients/components/ClientFormModal", () => ({
  ClientFormModal: (props: FormModalProps) => {
    mocks.clientForm = props;
    return null;
  },
}));
vi.mock("../features/contacts/components/ContactFormModal", () => ({
  ContactFormModal: (props: FormModalProps) => {
    mocks.contactForm = props;
    return null;
  },
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { CreateTicketScreen } from "./CreateTicketScreen";

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });
const page = (items: unknown[]) => ok({ data: items, pagination: { page: 1, limit: 50, total: items.length } });
const fail = (kind: string) => ({ ok: false as const, error: { kind } });

const BOARDS = [
  { board_id: "b-1", board_name: "Support", is_default: true, priority_type: "custom" },
  { board_id: "b-2", board_name: "ITIL Desk", is_default: false, priority_type: "itil", default_assigned_to: "u-2" },
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

const host = (renderer: ReactTestRenderer, testID: string): ReactTestInstance | undefined =>
  renderer.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID)[0];

const submitButton = (renderer: ReactTestRenderer): ReactTestInstance =>
  renderer.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === "create.submit")[0];

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

async function openPicker(renderer: ReactTestRenderer, testID: string) {
  await act(async () => host(renderer, testID)!.props.onPress());
  await flush();
  return mocks.picker!;
}

async function pick(renderer: ReactTestRenderer, testID: string, id: string, label: string) {
  await openPicker(renderer, testID);
  await act(async () => mocks.picker!.onSelect(id, label));
  await flush();
}

async function fillRequired(renderer: ReactTestRenderer) {
  const titleInput = renderer.root.findAll((n) => n.props?.placeholder === "create.titlePlaceholder")[0];
  await act(async () => titleInput.props.onChangeText("  Printer jam  "));
  await pick(renderer, "create-ticket-client", "cl-1", "Acme");
  await pick(renderer, "create-ticket-priority", "pr-1", "High");
}

describe("CreateTicketScreen submit and pickers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.picker = null;
    mocks.clientForm = null;
    mocks.contactForm = null;
    mocks.session = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } };
    mocks.capabilities = { features: { assets: false, clientsCreate: false, contactsCreate: false }, operationalScope: null };
    mocks.listBoards.mockResolvedValue(ok({ data: BOARDS }));
    mocks.listClients.mockResolvedValue(page([{ client_id: "cl-1", client_name: "Acme", email: "a@acme.test", logoUrl: "/logo.png" }]));
    mocks.listContacts.mockResolvedValue(page([
      { contact_name_id: "ct-1", full_name: "Jane", email: "j@acme.test" },
      { contact_name_id: "ct-1", full_name: "Jane", email: "j@acme.test" },
      { contact_name_id: "ct-2", full_name: "Joe", email: null, avatarUrl: "/a.png" },
    ]));
    mocks.listClientLocations.mockResolvedValue(ok({ data: [
      { location_id: "loc-1", location_name: "HQ", address_line1: "1 Main", city: "Springfield", state_province: "IL" },
      { location_id: "loc-2", location_name: null, address_line1: null },
    ] }));
    mocks.listUsers.mockResolvedValue(page([
      { user_id: "u-2", first_name: "Dana", last_name: "Tech", email: "dana@msp.test", avatarUrl: "/d.png" },
    ]));
    mocks.getTicketStatuses.mockResolvedValue(ok({ data: [
      { status_id: "st-closed", name: "Closed", is_closed: true },
      { status_id: "st-new", name: "New", is_closed: false },
    ] }));
    mocks.getTicketPriorities.mockResolvedValue(ok({ data: [
      { priority_id: "pr-1", priority_name: "High", is_from_itil_standard: false },
      { priority_id: "pr-itil", priority_name: "P1", is_from_itil_standard: true },
    ] }));
    mocks.createTicket.mockResolvedValue(ok({ data: { ticket_id: "tk-9" } }));
  });

  it("selects the default board and its first open status on mount", async () => {
    const renderer = await renderScreen();
    const all = texts(renderer);
    expect(all).toContain("Support");
    expect(all).toContain("New");
    expect(mocks.getTicketStatuses).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key", board_id: "b-1" });
  });

  it("keeps Create disabled until title, client and priority are set", async () => {
    const renderer = await renderScreen();
    expect(submitButton(renderer).props.disabled).toBe(true);
    await fillRequired(renderer);
    expect(submitButton(renderer).props.disabled).toBe(false);
  });

  it("submits trimmed values with optional contact, location, assignee and description", async () => {
    const renderer = await renderScreen();
    await fillRequired(renderer);
    await pick(renderer, "create-ticket-contact", "ct-1", "Jane");
    await pick(renderer, "create-ticket-location", "loc-1", "HQ");
    await pick(renderer, "create-ticket-assignee", "u-2", "Dana Tech");
    const descInput = renderer.root.findAll((n) => n.props?.placeholder === "create.descriptionPlaceholder")[0];
    await act(async () => descInput.props.onChangeText("  paper stuck  "));

    await act(async () => submitButton(renderer).props.onPress());
    await flush();

    expect(mocks.createTicket).toHaveBeenCalledWith(expect.anything(), {
      apiKey: "api-key",
      title: "Printer jam",
      board_id: "b-1",
      client_id: "cl-1",
      status_id: "st-new",
      priority_id: "pr-1",
      contact_name_id: "ct-1",
      location_id: "loc-1",
      assigned_to: "u-2",
      attributes: { description: "paper stuck" },
      auditHeaders: { "x-device": "d" },
    });
    expect(mocks.invalidateTicketsListCache).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("TicketDetail", { ticketId: "tk-9" });
  });

  it("omits cleared optional fields", async () => {
    const renderer = await renderScreen();
    await fillRequired(renderer);
    await pick(renderer, "create-ticket-contact", "ct-1", "Jane");
    await pick(renderer, "create-ticket-assignee", "u-2", "Dana Tech");
    const clears = renderer.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityLabel === "Clear");
    expect(clears).toHaveLength(2);
    await act(async () => clears.forEach((c) => c.props.onPress()));

    await act(async () => submitButton(renderer).props.onPress());
    await flush();
    const body = mocks.createTicket.mock.calls[0][1];
    expect(body).not.toHaveProperty("contact_name_id");
    expect(body).not.toHaveProperty("assigned_to");
    expect(body).not.toHaveProperty("attributes");
  });

  it.each([
    ["permission", "create.errors.permission"],
    ["validation", "create.errors.validation"],
    ["http", "create.errors.generic"],
  ])("shows the %s error and stays on the screen", async (kind, message) => {
    mocks.createTicket.mockResolvedValue(fail(kind));
    const renderer = await renderScreen();
    await fillRequired(renderer);
    await act(async () => submitButton(renderer).props.onPress());
    await flush();
    expect(texts(renderer)).toContain(message);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.invalidateTicketsListCache).not.toHaveBeenCalled();
    expect(submitButton(renderer).props.disabled).toBe(false);
  });

  it("does nothing without a session", async () => {
    mocks.session = null;
    const renderer = await renderScreen();
    expect(mocks.listBoards).not.toHaveBeenCalled();
    await act(async () => submitButton(renderer).props.onPress());
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });

  it("maps picker items: dedupes contacts, labels locations, builds image URLs", async () => {
    const renderer = await renderScreen();
    const clientPicker = await openPicker(renderer, "create-ticket-client");
    expect(clientPicker.items[0]).toMatchObject({ id: "cl-1", label: "Acme", imageUri: "https://algapsa.com/logo.png" });
    await act(async () => clientPicker.onSelect("cl-1", "Acme"));
    await flush();

    const contactPicker = await openPicker(renderer, "create-ticket-contact");
    expect(contactPicker.items.map((i) => i.id)).toEqual(["ct-1", "ct-2"]);
    expect(contactPicker.items[1].imageUri).toBe("https://algapsa.com/a.png");
    await act(async () => contactPicker.onClose());

    const locationPicker = await openPicker(renderer, "create-ticket-location");
    expect(locationPicker.items).toEqual([
      { id: "loc-1", label: "HQ", subtitle: "1 Main, Springfield, IL" },
      { id: "loc-2", label: "Unnamed location", subtitle: null },
    ]);
    await act(async () => locationPicker.onClose());

    const boardPicker = await openPicker(renderer, "create-ticket-board");
    expect(boardPicker.items.map((i) => i.subtitle)).toEqual(["create.defaultBoard", null]);
    await act(async () => boardPicker.onClose());

    const statusPicker = await openPicker(renderer, "create-ticket-status");
    expect(statusPicker.items.map((i) => i.subtitle)).toEqual(["statusPicker.closedLabel", "statusPicker.openLabel"]);
  });

  it("offers only priorities that fit the selected board", async () => {
    const renderer = await renderScreen();
    const picker = await openPicker(renderer, "create-ticket-priority");
    expect(picker.items.map((i) => i.id)).toEqual(["pr-1"]);
  });

  it("switching to an ITIL board drops a custom priority and fills the board's default assignee", async () => {
    const renderer = await renderScreen();
    await pick(renderer, "create-ticket-priority", "pr-1", "High");
    expect(texts(renderer)).toContain("High");

    await pick(renderer, "create-ticket-board", "b-2", "ITIL Desk");
    const all = texts(renderer);
    expect(all).not.toContain("High");
    expect(all).toContain("create.selectPriority");
    expect(all).toContain("Dana Tech");
    expect(mocks.getTicketStatuses).toHaveBeenLastCalledWith(expect.anything(), { apiKey: "api-key", board_id: "b-2" });
  });

  it("passes the search query through to searchable pickers", async () => {
    const renderer = await renderScreen();
    const clientPicker = await openPicker(renderer, "create-ticket-client");
    await act(async () => clientPicker.onSearch!("acm"));
    expect(mocks.listClients).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ search: "acm", limit: 50 }));
    await act(async () => clientPicker.onSelect("cl-1", "Acme"));
    await flush();

    const contactPicker = await openPicker(renderer, "create-ticket-contact");
    await act(async () => contactPicker.onSearch!("ja"));
    expect(mocks.listContacts).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ clientId: "cl-1", search: "ja" }));
    await act(async () => contactPicker.onClose());

    const userPicker = await openPicker(renderer, "create-ticket-assignee");
    await act(async () => userPicker.onSearch!("da"));
    expect(mocks.listUsers).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ search: "da" }));
  });

  it.each([
    ["create-ticket-board", "listBoards", "create.errors.loadBoards"],
    ["create-ticket-client", "listClients", "create.errors.loadClients"],
    ["create-ticket-priority", "getTicketPriorities", "create.errors.loadPriorities"],
    ["create-ticket-assignee", "listUsers", "create.errors.loadAgents"],
  ] as const)("%s shows a load error when the API fails or throws", async (testID, fn, message) => {
    const renderer = await renderScreen();
    mocks[fn].mockResolvedValueOnce(fail("http"));
    let picker = await openPicker(renderer, testID);
    expect(picker.error).toBe(message);
    expect(picker.loading).toBe(false);
    await act(async () => picker.onClose());

    mocks[fn].mockRejectedValueOnce(new Error("down"));
    picker = await openPicker(renderer, testID);
    expect(picker.error).toBe(message);
  });

  it.each([
    ["create-ticket-contact", "listContacts", "create.errors.loadContacts"],
    ["create-ticket-location", "listClientLocations", "create.errors.loadLocations"],
    ["create-ticket-status", "getTicketStatuses", "create.errors.loadStatuses"],
  ] as const)("%s shows a load error when the API fails or throws", async (testID, fn, message) => {
    const renderer = await renderScreen({ clientId: "cl-1", clientName: "Acme" });
    mocks[fn].mockResolvedValueOnce(fail("http"));
    let picker = await openPicker(renderer, testID);
    expect(picker.error).toBe(message);
    await act(async () => picker.onClose());

    mocks[fn].mockRejectedValueOnce(new Error("down"));
    picker = await openPicker(renderer, testID);
    expect(picker.error).toBe(message);
  });

  it("shows the assets load error when the capability is on", async () => {
    mocks.capabilities.features = { assets: true, clientsCreate: false, contactsCreate: false };
    mocks.listAssets.mockResolvedValueOnce(fail("http"));
    const renderer = await renderScreen({ clientId: "cl-1", clientName: "Acme" });
    const picker = await openPicker(renderer, "create-ticket-assets");
    expect(picker.error).toBe("create.errors.loadAssets");
  });

  it("creates a client inline from the client picker", async () => {
    mocks.capabilities.features = { assets: false, clientsCreate: true, contactsCreate: true };
    const renderer = await renderScreen();
    const picker = await openPicker(renderer, "create-ticket-client");
    expect(picker.createLabel).toBe("create.newClient");
    await act(async () => picker.onCreate!());
    expect(mocks.clientForm!.visible).toBe(true);
    await act(async () => mocks.clientForm!.onSaved({ client_id: "cl-new", client_name: "NewCo" }));
    await act(async () => mocks.clientForm!.onClose());
    expect(mocks.clientForm!.visible).toBe(false);
    expect(texts(renderer)).toContain("NewCo");

    const contactPicker = await openPicker(renderer, "create-ticket-contact");
    expect(contactPicker.createLabel).toBe("create.newContact");
    await act(async () => contactPicker.onCreate!());
    expect(mocks.contactForm!.visible).toBe(true);
    await act(async () => mocks.contactForm!.onSaved({ contact_name_id: "ct-new", full_name: "Pat New" }));
    expect(texts(renderer)).toContain("Pat New");
  });

  describe("co-managed (operational-only) seat", () => {
    beforeEach(() => {
      mocks.capabilities = {
        features: { assets: false, clientsCreate: false, contactsCreate: false, operationalOnly: true },
        operationalScope: { client: { clientId: "cl-own", clientName: "Own Client" }, creatableBoardIds: ["b-2"] },
      };
    });

    it("presets the seat's client, picks the only allowed board, and hides location and assignee", async () => {
      const renderer = await renderScreen();
      const all = texts(renderer);
      expect(all).toContain("Own Client");
      expect(all).toContain("ITIL Desk");
      expect(host(renderer, "create-ticket-location")).toBeUndefined();
      expect(host(renderer, "create-ticket-assignee")).toBeUndefined();
      // The board's default assignee is not applied for a co-managed seat.
      expect(mocks.listUsers).not.toHaveBeenCalled();

      const boardPicker = await openPicker(renderer, "create-ticket-board");
      expect(boardPicker.items.map((i) => i.id)).toEqual(["b-2"]);
      await act(async () => boardPicker.onClose());

      const clientPicker = await openPicker(renderer, "create-ticket-client");
      expect(mocks.listClients).not.toHaveBeenCalled();
      expect(clientPicker.items).toEqual([{ id: "cl-own", label: "Own Client" }]);
    });
  });
});
