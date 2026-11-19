import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockLevels = vi.fn();
vi.mock("../../../api/inventory", () => ({ listStockLevels: (...args: unknown[]) => mockLevels(...args) }));

const api = { current: { client: { request: vi.fn() } as never, apiKey: "key-1" as string | null } };
vi.mock("../hooks/useInventoryApi", () => ({ useInventoryApi: () => api.current }));

const resume = vi.hoisted(() => ({ cb: null as null | (() => void) }));
vi.mock("../../../hooks/useAppResume", () => ({
  useAppResume: (cb: () => void) => {
    resume.cb = cb;
  },
}));

import { StockView } from "./StockView";

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => [].concat(n.props.children ?? []).join(""))
    .join("\n");
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => typeof String(n.type) === "string" && n.props.accessibilityLabel === label);

function row(service_id: string, overrides: Record<string, unknown> = {}) {
  return {
    service_id,
    service_name: `Product ${service_id}`,
    sku: null,
    location_id: "loc-1",
    quantity_on_hand: 5,
    available: 4,
    reserved_quantity: 0,
    held_quantity: 0,
    is_low_stock: false,
    ...overrides,
  };
}

function page(data: unknown[], pagination?: Record<string, unknown>) {
  return { ok: true, data: { data, pagination } };
}

async function advance(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<StockView />);
  });
  await advance();
  return tree;
}

describe("StockView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    api.current = { client: { request: vi.fn() } as never, apiKey: "key-1" };
    mockLevels.mockResolvedValue(
      page([
        row("svc-1", { location_id: "loc-1", quantity_on_hand: 2, available: 2, sku: "SKU-1" }),
        row("svc-1", { location_id: "loc-2", quantity_on_hand: 3, available: 1, is_low_stock: true }),
        row("svc-2", { service_name: undefined }),
      ]),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows loading until the debounced first fetch resolves", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<StockView />);
    });
    expect(mockLevels).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Loading...");
    await advance();
    expect(mockLevels).toHaveBeenCalledTimes(1);
  });

  it("aggregates levels per product across locations", async () => {
    const tree = await render();
    expect(mockLevels).toHaveBeenCalledWith(
      api.current.client,
      expect.objectContaining({ apiKey: "key-1", page: 1, limit: 30, search: undefined }),
    );
    const all = text(tree);
    expect(all).toContain("Product svc-1");
    expect(all).toContain("On hand 5 · Available 3 · SKU-1");
    expect(all).toContain("Low stock");
    expect(all).toContain("svc-2");
    expect(all).toContain("On hand 5 · Available 4");
  });

  it("navigates to product detail", async () => {
    const tree = await render();
    act(() => byLabel(tree, "inventory-stock-row-svc-1")[0].props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("StockProductDetail", { serviceId: "svc-1", serviceName: "Product svc-1" });
  });

  it("debounces search and sends the term", async () => {
    const tree = await render();
    const search = tree.root.find((n) => String(n.type) === "TextInput" && n.props.accessibilityLabel === "inventory-stock-search");
    act(() => search.props.onChangeText("ton"));
    await advance(100);
    expect(mockLevels).toHaveBeenCalledTimes(1);
    const tree2 = tree.root.find((n) => String(n.type) === "TextInput" && n.props.accessibilityLabel === "inventory-stock-search");
    act(() => tree2.props.onChangeText("toner"));
    await advance(300);
    expect(mockLevels).toHaveBeenCalledTimes(2);
    expect(mockLevels.mock.calls[1][1]).toMatchObject({ search: "toner", page: 1 });
  });

  it("loads the next page on end reached when hasNext", async () => {
    mockLevels.mockResolvedValueOnce(page([row("svc-1")], { hasNext: true }));
    const tree = await render();
    mockLevels.mockResolvedValueOnce(page([row("svc-3")], { hasNext: false }));
    await act(async () => {
      tree.root.find((n) => String(n.type) === "FlatList").props.onEndReached();
    });
    expect(mockLevels.mock.calls[1][1]).toMatchObject({ page: 2 });
    expect(text(tree)).toContain("Product svc-1");
    expect(text(tree)).toContain("Product svc-3");
    await act(async () => {
      tree.root.find((n) => String(n.type) === "FlatList").props.onEndReached();
    });
    expect(mockLevels).toHaveBeenCalledTimes(2);
  });

  it("infers hasNext from a full page when pagination is missing", async () => {
    mockLevels.mockResolvedValueOnce(page(Array.from({ length: 30 }, (_, i) => row(`s${i}`))));
    const tree = await render();
    mockLevels.mockResolvedValueOnce(page([]));
    await act(async () => {
      tree.root.find((n) => String(n.type) === "FlatList").props.onEndReached();
    });
    expect(mockLevels).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state", async () => {
    mockLevels.mockResolvedValue(page([]));
    expect(text(await render())).toContain("No stock-tracked products yet.");
  });

  it("shows no-access on permission errors", async () => {
    mockLevels.mockResolvedValue({ ok: false, error: { kind: "permission" } });
    expect(text(await render())).toContain("You don't have access to inventory.");
  });

  it("retries after an error", async () => {
    mockLevels.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    const tree = await render();
    const retry = tree.root.find((n) => String(n.type) === "Text" && n.props.children === "Retry");
    await act(async () => retry.props.onPress());
    expect(text(tree)).toContain("Product svc-1");
  });

  it("refetches on app resume and pull to refresh", async () => {
    const tree = await render();
    await act(async () => resume.cb?.());
    expect(mockLevels).toHaveBeenCalledTimes(2);
    await act(async () => {
      await tree.root.find((n) => String(n.type) === "FlatList").props.refreshControl.props.onRefresh();
    });
    expect(mockLevels).toHaveBeenCalledTimes(3);
  });

  it("ignores canceled requests and skips fetching without a client", async () => {
    mockLevels.mockResolvedValueOnce({ ok: false, error: { kind: "canceled" } });
    expect(text(await render())).toContain("Loading...");
    mockLevels.mockClear();
    api.current = { client: null as never, apiKey: null };
    await render();
    expect(mockLevels).not.toHaveBeenCalled();
  });
});
