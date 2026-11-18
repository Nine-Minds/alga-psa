import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockGetUnit = vi.fn();
vi.mock("../api/inventory", () => ({
  getStockUnit: (...args: unknown[]) => mockGetUnit(...args),
}));

const stableApi = { client: { request: vi.fn() } as never, apiKey: "k", baseUrl: "https://psa.example.com" };
vi.mock("../features/inventory/hooks/useInventoryApi", () => ({
  useInventoryApi: () => stableApi,
}));

import { StockUnitDetailScreen } from "./StockUnitDetailScreen";

async function renderScreen(goBack = vi.fn()): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <StockUnitDetailScreen
        route={{ key: "r", name: "StockUnitDetail", params: { unitId: "u-1" } } as never}
        navigation={{ goBack } as never}
      />,
    );
  });
  return tree;
}

const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

describe("StockUnitDetailScreen unavailable states", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["403", { kind: "permission", status: 403, message: "denied" }],
    ["404", { kind: "http", status: 404, message: "Unit not found" }],
  ])("shows the unavailable state on %s with Back and no Retry", async (_l, error) => {
    mockGetUnit.mockResolvedValue({ ok: false, status: (error as { status: number }).status, error });
    const goBack = vi.fn();
    const tree = await renderScreen(goBack);
    expect(text(tree)).toContain("Not found, or you don't have access");
    expect(text(tree)).not.toContain("Retry");
    act(() => tree.root.find((n) => n.props.testID === "record-unavailable-back").props.onPress());
    expect(goBack).toHaveBeenCalled();
  });

  it("keeps Retry for network and server errors", async () => {
    for (const error of [
      { kind: "network", message: "x" },
      { kind: "server", status: 500, message: "x" },
    ]) {
      mockGetUnit.mockResolvedValue({ ok: false, error });
      const tree = await renderScreen();
      expect(text(tree)).toContain("Retry");
      expect(text(tree)).not.toContain("Not found, or you don't have access");
    }
  });
});
