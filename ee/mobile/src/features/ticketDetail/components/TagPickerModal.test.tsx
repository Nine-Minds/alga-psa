import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TagSuggestion } from "../../../api/tags";

const searchTagSuggestionsMock = vi.fn();

const translate = (key: string, opts?: Record<string, unknown>) => {
  if (key === "tags.createNew") return `Add "${opts?.tag}"`;
  if (key === "tags.selectTag") return `Add tag ${opts?.tag}`;
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
      badge: { neutral: { bg: "#eee", text: "#333", border: "#ccc" } },
    },
    spacing: { sm: 4, md: 8, lg: 16, xl: 24 },
    typography: {
      title: { fontSize: 18 },
      body: { fontSize: 14 },
      caption: { fontSize: 12 },
    },
  }),
}));

vi.mock("../../../api/tags", () => ({
  searchTagSuggestions: (...args: unknown[]) => searchTagSuggestionsMock(...args),
}));

import { TagPickerModal } from "./TagPickerModal";

async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

function renderModal(overrides?: Partial<Parameters<typeof TagPickerModal>[0]>): ReactTestRenderer {
  const defaultProps = {
    visible: true,
    updating: false,
    updateError: null,
    appliedTagTexts: [] as string[],
    onSelect: vi.fn(),
    onClose: vi.fn(),
    client: { request: vi.fn() } as never,
    apiKey: "api-key",
    ...overrides,
  };

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(React.createElement(TagPickerModal, defaultProps));
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

function createRow(renderer: ReactTestRenderer, tag: string): ReactTestInstance | undefined {
  return renderer.root
    .findAllByType(Pressable)
    .find((p) => p.props.accessibilityLabel === `Add "${tag}"`);
}

function typeSearch(renderer: ReactTestRenderer, text: string) {
  const input = renderer.root.findByType(TextInput);
  act(() => input.props.onChangeText(text));
}

function makeSuggestion(text: string): TagSuggestion {
  return { tag_text: text, background_color: null, text_color: null };
}

describe("TagPickerModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    searchTagSuggestionsMock.mockResolvedValue({ ok: true, status: 200, data: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the create row while suggestions are loading", () => {
    searchTagSuggestionsMock.mockReturnValue(new Promise(() => {})); // never resolves
    const renderer = renderModal();

    typeSearch(renderer, "newtag");

    expect(getTextContent(renderer)).toContain("common:loading");
    expect(createRow(renderer, "newtag")).toBeDefined();
  });

  it("keeps the create row and shows the error inline when suggestions fail", async () => {
    searchTagSuggestionsMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: { kind: "http", message: "boom", status: 500 },
    });
    const renderer = renderModal();
    await flush();

    typeSearch(renderer, "newtag");
    await flush();

    expect(getTextContent(renderer)).toContain("tags.errors.suggestions");
    expect(createRow(renderer, "newtag")).toBeDefined();
    expect(renderer.root.findByType(TextInput)).toBeDefined();
  });

  it("hides the create row when a suggestion matches case-insensitively", async () => {
    searchTagSuggestionsMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [makeSuggestion("VIP")],
    });
    const renderer = renderModal();
    await flush();

    typeSearch(renderer, "vip");
    await flush();

    expect(createRow(renderer, "vip")).toBeUndefined();
    const suggestionRow = renderer.root
      .findAllByType(Pressable)
      .find((p) => p.props.accessibilityLabel === "Add tag VIP");
    expect(suggestionRow).toBeDefined();
  });

  it("keeps the create row when suggestions only partially match", async () => {
    searchTagSuggestionsMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [makeSuggestion("vip-customer")],
    });
    const renderer = renderModal();
    await flush();

    typeSearch(renderer, "vip");
    await flush();

    expect(createRow(renderer, "vip")).toBeDefined();
  });

  it("hides the create row when the tag is already applied", async () => {
    const renderer = renderModal({ appliedTagTexts: ["Urgent"] });
    await flush();

    typeSearch(renderer, "urgent");
    await flush();

    expect(createRow(renderer, "urgent")).toBeUndefined();
  });

  it("selects the trimmed search text from the create row", async () => {
    const onSelect = vi.fn();
    const renderer = renderModal({ onSelect });
    await flush();

    typeSearch(renderer, "  fresh  ");
    await flush();

    const row = createRow(renderer, "fresh");
    expect(row).toBeDefined();
    act(() => row!.props.onPress());
    expect(onSelect).toHaveBeenCalledWith("fresh");
  });
});
