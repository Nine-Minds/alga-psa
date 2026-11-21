import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockListLocations = vi.fn();
vi.mock("../../../api/inventory", () => ({
  listStockLocations: (...args: unknown[]) => mockListLocations(...args),
}));

const api = { current: { client: { request: vi.fn() } as never, apiKey: "key-1" as string | null } };
vi.mock("../hooks/useInventoryApi", () => ({ useInventoryApi: () => api.current }));

import { Select } from "../../../ui/components";
import { LocationPickerField } from "./LocationPickerField";

const LOCATIONS = [
  { location_id: "loc-1", name: "Main", is_default: false },
  { location_id: "loc-2", name: "Van 1", is_default: true },
];

async function render(value: string | null, onChange = vi.fn()) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<LocationPickerField value={value} onChange={onChange} testID="loc-field" />);
  });
  return { tree, onChange };
}

describe("LocationPickerField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.current = { client: { request: vi.fn() } as never, apiKey: "key-1" };
    mockListLocations.mockResolvedValue({ ok: true, data: { data: LOCATIONS } });
  });

  it("selects the default location when no value is set", async () => {
    const { onChange } = await render(null);
    expect(mockListLocations).toHaveBeenCalledWith(api.current.client, { apiKey: "key-1" });
    expect(onChange).toHaveBeenCalledWith("loc-2");
  });

  it("falls back to the first location when none is default", async () => {
    mockListLocations.mockResolvedValue({ ok: true, data: { data: [{ location_id: "loc-9", name: "Shelf" }] } });
    const { onChange } = await render(null);
    expect(onChange).toHaveBeenCalledWith("loc-9");
  });

  it("keeps the provided value and shows its name", async () => {
    const { tree, onChange } = await render("loc-1");
    expect(onChange).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain("Main");
  });

  it("shows the placeholder and leaves value alone when the lookup fails", async () => {
    mockListLocations.mockResolvedValue({ ok: false, error: { kind: "network" } });
    const { tree, onChange } = await render(null);
    expect(onChange).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain("Location");
  });

  it("does not fetch without a client", async () => {
    api.current = { client: null as never, apiKey: null };
    await render(null);
    expect(mockListLocations).not.toHaveBeenCalled();
  });

  it("opens the picker and reports the selected location", async () => {
    const { tree, onChange } = await render("loc-1");
    const field = tree.root.find((n) => String(n.type) === "Pressable" && n.props.testID === "loc-field");
    expect(tree.root.findByType(Select).props.visible).toBe(false);
    act(() => field.props.onPress());
    const select = tree.root.findByType(Select);
    expect(select.props.visible).toBe(true);
    expect(select.props.options).toEqual([
      { label: "Main", value: "loc-1" },
      { label: "Van 1", value: "loc-2" },
    ]);
    act(() => select.props.onSelect("loc-2"));
    expect(onChange).toHaveBeenCalledWith("loc-2");
    expect(tree.root.findByType(Select).props.visible).toBe(false);
    act(() => field.props.onPress());
    act(() => tree.root.findByType(Select).props.onClose());
    expect(tree.root.findByType(Select).props.visible).toBe(false);
  });
});
