import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listContactsMock = vi.fn();

const translate = (key: string, opts?: Record<string, unknown>) => {
  if (key === "contactPicker.currentContact") return `Current: ${opts?.name}`;
  if (key === "contactPicker.selectContact") return `Select ${opts?.name}`;
  return key;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock("../../../ui/ThemeContext", () => ({
  useTheme: () => ({
    colors: {
      background: "#fff",
      text: "#000",
      textSecondary: "#999",
      primary: "#00f",
      border: "#ccc",
      card: "#fafafa",
      danger: "#f00",
    },
    spacing: { sm: 4, md: 8, lg: 16, xl: 24 },
    typography: {
      title: { fontSize: 18 },
      body: { fontSize: 14 },
      caption: { fontSize: 12 },
    },
  }),
}));

vi.mock("../../../ui/components/Avatar", () => ({
  Avatar: (props: Record<string, unknown>) =>
    React.createElement("MockAvatar", props),
}));

vi.mock("../../../api/referenceData", () => ({
  listContacts: (...args: unknown[]) => listContactsMock(...args),
}));

import { ContactPickerModal } from "./ContactPickerModal";

async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

const fakeClient = { request: vi.fn() } as any;

function renderModal(overrides?: Partial<Parameters<typeof ContactPickerModal>[0]>): ReactTestRenderer {
  const defaultProps = {
    visible: true,
    updating: false,
    updateError: null,
    currentContactName: null as string | null,
    clientId: "client-1",
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
    client: fakeClient,
    apiKey: "api-key",
    baseUrl: "https://example.com",
    ...overrides,
  };

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(React.createElement(ContactPickerModal, defaultProps));
  });

  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

function getTextContent(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

const twoContacts = [
  { contact_name_id: "c-1", full_name: "Alice Smith", email: "alice@example.com", avatarUrl: "/avatars/alice.png" },
  { contact_name_id: "c-2", full_name: "Bob Jones", email: null, avatarUrl: null },
];

describe("ContactPickerModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    listContactsMock.mockResolvedValue({
      ok: true,
      data: { data: twoContacts },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches and renders contacts when visible", async () => {
    const renderer = renderModal();
    await flush();

    const texts = getTextContent(renderer);
    expect(texts).toContain("Alice Smith");
    expect(texts).toContain("alice@example.com");
    expect(texts).toContain("Bob Jones");
    expect(listContactsMock).toHaveBeenCalled();
  });

  it("shows loading state before contacts arrive", () => {
    listContactsMock.mockReturnValue(new Promise(() => {})); // never resolves
    const renderer = renderModal();

    const texts = getTextContent(renderer);
    expect(texts).toContain("common:loading");
  });

  it("shows error when fetch fails", async () => {
    listContactsMock.mockResolvedValue({ ok: false });
    const renderer = renderModal();
    await flush();

    const texts = getTextContent(renderer);
    expect(texts).toContain("contactPicker.unableToLoad");
  });

  it("shows no results message when list is empty", async () => {
    listContactsMock.mockResolvedValue({ ok: true, data: { data: [] } });
    const renderer = renderModal();
    await flush();

    const texts = getTextContent(renderer);
    expect(texts).toContain("contactPicker.noResults");
  });

  it("calls onSelect when a contact is pressed", async () => {
    const onSelect = vi.fn();
    const renderer = renderModal({ onSelect });
    await flush();

    const contactButtons = renderer.root.findAllByType(Pressable).filter(
      (p) => typeof p.props.accessibilityLabel === "string" && p.props.accessibilityLabel.startsWith("Select "),
    );
    expect(contactButtons.length).toBeGreaterThan(0);

    act(() => contactButtons[0].props.onPress());
    expect(onSelect).toHaveBeenCalledWith("c-1", "Alice Smith");
  });

  it("shows remove button when currentContactName is set", async () => {
    const onRemove = vi.fn();
    const renderer = renderModal({ currentContactName: "Alice Smith", onRemove });
    await flush();

    const texts = getTextContent(renderer);
    expect(texts).toContain("contactPicker.remove");
    expect(texts).toContain("Current: Alice Smith");

    const removeButton = renderer.root.findAllByType(Pressable).find(
      (p) => p.props.accessibilityLabel === "contactPicker.remove",
    );
    expect(removeButton).toBeDefined();

    act(() => removeButton!.props.onPress());
    expect(onRemove).toHaveBeenCalled();
  });

  it("does not show remove button when no current contact", async () => {
    const renderer = renderModal({ currentContactName: null });
    await flush();

    const texts = getTextContent(renderer);
    expect(texts).not.toContain("contactPicker.remove");
  });

  it("shows updateError when present", async () => {
    const renderer = renderModal({ updateError: "Something went wrong" });
    await flush();

    const texts = getTextContent(renderer);
    expect(texts).toContain("Something went wrong");
  });

  it("debounces search input", async () => {
    const renderer = renderModal();
    await flush();
    vi.clearAllMocks();
    listContactsMock.mockResolvedValue({ ok: true, data: { data: [] } });

    const searchInput = renderer.root.findByType(TextInput);
    act(() => searchInput.props.onChangeText("ali"));

    // Should not have fired yet (350ms debounce)
    expect(listContactsMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(350);
      await vi.runAllTimersAsync();
    });

    expect(listContactsMock).toHaveBeenCalledWith(fakeClient, expect.objectContaining({
      search: "ali",
    }));
  });

  it("deduplicates contacts by contact_name_id", async () => {
    listContactsMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          { contact_name_id: "c-1", full_name: "Alice Smith", email: "alice@example.com" },
          { contact_name_id: "c-1", full_name: "Alice Smith", email: "alice@example.com" },
          { contact_name_id: "c-2", full_name: "Bob Jones", email: null },
        ],
      },
    });
    const renderer = renderModal();
    await flush();

    const contactButtons = renderer.root.findAllByType(Pressable).filter(
      (p) => typeof p.props.accessibilityLabel === "string" && p.props.accessibilityLabel.startsWith("Select "),
    );
    expect(contactButtons).toHaveLength(2);
  });

  it("disables contact buttons when updating", async () => {
    const renderer = renderModal({ updating: true });
    await flush();

    const contactButtons = renderer.root.findAllByType(Pressable).filter(
      (p) => typeof p.props.accessibilityLabel === "string" && p.props.accessibilityLabel.startsWith("Select "),
    );
    for (const btn of contactButtons) {
      expect(btn.props.disabled).toBe(true);
    }
  });

  it("calls onClose when close button is pressed", async () => {
    const onClose = vi.fn();
    const renderer = renderModal({ onClose });
    await flush();

    const closeButton = renderer.root.findAllByType(Pressable).find(
      (p) => p.props.accessibilityLabel === "common:close",
    );
    expect(closeButton).toBeDefined();
    act(() => closeButton!.props.onPress());
    expect(onClose).toHaveBeenCalled();
  });

  it("constructs avatar URI with baseUrl", async () => {
    const renderer = renderModal();
    await flush();

    const avatars = renderer.root.findAllByType("MockAvatar" as any);
    const aliceAvatar = avatars.find((a) => a.props.name === "Alice Smith");
    expect(aliceAvatar?.props.imageUri).toBe("https://example.com/avatars/alice.png");

    const bobAvatar = avatars.find((a) => a.props.name === "Bob Jones");
    expect(bobAvatar?.props.imageUri).toBeUndefined();
  });

  it("does not fetch when client is null", async () => {
    renderModal({ client: null });
    await flush();

    expect(listContactsMock).not.toHaveBeenCalled();
  });
});
