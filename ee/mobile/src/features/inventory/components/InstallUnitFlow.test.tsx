import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>, vars?: Record<string, unknown>) => {
      if (typeof fallback === "string") {
        const values = vars ?? {};
        return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
      }
      return _key;
    },
  }),
}));

const mockListTickets = vi.fn();
vi.mock("../../../api/tickets", () => ({
  listTickets: (...args: unknown[]) => mockListTickets(...args),
}));

const mockAddMaterial = vi.fn();
const mockListProducts = vi.fn();
vi.mock("../../../api/materials", () => ({
  addTicketMaterial: (...args: unknown[]) => mockAddMaterial(...args),
  listProducts: (...args: unknown[]) => mockListProducts(...args),
}));

const mockGetStockUnit = vi.fn();
vi.mock("../../../api/inventory", () => ({
  getStockUnit: (...args: unknown[]) => mockGetStockUnit(...args),
}));

import { InstallUnitFlow } from "./InstallUnitFlow";
import type { StockUnitSummary } from "../../../api/inventory";

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });

const unit: StockUnitSummary = {
  unit_id: "unit-1",
  service_id: "svc-1",
  service_name: "Dell Latitude 5540",
  serial_number: "SN123",
  status: "in_stock",
} as StockUnitSummary;

const apiClient = { request: vi.fn() } as never;

function hosts(tree: ReactTestRenderer, testID: string): ReactTestInstance[] {
  return tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
}

function byLabel(tree: ReactTestRenderer, label: string): ReactTestInstance[] {
  return tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === label);
}

async function renderFlow(onInstalled = vi.fn()) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <InstallUnitFlow
        visible
        client={apiClient}
        apiKey="key"
        unit={unit}
        onClose={vi.fn()}
        onInstalled={onInstalled}
      />,
    );
  });
  return { tree, onInstalled };
}

describe("InstallUnitFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTickets.mockResolvedValue(
      ok({
        data: [
          { ticket_id: "tk-1", ticket_number: "TK-100", title: "Onboard front desk", status_name: "Open", client_name: "Emerald City" },
        ],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      }),
    );
    mockListProducts.mockResolvedValue(
      ok({
        data: [{ service_id: "svc-1", service_name: "Dell Latitude 5540", prices: [{ price_id: "p1", currency_code: "EUR", rate: 129900 }] }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
    );
    mockAddMaterial.mockResolvedValue(ok({ data: { ticket_material_id: "mat-1" } }));
    mockGetStockUnit.mockResolvedValue(ok({ data: { ...unit, status: "delivered", asset_id: "asset-9" } }));
  });

  it("lists open tickets and shows the client the asset will belong to", async () => {
    const { tree } = await renderFlow();
    expect(mockListTickets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filters: { is_open: true } }),
    );
    await act(async () => hosts(tree, "inventory-install-ticket-tk-1")[0].props.onPress());
    const text = tree.root
      .findAll((node) => typeof node.type === "string")
      .map((node) => node.children.filter((child): child is string => typeof child === "string").join(""))
      .join("\n");
    expect(text).toContain("Asset will belong to Emerald City");
  });

  it("installs the unit against the ticket with the prefilled price and reports the minted asset", async () => {
    const { tree, onInstalled } = await renderFlow();
    await act(async () => hosts(tree, "inventory-install-ticket-tk-1")[0].props.onPress());

    // Rate prefilled from the product's first price (EUR 1299.00).
    expect(byLabel(tree, "inventory-install-rate")[0].props.value).toBe("1299.00");

    await act(async () => byLabel(tree, "inventory-install-submit")[0].props.onPress());

    expect(mockAddMaterial).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ticketId: "tk-1",
        data: { service_id: "svc-1", quantity: 1, rate: 129900, currency_code: "EUR", unit_id: "unit-1" },
      }),
    );
    expect(onInstalled).toHaveBeenCalledWith("asset-9");
  });

  it("reports null when no asset was minted (product opts out)", async () => {
    mockGetStockUnit.mockResolvedValue(ok({ data: { ...unit, status: "delivered", asset_id: null } }));
    const { tree, onInstalled } = await renderFlow();
    await act(async () => hosts(tree, "inventory-install-ticket-tk-1")[0].props.onPress());
    await act(async () => byLabel(tree, "inventory-install-submit")[0].props.onPress());
    expect(onInstalled).toHaveBeenCalledWith(null);
  });

  it("surfaces the server error verbatim and stays open", async () => {
    mockAddMaterial.mockResolvedValue({
      ok: false,
      status: 400,
      error: { kind: "validation", message: "Stock unit is not in stock", status: 400 },
    });
    const { tree, onInstalled } = await renderFlow();
    await act(async () => hosts(tree, "inventory-install-ticket-tk-1")[0].props.onPress());
    await act(async () => byLabel(tree, "inventory-install-submit")[0].props.onPress());
    expect(onInstalled).not.toHaveBeenCalled();
    const error = hosts(tree, "inventory-install-error")[0];
    expect(error.children.join("")).toContain("Stock unit is not in stock");
  });
});
