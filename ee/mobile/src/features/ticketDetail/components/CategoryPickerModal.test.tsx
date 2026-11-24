import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  openURL: vi.fn(),
  copy: vi.fn(),
  listUsers: vi.fn(),
  // Stable identity, like production react-i18next.
  t: (key: string, defOrOpts?: unknown, maybeOpts?: unknown) => {
    const opts = (typeof defOrOpts === "object" ? defOrOpts : maybeOpts) as Record<string, unknown> | undefined;
    const extra = opts ? Object.values(opts).map(String).join(",") : "";
    return extra ? `${key}:${extra}` : key;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return {
    ...actual,
    Alert: { alert: (...args: unknown[]) => mocks.alert(...args) },
    Linking: { openURL: (...args: unknown[]) => mocks.openURL(...args) },
  };
});
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});

const byTestId = (r: ReactTestRenderer, id: string) =>
  r.root.find((n) => n.props?.testID === id && (typeof n.props?.onPress === "function" || typeof n.props?.onChangeText === "function" || typeof n.props?.onValueChange === "function"));
const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map((n) => ([] as unknown[]).concat(n.props.children).join(""));
void afterEach;

import { CategoryPickerModal } from "./CategoryPickerModal";

const CATEGORIES = [
  { category_id: "c-hw", category_name: "Hardware" },
  { category_id: "c-hw-laptop", category_name: "Laptop", parent_category: "c-hw" },
  { category_id: "c-hw-printer", category_name: "Printer", parent_category: "c-hw" },
  { category_id: "c-sw", category_name: "Software" },
  { category_id: "c-sw-office", category_name: "Office suite", parent_category: "c-sw" },
];

function render(overrides: Partial<React.ComponentProps<typeof CategoryPickerModal>> = {}) {
  const props = {
    visible: true, loading: false, error: null, categories: CATEGORIES, currentCategoryId: "c-hw-laptop",
    updating: false, updateError: null, onApply: vi.fn(), onClose: vi.fn(), ...overrides,
  };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<CategoryPickerModal {...props} />); });
  return { renderer, props };
}
const applyBtn = (r: ReactTestRenderer) => byTestId(r, "ticket-update-apply-button");
const optionIds = (r: ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.type === "string" && typeof n.props?.testID === "string" && n.props.testID.startsWith("ticket-category-option-") && typeof n.props.onPress === "function")
    .map((n) => n.props.testID.replace("ticket-category-option-", ""));

describe("CategoryPickerModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders parents with their children and marks the current one", () => {
    const { renderer } = render();
    expect(optionIds(renderer)).toEqual(["c-hw", "c-hw-laptop", "c-hw-printer", "c-sw", "c-sw-office"]);
    expect(texts(renderer)).toContain("Laptop ✓");
    expect(applyBtn(renderer).props.disabled).toBe(true);
  });

  it("filters children by search and keeps a matching parent's whole group", () => {
    const { renderer } = render();
    act(() => byTestId(renderer, "ticket-category-search").props.onChangeText("print"));
    expect(optionIds(renderer)).toEqual(["c-hw", "c-hw-printer"]);
    act(() => byTestId(renderer, "ticket-category-search").props.onChangeText("software"));
    expect(optionIds(renderer)).toEqual(["c-sw", "c-sw-office"]);
    act(() => byTestId(renderer, "ticket-category-search").props.onChangeText("zzz"));
    expect(optionIds(renderer)).toEqual([]);
  });

  it("applies a new selection, and tapping the selected one clears it", () => {
    const { renderer, props } = render();
    act(() => byTestId(renderer, "ticket-category-option-c-sw").props.onPress());
    act(() => applyBtn(renderer).props.onPress());
    expect(props.onApply).toHaveBeenLastCalledWith("c-sw", undefined);

    act(() => byTestId(renderer, "ticket-category-option-c-sw").props.onPress());
    act(() => applyBtn(renderer).props.onPress());
    expect(props.onApply).toHaveBeenLastCalledWith(null, undefined);
  });

  it("shows the empty hint without a search box when there are no categories", () => {
    const { renderer } = render({ categories: [], currentCategoryId: null });
    expect(texts(renderer)).toContain("categoryPicker.empty");
    expect(renderer.root.findAll((n) => n.props?.testID === "ticket-category-search")).toHaveLength(0);
  });

  it("shows busy and error states", () => {
    const { renderer } = render({ loading: true, error: "load", updateError: "save" });
    expect(texts(renderer)).toEqual(expect.arrayContaining(["common:loading", "load", "save"]));
    expect(texts(renderer)).not.toContain("categoryPicker.empty");
    const saving = render({ updating: true });
    expect(texts(saving.renderer)).toContain("common:saving");
  });
});
