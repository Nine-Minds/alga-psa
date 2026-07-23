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
        onOpenAsset={handlers.onOpenAsset ?? vi.fn()}
        onManualSearch={handlers.onManualSearch ?? vi.fn()}
        onDismiss={handlers.onDismiss ?? vi.fn()}
        onAttachBarcode={handlers.onAttachBarcode}
        onInstallUnit={handlers.onInstallUnit}
        onCreateProduct={handlers.onCreateProduct}
        onRegisterAsset={handlers.onRegisterAsset}
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
    const receive = tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-scan-receive-product")[0];
    act(() => receive.props.onPress());
    expect(onReceiveProduct).toHaveBeenCalledWith("svc-1", "Yealink T54W", true);
  });


  it("shows the untracked hint and still offers receive for untracked products", () => {
    const tree = render({
      type: "product",
      product: { ...product, track_stock: false },
      levels: [],
    });
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-untracked-hint")).toHaveLength(1);
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-scan-receive-product").length).toBeGreaterThan(0);
  });

  it("renders the unit variant and opens unit history", () => {
    const onOpenUnit = vi.fn();
    const tree = render({ type: "unit", unit, product }, { onOpenUnit });
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-card-unit")).toHaveLength(1);
  });

  it("offers install on an in-stock unit without an asset", () => {
    const onInstallUnit = vi.fn();
    const tree = render({ type: "unit", unit, product }, { onInstallUnit });
    const install = tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-scan-install-unit")[0];
    expect(install).toBeTruthy();
    act(() => install.props.onPress());
    expect(onInstallUnit).toHaveBeenCalledWith(unit);
  });

  it("hides install when the unit already has an asset or is not in stock", () => {
    const withAsset = render(
      { type: "unit", unit: { ...unit, asset_id: "asset-1" }, product },
      { onInstallUnit: vi.fn() },
    );
    expect(withAsset.root.findAll((node) => node.props.accessibilityLabel === "inventory-scan-install-unit")).toHaveLength(0);
    const delivered = render(
      { type: "unit", unit: { ...unit, status: "delivered" as const }, product },
      { onInstallUnit: vi.fn() },
    );
    expect(delivered.root.findAll((node) => node.props.accessibilityLabel === "inventory-scan-install-unit")).toHaveLength(0);
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
    expect(tree.root.findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && node.props.testID.startsWith("inventory-scan-choice-"))).toHaveLength(2);
  });

  it("renders the none variant with candidates and manual search", () => {
    const onManualSearch = vi.fn();
    const tree = render(
      { type: "none", candidates: [{ kind: "unit", unit }] },
      { onManualSearch },
    );
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-card-none")).toHaveLength(1);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-choice-0")).toHaveLength(1);
  });

  it("renders the asset variant and opens the asset", () => {
    const onOpenAsset = vi.fn();
    const tree = render(
      { type: "asset", asset: { asset_id: "ast-1", asset_tag: "AST-1", name: "Reception Phone", serial_number: "SN-5", status: "active", client_name: "Emerald City", warranty_status: "active" } },
      { onOpenAsset },
    );
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-card-asset")).toHaveLength(1);
    const open = tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-scan-open-asset")[0];
    act(() => open.props.onPress());
    expect(onOpenAsset).toHaveBeenCalledWith("ast-1", "Reception Phone");
  });

  it("offers create-product and register-asset rescues on the none variant", () => {
    const onCreateProduct = vi.fn();
    const onRegisterAsset = vi.fn();
    const tree = render({ type: "none", candidates: [] }, { onCreateProduct, onRegisterAsset });
    const create = tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-create-product")[0];
    const register = tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "inventory-scan-register-asset")[0];
    act(() => create.props.onPress());
    act(() => register.props.onPress());
    expect(onCreateProduct).toHaveBeenCalled();
    expect(onRegisterAsset).toHaveBeenCalled();
  });

  it("invokes onAttachBarcode from the none variant", () => {
    const onAttachBarcode = vi.fn();
    const tree = render({ type: "none", candidates: [] }, { onAttachBarcode });
    const attach = tree.root.findAll((node) => node.props.accessibilityLabel === "inventory-scan-attach-barcode")[0];
    act(() => attach.props.onPress());
    expect(onAttachBarcode).toHaveBeenCalled();
  });
});
