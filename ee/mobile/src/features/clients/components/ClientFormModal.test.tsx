import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  updateClient: vi.fn(),
  createClientLocation: vi.fn(),
  updateClientLocation: vi.fn(),
  listContacts: vi.fn(),
  listCountries: vi.fn(),
  getEntityTags: vi.fn(),
  showToast: vi.fn(),
  alert: vi.fn(),
}));

vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Alert: { alert: mocks.alert },
}));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../../capabilities/CapabilitiesContext", () => ({ useCapabilities: () => ({ defaultCountry: "US", features: {}, loaded: true }) }));
vi.mock("../../../device/clientMetadata", () => ({ getClientMetadataHeaders: async () => ({ "x-device": "test" }) }));
vi.mock("../../../logging/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../../api/clients", () => ({
  createClient: (...args: unknown[]) => mocks.createClient(...args),
  updateClient: (...args: unknown[]) => mocks.updateClient(...args),
  createClientLocation: (...args: unknown[]) => mocks.createClientLocation(...args),
  updateClientLocation: (...args: unknown[]) => mocks.updateClientLocation(...args),
}));
vi.mock("../../../api/contacts", () => ({ listContacts: (...args: unknown[]) => mocks.listContacts(...args) }));
vi.mock("../../../api/countries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/countries")>()),
  listCountries: (...args: unknown[]) => mocks.listCountries(...args),
}));
vi.mock("../../../api/tags", () => ({ getEntityTags: (...args: unknown[]) => mocks.getEntityTags(...args) }));
vi.mock("../../../ui/components/EntityPickerModal", () => ({ EntityPickerModal: () => null }));
vi.mock("../../../ui/components/Select", () => ({ Select: () => null }));
vi.mock("../../../ui/components/TagsField", () => ({ TagsField: (props: Record<string, unknown>) => React.createElement("MockTagsField", props) }));
vi.mock("./AccountManagerPickerModal", () => ({ AccountManagerPickerModal: () => null }));

import { ClientFormModal } from "./ClientFormModal";

const US = { code: "US", name: "United States", phone_code: "+1" };
const detail = { client_id: "client-1", client_name: "Acme", client_type: "company", url: "acme.com", is_inactive: false, tags: ["vip"] } as const;
const location = { location_id: "loc-1", location_name: null, address_line1: "1 Main St", city: "Springfield", country_code: "US", country_name: "United States", phone: "+13202521658", email: "ops@acme.test", is_default: true };

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(props: Partial<React.ComponentProps<typeof ClientFormModal>> = {}): Promise<{ renderer: ReactTestRenderer; onSaved: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> }> {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(ClientFormModal, {
        visible: true,
        mode: "create",
        client: { request: vi.fn() } as never,
        apiKey: "key",
        baseUrl: "https://algapsa.test",
        onSaved,
        onClose,
        ...props,
      }),
    );
  });
  await flush();
  return { renderer, onSaved, onClose };
}

function type(renderer: ReactTestRenderer, testID: string, text: string) {
  act(() => renderer.root.find((n) => n.props?.testID === testID && typeof n.props.onChangeText === "function").props.onChangeText(text));
}

async function submit(renderer: ReactTestRenderer) {
  await act(async () => renderer.root.find((n) => n.props?.testID === "client-form-submit").props.onPress());
  await flush();
}

function errorText(renderer: ReactTestRenderer): string | null {
  const node = renderer.root.findAll((n) => n.props?.testID === "client-form-error")[0];
  if (!node) return null;
  const text = node.findAllByType(Text)[0] ?? node;
  const value = text.props.children;
  return Array.isArray(value) ? value.join("") : String(value);
}

