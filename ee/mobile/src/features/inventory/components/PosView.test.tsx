import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const mockListPos = vi.fn();
vi.mock("../../../api/inventory", () => ({ listPurchaseOrders: (...args: unknown[]) => mockListPos(...args) }));

const api = { current: { client: { request: vi.fn() } as never, apiKey: "key-1" as string | null } };
vi.mock("../hooks/useInventoryApi", () => ({ useInventoryApi: () => api.current }));

import { PosView } from "./PosView";

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => [].concat(n.props.children ?? []).join(""))
    .join("\n");
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((n) => typeof String(n.type) === "string" && n.props.accessibilityLabel === label);

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<PosView />);
  });
  return tree;
}

describe("PosView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.current = { client: { request: vi.fn() } as never, apiKey: "key-1" };
    mockListPos.mockResolvedValue({
      ok: true,
      data: {
        data: [
          { po_id: "po-1", po_number: "PO-0001", vendor_name: "Ingram", status: "open" },
          { po_id: "po-2", po_number: "PO-0002", vendor_name: null, status: "partially_received" },
        ],
      },
    });
  });

  it("requests open and partially received POs and renders rows", async () => {
    const tree = await render();
    expect(mockListPos).toHaveBeenCalledWith(
      api.current.client,
      expect.objectContaining({ apiKey: "key-1", page: 1, limit: 30, status: "open,partially_received" }),
    );
    expect(text(tree)).toContain("PO-0001");
    expect(text(tree)).toContain("Ingram");
    expect(text(tree)).toContain("partially_received");
  });

  it("navigates to the PO detail on row press", async () => {
    const tree = await render();
    act(() => byLabel(tree, "inventory-po-row-po-2").props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("PurchaseOrderDetail", { poId: "po-2", poNumber: "PO-0002" });
  });

  it("shows the empty state", async () => {
    mockListPos.mockResolvedValue({ ok: true, data: { data: [] } });
    const tree = await render();
    expect(text(tree)).toContain("No open purchase orders.");
  });

  it("shows no-access on permission errors", async () => {
    mockListPos.mockResolvedValue({ ok: false, error: { kind: "permission" } });
    const tree = await render();
    expect(text(tree)).toContain("You don't have access to inventory.");
  });

  it("shows an error with retry that refetches", async () => {
    mockListPos.mockResolvedValueOnce({ ok: false, error: { kind: "server" } });
    const tree = await render();
    expect(text(tree)).toContain("Retry");
    const retry = tree.root.find((n) => String(n.type) === "Text" && n.props.children === "Retry");
    await act(async () => {
      retry.props.onPress();
    });
    expect(mockListPos).toHaveBeenCalledTimes(2);
    expect(text(tree)).toContain("PO-0001");
  });

  it("stays loading when the request is canceled", async () => {
    mockListPos.mockResolvedValue({ ok: false, error: { kind: "canceled" } });
    const tree = await render();
    expect(text(tree)).toContain("Loading...");
  });

  it("does not fetch without a client", async () => {
    api.current = { client: null as never, apiKey: null };
    await render();
    expect(mockListPos).not.toHaveBeenCalled();
  });

  it("pull to refresh refetches", async () => {
    const tree = await render();
    await act(async () => {
      await tree.root.find((n) => String(n.type) === "FlatList").props.refreshControl.props.onRefresh();
    });
    expect(mockListPos).toHaveBeenCalledTimes(2);
  });
});
