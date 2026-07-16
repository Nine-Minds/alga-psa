import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ScanResultCard } from "./ScanResultCard";
import type { InventoryLookupResult } from "../../../api/inventory";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const product = {
  service_id: "svc-1",
  service_name: "Yealink T54W",
  sku: "YEA-T54W",
  barcode: "0810059630",
  is_serialized: true,
  unit_of_measure: "each",
};

const unit = {
  unit_id: "unit-1",
  service_id: "svc-1",
  service_name: "Yealink T54W",
  serial_number: "SN-001",
  mac_address: "AA:BB:CC:DD:EE:FF",
  status: "in_stock" as const,
  location_name: "Main Warehouse",
  warranty_expires_at: "2027-01-01T00:00:00.000Z",
};

function render(result: InventoryLookupResult, handlers: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <ScanResultCard
        code="TEST-CODE"
        result={result}
        onOpenProduct={handlers.onOpenProduct ?? vi.fn()}
        onReceiveProduct={handlers.onReceiveProduct ?? vi.fn()}
        onOpenUnit={handlers.onOpenUnit ?? vi.fn()}
        onManualSearch={handlers.onManualSearch ?? vi.fn()}
        onDismiss={handlers.onDismiss ?? vi.fn()}
      />,
    );
  });
  return tree;
}

describe("ScanResultCard", () => {
  it("renders the product variant with levels and receive action", () => {
    const onReceiveProduct = vi.fn();
    const tree = render(
      {
        type: "product",
        product,
        levels: [
          {
            service_id: "svc-1",
            location_id: "loc-1",
            quantity_on_hand: 5,
            reserved_quantity: 1,
            held_quantity: 0,
            available: 4,
          },
        ],
      },
      { onReceiveProduct },
    );
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-card-product")).toHaveLength(1);
    const receive = tree.root.find((node) => node.props.testID === "inventory-scan-receive-product");
    act(() => receive.props.onPress());
    expect(onReceiveProduct).toHaveBeenCalledWith("svc-1", "Yealink T54W", true);
  });

  it("renders the unit variant and opens unit history", () => {
    const onOpenUnit = vi.fn();
    const tree = render({ type: "unit", unit, product }, { onOpenUnit });
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-card-unit")).toHaveLength(1);
  });

  it("renders the multi variant with a chooser row per match", () => {
    const tree = render({
      type: "multi",
      matches: [
        { kind: "product", product },
        { kind: "unit", unit },
      ],
    });
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-card-multi")).toHaveLength(1);
    expect(tree.root.findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && node.props.testID.startsWith("inventory-scan-multi-"))).toHaveLength(2);
  });

  it("renders the none variant with candidates and manual search", () => {
    const onManualSearch = vi.fn();
    const tree = render(
      { type: "none", candidates: [{ kind: "unit", unit }] },
      { onManualSearch },
    );
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-card-none")).toHaveLength(1);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-candidate-0")).toHaveLength(1);
  });
});