describe("ClientFormModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCountries.mockResolvedValue({ ok: true, data: { data: [US] } });
    mocks.listContacts.mockResolvedValue({ ok: true, data: { data: [], pagination: { total: 0 } } });
    mocks.getEntityTags.mockResolvedValue({ ok: true, data: { data: { tags: [] } } });
    mocks.createClient.mockResolvedValue({ ok: true, data: { data: { client_id: "client-9", client_name: "New Co" } } });
    mocks.updateClient.mockResolvedValue({ ok: true, data: { data: { ...detail, client_name: "Acme Corp" } } });
    mocks.createClientLocation.mockResolvedValue({ ok: true, data: { data: { location_id: "loc-9" } } });
    mocks.updateClientLocation.mockResolvedValue({ ok: true, data: { data: location } });
  });

  it("blocks submit on validation errors and shows the shared wording", async () => {
    const { renderer } = await render();
    type(renderer, "client-form-email", "nope");
    await submit(renderer);
    expect(mocks.createClient).not.toHaveBeenCalled();
    const emailField = renderer.root.find((n) => n.props?.testID === "client-form-email" && typeof n.props.onChangeText === "function");
    expect(emailField.props.error).toBe("Please enter a valid email address");
  });

  it("creates the client, then its default location, and reports both", async () => {
    const { renderer, onSaved, onClose } = await render();
    type(renderer, "client-form-clientName", "New Co");
    type(renderer, "client-form-phone", "3202521658");
    type(renderer, "client-form-addressLine1", "9 Dock Rd");
    await submit(renderer);

    expect(mocks.createClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({ client_name: "New Co", client_type: "company" }),
    }));
    expect(mocks.createClientLocation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clientId: "client-9",
      data: expect.objectContaining({ phone: "+13202521658", address_line1: "9 Dock Rd", country_code: "US", is_default: true }),
    }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ client_id: "client-9" }));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({ message: "Client created", tone: "success" });
  });

  it("keeps the created client when only the location write fails", async () => {
    mocks.createClientLocation.mockResolvedValue({ ok: false, error: { kind: "server", message: "boom", status: 500 } });
    const { renderer, onSaved } = await render();
    type(renderer, "client-form-clientName", "New Co");
    type(renderer, "client-form-phone", "3202521658");
    await submit(renderer);
    expect(mocks.showToast).toHaveBeenCalledWith({ message: "Client saved, but its phone, email or address could not be saved.", tone: "error" });
    expect(onSaved).toHaveBeenCalled();
  });

  it("surfaces a duplicate-name conflict from the server", async () => {
    mocks.createClient.mockResolvedValue({ ok: false, status: 409, error: { kind: "http", status: 409, message: "Conflict", body: { error: { message: 'A client with the name "Acme" already exists. Please choose a different name.' } } } });
    const { renderer, onSaved } = await render();
    type(renderer, "client-form-clientName", "Acme");
    await submit(renderer);
    expect(errorText(renderer)).toBe('A client with the name "Acme" already exists. Please choose a different name.');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("in edit mode writes only changed fields and updates the existing location", async () => {
    const { renderer } = await render({ mode: "edit", initial: { detail: detail as never, locations: [location] } });
    type(renderer, "client-form-clientName", "Acme Corp");
    type(renderer, "client-form-email", "");
    await submit(renderer);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.updateClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientId: "client-1", data: { client_name: "Acme Corp" } }));
    // Clearing the email sends null so the server drops it.
    expect(mocks.updateClientLocation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationId: "loc-1",
      data: expect.objectContaining({ email: null, phone: "+13202521658" }),
    }));
  });

  it("skips the client write when nothing changed", async () => {
    const { renderer, onSaved } = await render({ mode: "edit", initial: { detail: detail as never, locations: [location] } });
    await submit(renderer);
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it("asks about active contacts before deactivating and honours 'client only'", async () => {
    mocks.listContacts.mockResolvedValue({ ok: true, data: { data: [{}], pagination: { total: 3 } } });
    mocks.alert.mockImplementation((_title: string, _message: string, buttons: { text: string; onPress?: () => void }[]) => {
      buttons.find((button) => button.text === "Client only")?.onPress?.();
    });
    const { renderer } = await render({ mode: "edit", initial: { detail: detail as never, locations: [location] } });
    act(() => renderer.root.find((n) => n.props?.testID === "client-form-inactive").props.onValueChange(true));
    await submit(renderer);

    expect(mocks.alert).toHaveBeenCalledWith("Deactivate client", expect.stringContaining("3 active contact(s)"), expect.any(Array), expect.anything());
    expect(mocks.updateClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { is_inactive: true, deactivate_contacts: false } }));
  });

  it("does not write when the deactivation prompt is cancelled", async () => {
    mocks.listContacts.mockResolvedValue({ ok: true, data: { data: [{}], pagination: { total: 1 } } });
    mocks.alert.mockImplementation((_title: string, _message: string, buttons: { text: string; style?: string; onPress?: () => void }[]) => {
      buttons.find((button) => button.style === "cancel")?.onPress?.();
    });
    const { renderer, onSaved } = await render({ mode: "edit", initial: { detail: detail as never, locations: [location] } });
    act(() => renderer.root.find((n) => n.props?.testID === "client-form-inactive").props.onValueChange(true));
    await submit(renderer);
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("deactivates straight away when the client has no active contacts", async () => {
    const { renderer } = await render({ mode: "edit", initial: { detail: detail as never, locations: [location] } });
    act(() => renderer.root.find((n) => n.props?.testID === "client-form-inactive").props.onValueChange(true));
    await submit(renderer);
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.updateClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { is_inactive: true, deactivate_contacts: false } }));
  });
});
