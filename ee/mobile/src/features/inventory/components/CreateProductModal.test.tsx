import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, vars?: Record<string, unknown>) => {
      if (typeof fallback === "string") {
        const values = vars ?? {};
        return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
      }
      return _key;
    },
  }),
}));

const mockListServiceTypes = vi.fn();
const mockCreateProduct = vi.fn();
vi.mock("../../../api/materials", () => ({
  listServiceTypes: (...args: unknown[]) => mockListServiceTypes(...args),
  createProduct: (...args: unknown[]) => mockCreateProduct(...args),
}));

import { CreateProductModal, defaultServiceType } from "./CreateProductModal";

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });
const apiClient = { request: vi.fn() } as never;

function byLabel(tree: ReactTestRenderer, label: string): ReactTestInstance[] {
  return tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === label);
}

describe("defaultServiceType", () => {
  it("prefers a product-ish type over the first entry", () => {
    const types = [
      { id: "t1", name: "Managed Services" },
      { id: "t2", name: "Hardware Product" },
    ];
    expect(defaultServiceType(types)?.id).toBe("t2");
  });

  it("falls back to the first type when nothing matches", () => {
    expect(defaultServiceType([{ id: "t1", name: "Consulting" }])?.id).toBe("t1");
    expect(defaultServiceType([])).toBeNull();
  });
});

describe("CreateProductModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListServiceTypes.mockResolvedValue(
      ok({
        data: [
          { id: "t1", name: "Managed Services" },
          { id: "t2", name: "Hardware Product" },
        ],
        pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
      }),
    );
    mockCreateProduct.mockResolvedValue(ok({ data: { service_id: "svc-new", service_name: "HP 26A Toner" } }));
  });

  it("creates the product with the scanned barcode and defaulted type", async () => {
    const onCreated = vi.fn();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <CreateProductModal
          visible
          client={apiClient}
          apiKey="key"
          barcode="0194850925894"
          onClose={vi.fn()}
          onCreated={onCreated}
        />,
      );
    });

    act(() => byLabel(tree, "inventory-create-product-name")[0].props.onChangeText("HP 26A Toner"));
    act(() => byLabel(tree, "inventory-create-product-sku")[0].props.onChangeText("HP-26A"));
    await act(async () => byLabel(tree, "inventory-create-product-submit")[0].props.onPress());

    expect(mockCreateProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: {
          service_name: "HP 26A Toner",
          custom_service_type_id: "t2",
          unit_of_measure: "each",
          sku: "HP-26A",
          barcode: "0194850925894",
        },
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("svc-new", "HP 26A Toner");
  });
});
