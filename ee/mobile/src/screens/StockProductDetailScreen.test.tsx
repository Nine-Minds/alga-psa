import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockLevels = vi.fn();
const mockUnits = vi.fn();
vi.mock("../api/inventory", () => ({
  listStockLevels: (...args: unknown[]) => mockLevels(...args),
  listStockUnits: (...args: unknown[]) => mockUnits(...args),
}));

const api = { current: { client: { request: vi.fn() } as never, apiKey: "key-1" as string | null } };
vi.mock("../features/inventory/hooks/useInventoryApi", () => ({ useInventoryApi: () => api.current }));

import { StockProductDetailScreen } from "./StockProductDetailScreen";

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => [].concat(n.props.children ?? []).join(""))
    .join("\n");
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => typeof String(n.type) === "string" && n.props.accessibilityLabel === label);

const navigate = vi.fn();

async function render(params: Record<string, unknown> = { serviceId: "svc-1", serviceName: "Toner" }) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <StockProductDetailScreen
        route={{ key: "r", name: "StockProductDetail", params } as never}
        navigation={{ navigate } as never}
      />,
    );
  });
  return tree;
}

const LEVELS = [
  { service_id: "svc-1", service_name: "Toner X", location_id: "loc-1", location_name: "Main", quantity_on_hand: 4, available: 3, is_low_stock: false },
  { service_id: "svc-1", service_name: "Toner X", location_id: "loc-2", quantity_on_hand: 1, available: 1, is_low_stock: true },
];

describe("StockProductDetailScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.current = { client: { request: vi.fn() } as never, apiKey: "key-1" };
    mockLevels.mockResolvedValue({ ok: true, data: { data: LEVELS } });
    mockUnits.mockResolvedValue({ ok: true, data: { data: [] } });
  });

  it("fetches levels and in-stock units for the product and renders per-location rows", async () => {
    const tree = await render();
    expect(mockLevels).toHaveBeenCalledWith(api.current.client, expect.objectContaining({ serviceId: "svc-1", limit: 100 }));
    expect(mockUnits).toHaveBeenCalledWith(api.current.client, expect.objectContaining({ serviceId: "svc-1", status: "in_stock" }));
    const all = text(tree);
    expect(all).toContain("Toner");
    expect(all).toContain("Main");
    expect(all).toContain("On hand 4 · Available 3");
    expect(all).toContain("loc-2");
    expect(all).toContain("Low stock");
    expect(all).not.toContain("Units");
  });

  it("non-serialized product: receive and adjust navigate with isSerialized false", async () => {
    const tree = await render();
    act(() => byLabel(tree, "inventory-product-receive")[0].props.onPress());
    expect(navigate).toHaveBeenCalledWith("InventoryReceive", { serviceId: "svc-1", serviceName: "Toner", isSerialized: false });
    act(() => tree.root.find((n) => String(n.type) === "Text" && n.props.testID === "inventory-product-adjust").props.onPress());
    expect(navigate).toHaveBeenCalledWith("InventoryAdjust", { serviceId: "svc-1", serviceName: "Toner" });
  });

  it("serialized product: lists units, opens unit detail, receives as serialized", async () => {
    mockUnits.mockResolvedValue({
      ok: true,
      data: { data: [{ unit_id: "u-1", serial_number: "SN-1", location_name: "Main", status: "in_stock" }, { unit_id: "u-2", serial_number: "SN-2", status: "in_stock" }] },
    });
    const tree = await render();
    expect(text(tree)).toContain("Units");
    expect(text(tree)).toContain("SN-2");
    act(() => byLabel(tree, "inventory-product-unit-u-1")[0].props.onPress());
    expect(navigate).toHaveBeenCalledWith("StockUnitDetail", { unitId: "u-1" });
    act(() => byLabel(tree, "inventory-product-receive")[0].props.onPress());
    expect(navigate).toHaveBeenCalledWith("InventoryReceive", expect.objectContaining({ isSerialized: true }));
  });

  it("falls back to the level name, then the id, for the title", async () => {
    expect(text(await render({ serviceId: "svc-1" }))).toContain("Toner X");
    mockLevels.mockResolvedValue({ ok: true, data: { data: [] } });
    const tree = await render({ serviceId: "svc-1" });
    expect(text(tree)).toContain("svc-1");
    expect(text(tree)).toContain("No stock-tracked products yet.");
  });

  it("treats a units failure as no units", async () => {
    mockUnits.mockResolvedValue({ ok: false, error: { kind: "server" } });
    const tree = await render();
    expect(text(tree)).toContain("Main");
    expect(text(tree)).not.toContain("Units");
  });

  it("shows an error with retry when levels fail", async () => {
    mockLevels.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    const tree = await render();
    expect(text(tree)).toContain("Something went wrong");
    await act(async () => tree.root.find((n) => String(n.type) === "Text" && n.props.children === "Retry").props.onPress());
    expect(text(tree)).toContain("Main");
  });

  it("stays loading on cancel and does not fetch without a client", async () => {
    mockLevels.mockResolvedValueOnce({ ok: false, error: { kind: "canceled" } });
    expect(text(await render())).toContain("Loading...");
    vi.clearAllMocks();
    api.current = { client: null as never, apiKey: null };
    await render();
    expect(mockLevels).not.toHaveBeenCalled();
  });
});
