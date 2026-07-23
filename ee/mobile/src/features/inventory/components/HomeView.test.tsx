import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockLevels = vi.fn();
const mockPos = vi.fn();
const mockTransfers = vi.fn();
const mockCounts = vi.fn();
vi.mock("../../../api/inventory", () => ({
  listStockLevels: (...args: unknown[]) => mockLevels(...args),
  listPurchaseOrders: (...args: unknown[]) => mockPos(...args),
  listTransfers: (...args: unknown[]) => mockTransfers(...args),
  listCountSessions: (...args: unknown[]) => mockCounts(...args),
}));

const stableApi = { client: { request: vi.fn() } as never, apiKey: "key-1" };
vi.mock("../hooks/useInventoryApi", () => ({
  useInventoryApi: () => stableApi,
}));

import { HomeView } from "./HomeView";

function ok(data: unknown) {
  return { ok: true, data: { data } };
}

async function renderHome(onOpenSegment = vi.fn()): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<HomeView onOpenSegment={onOpenSegment} />);
  });
  return tree;
}

describe("HomeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLevels.mockResolvedValue(ok([]));
    mockPos.mockResolvedValue(ok([]));
    mockTransfers.mockResolvedValue(ok([]));
    mockCounts.mockResolvedValue(ok([]));
  });

  it("renders the quiet empty state when nothing needs attention", async () => {
    const tree = await renderHome();
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-home-empty")).toHaveLength(1);
  });

  it("renders low-stock, arriving, and transfer sections from data", async () => {
    mockLevels.mockResolvedValue(
      ok([{ service_id: "svc-4", service_name: "Toner", location_id: "loc-1", location_name: "Main", quantity_on_hand: 2, reserved_quantity: 0, held_quantity: 0, available: 2, reorder_point: 6, is_low_stock: true }]),
    );
    mockPos.mockResolvedValue(ok([{ po_id: "po-1", po_number: "PO-0001", vendor_name: "target", status: "open", expected_date: "2026-07-19T00:00:00.000Z" }]));
    mockTransfers.mockResolvedValue(ok([{ transfer_id: "tr-1", from_location_id: "loc-1", from_location_name: "Main", to_location_id: "loc-2", to_location_name: "Van 1", status: "dispatched" }]));
    const tree = await renderHome();
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-home-empty")).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-home-lowstock-svc-4").length).toBeGreaterThan(0);
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-home-po-po-1").length).toBeGreaterThan(0);
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-home-transfer-tr-1").length).toBeGreaterThan(0);
  });

  it("scan CTA switches to the scan segment", async () => {
    const onOpenSegment = vi.fn();
    const tree = await renderHome(onOpenSegment);
    const cta = tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-home-scan")[0];
    act(() => cta.props.onPress());
    expect(onOpenSegment).toHaveBeenCalledWith("scan");
  });
});
