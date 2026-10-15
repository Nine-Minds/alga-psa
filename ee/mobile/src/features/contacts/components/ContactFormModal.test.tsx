import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  createContact: vi.fn(),
  updateContact: vi.fn(),
  uploadContactAvatar: vi.fn(),
  deleteContactAvatar: vi.fn(),
  listClients: vi.fn(),
  getEntityTags: vi.fn(),
  showToast: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
}));

vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mocks.launchImageLibraryAsync(...args),
  launchCameraAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mocks.requestMediaLibraryPermissionsAsync(...args),
  requestCameraPermissionsAsync: vi.fn(),
}));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../../capabilities/CapabilitiesContext", () => ({ useCapabilities: () => ({ defaultCountry: "US", features: {}, loaded: true }) }));
vi.mock("../../../device/clientMetadata", () => ({ getClientMetadataHeaders: async () => ({}) }));
vi.mock("../../../logging/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../../api/clients", () => ({ listClients: (...args: unknown[]) => mocks.listClients(...args) }));
vi.mock("../../../api/contacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/contacts")>()),
  createContact: (...args: unknown[]) => mocks.createContact(...args),
  updateContact: (...args: unknown[]) => mocks.updateContact(...args),
  uploadContactAvatar: (...args: unknown[]) => mocks.uploadContactAvatar(...args),
  deleteContactAvatar: (...args: unknown[]) => mocks.deleteContactAvatar(...args),
}));
vi.mock("../../../api/tags", () => ({ getEntityTags: (...args: unknown[]) => mocks.getEntityTags(...args) }));
vi.mock("../../../ui/components/EntityPickerModal", () => ({ EntityPickerModal: () => null }));
vi.mock("../../../ui/components/Select", () => ({ Select: (props: Record<string, unknown>) => React.createElement("MockSelect", props) }));
vi.mock("../../../ui/components/Avatar", () => ({ Avatar: (props: Record<string, unknown>) => React.createElement("MockAvatar", props) }));
vi.mock("../../../ui/components/TagsField", () => ({ TagsField: (props: Record<string, unknown>) => React.createElement("MockTagsField", props) }));

import { ContactFormModal } from "./ContactFormModal";

const detail = {
  contact_name_id: "contact-1",
  full_name: "Jane Doe",
  email: "jane@acme.test",
  primary_email_canonical_type: "work",
  client_id: "client-1",
  client_name: "Acme",
  role: "CTO",
  is_inactive: false,
  avatarUrl: null,
  tags: [],
  phone_numbers: [{ contact_phone_number_id: "p1", phone_number: "+13202521658", canonical_type: null, custom_type: "Pager", is_default: true }],
  additional_email_addresses: [],
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(props: Partial<React.ComponentProps<typeof ContactFormModal>> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(ContactFormModal, {
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
  await act(async () => renderer.root.find((n) => n.props?.testID === "contact-form-submit").props.onPress());
  await flush();
}

describe("ContactFormModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEntityTags.mockResolvedValue({ ok: true, data: { data: { tags: [] } } });
    mocks.createContact.mockResolvedValue({ ok: true, data: { data: { contact_name_id: "contact-9", full_name: "Sam Lee" } } });
    mocks.updateContact.mockResolvedValue({ ok: true, data: { data: { ...detail, role: "CEO" } } });
  });

  it("requires name and email with the shared wording before creating", async () => {
    const { renderer } = await render({ presetClient: { id: "client-1", name: "Acme" }, lockClient: true });
    await submit(renderer);
    expect(mocks.createContact).not.toHaveBeenCalled();
    expect(renderer.root.find((n) => n.props?.testID === "contact-form-email" && typeof n.props.onChangeText === "function").props.error).toBe("Email address is required");
  });

  it("creates the contact against the preset client with a normalized phone", async () => {
    const { renderer, onSaved, onClose } = await render({ presetClient: { id: "client-1", name: "Acme" }, lockClient: true });
    type(renderer, "contact-form-fullName", "Sam Lee");
    type(renderer, "contact-form-email", "Sam@Acme.test");
    type(renderer, "contact-form-phone-0", "3202521658");
    await submit(renderer);

    expect(mocks.createContact).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        full_name: "Sam Lee",
        email: "sam@acme.test",
        client_id: "client-1",
        phone_numbers: [expect.objectContaining({ phone_number: "+13202521658", canonical_type: "mobile", is_default: true })],
      }),
    }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ contact_name_id: "contact-9" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("validates a field when the user leaves it, before any save", async () => {
    const { renderer } = await render();
    type(renderer, "contact-form-email", "nope");
    const field = () => renderer.root.find((n) => n.props?.testID === "contact-form-email" && typeof n.props.onChangeText === "function");
    expect(field().props.error).toBeUndefined();
    act(() => field().props.onBlur());
    expect(field().props.error).toBe("Please enter a valid email address");
  });

  it("closes without writing when an edited contact is unchanged, keeping its custom phone label", async () => {
    const { renderer, onSaved, onClose } = await render({ mode: "edit", initial: detail as never });
    await submit(renderer);
    expect(mocks.updateContact).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("sends only the changed fields on edit", async () => {
    const { renderer } = await render({ mode: "edit", initial: detail as never });
    type(renderer, "contact-form-role", "CEO");
    await submit(renderer);
    expect(mocks.updateContact).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contactId: "contact-1", data: { role: "CEO" } }));
  });

  it("uploads a picked photo immediately in edit mode", async () => {
    mocks.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    mocks.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///me.jpg", fileName: "me.jpg", mimeType: "image/jpeg" }] });
    mocks.uploadContactAvatar.mockResolvedValue({ ok: true, data: { data: { success: true, message: "ok", avatarUrl: "/api/avatar/1" } } });
    const { renderer } = await render({ mode: "edit", initial: detail as never });

    act(() => renderer.root.find((n) => n.props?.testID === "contact-form-change-photo").props.onPress());
    const menu = renderer.root.findAll((n) => n.type === ("MockSelect" as never)).find((n) => n.props.visible === true);
    expect(menu).toBeTruthy();
    await act(async () => menu!.props.onSelect("library"));
    await flush();

    expect(mocks.uploadContactAvatar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      contactId: "contact-1",
      file: { uri: "file:///me.jpg", name: "me.jpg", mimeType: "image/jpeg" },
    }));
    expect(renderer.root.find((n) => n.type === ("MockAvatar" as never)).props.imageUri).toBe("https://algapsa.test/api/avatar/1");
    expect(mocks.showToast).toHaveBeenCalledWith({ message: "Photo updated", tone: "success" });
  });

  it("shows the server message for a rejected write", async () => {
    mocks.createContact.mockResolvedValue({ ok: false, status: 400, error: { kind: "validation", status: 400, message: "bad", body: { error: { message: "A contact with email sam@acme.test already exists" } } } });
    const { renderer } = await render();
    type(renderer, "contact-form-fullName", "Sam Lee");
    type(renderer, "contact-form-email", "sam@acme.test");
    await submit(renderer);
    const error = renderer.root.find((n) => n.props?.testID === "contact-form-error");
    const text = (error.findAllByType(Text)[0] ?? error).props.children;
    expect(Array.isArray(text) ? text.join("") : text).toBe("A contact with email sam@acme.test already exists");
  });
});
