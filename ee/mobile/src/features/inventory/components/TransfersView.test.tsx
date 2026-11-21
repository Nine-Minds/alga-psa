import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      for (const [k, v] of Object.entries(opts ?? {})) out = out.replace(`{{${k}}}`, String(v));
      return out;
    },
  }),
}));

const mockList = vi.fn();
const mockReceive = vi.fn();
vi.mock("../../../api/inventory", () => ({
  listTransfers: (...args: unknown[]) => mockList(...args),
  receiveTransfer: (...args: unknown[]) => mockReceive(...args),
}));

const api = { current: { client: { request: vi.fn() } as never, apiKey: "key-1" as string | null } };
vi.mock("../hooks/useInventoryApi", () => ({ useInventoryApi: () => api.current }));

const mockShowToast = vi.fn();
vi.mock("../../../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import { TransfersView } from "./TransfersView";

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => [].concat(n.props.children ?? []).join(""))
    .join("\n");
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => typeof String(n.type) === "string" && n.props.accessibilityLabel === label);

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<TransfersView />);
  });
  return tree;
}

const TRANSFERS = [
  { transfer_id: "tr-1", from_location_id: "loc-1", from_location_name: "Main", to_location_id: "loc-2", to_location_name: "Van 1", status: "dispatched" },
  { transfer_id: "tr-2", from_location_id: "loc-3", to_location_id: "loc-4", status: "dispatched" },
];

describe("TransfersView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.current = { client: { request: vi.fn() } as never, apiKey: "key-1" };
    mockList.mockResolvedValue({ ok: true, data: { data: TRANSFERS } });
  });

  it("lists dispatched transfers with location fallbacks", async () => {
    const tree = await render();
    expect(mockList).toHaveBeenCalledWith(api.current.client, expect.objectContaining({ status: "dispatched", page: 1, limit: 30 }));
    expect(text(tree)).toContain("Van 1");
    expect(text(tree)).toContain("From Main");
    expect(text(tree)).toContain("loc-4");
    expect(text(tree)).toContain("From loc-3");
  });

  it("receives a transfer, toasts success and removes the row", async () => {
    mockReceive.mockResolvedValue({ ok: true, data: {} });
    const tree = await render();
    await act(async () => {
      byLabel(tree, "inventory-transfer-receive-tr-1")[0].props.onPress();
    });
    expect(mockReceive).toHaveBeenCalledWith(api.current.client, { apiKey: "key-1", transferId: "tr-1" });
    expect(mockShowToast).toHaveBeenCalledWith({ tone: "success", message: "Transfer received" });
    expect(byLabel(tree, "inventory-transfer-row-tr-1")).toHaveLength(0);
    expect(byLabel(tree, "inventory-transfer-row-tr-2").length).toBeGreaterThan(0);
  });

  it("toasts a permission error and keeps the row", async () => {
    mockReceive.mockResolvedValue({ ok: false, error: { kind: "permission" } });
    const tree = await render();
    await act(async () => {
      byLabel(tree, "inventory-transfer-receive-tr-1")[0].props.onPress();
    });
    expect(mockShowToast).toHaveBeenCalledWith({ tone: "error", message: "You can't adjust stock at this location." });
    expect(byLabel(tree, "inventory-transfer-row-tr-1").length).toBeGreaterThan(0);
  });

  it("toasts a generic error for other failures", async () => {
    mockReceive.mockResolvedValue({ ok: false, error: { kind: "server" } });
    const tree = await render();
    await act(async () => {
      byLabel(tree, "inventory-transfer-receive-tr-2")[0].props.onPress();
    });
    expect(mockShowToast).toHaveBeenCalledWith({ tone: "error", message: "Lookup failed. Try again." });
  });

  it("disables the receive button while receiving", async () => {
    let resolve!: (v: unknown) => void;
    mockReceive.mockReturnValue(new Promise((r) => (resolve = r)));
    const tree = await render();
    act(() => {
      byLabel(tree, "inventory-transfer-receive-tr-1")[0].props.onPress();
    });
    expect(byLabel(tree, "inventory-transfer-receive-tr-1")[0].props.disabled).toBe(true);
    await act(async () => resolve({ ok: true, data: {} }));
  });

  it("shows empty, no-access and error states", async () => {
    mockList.mockResolvedValueOnce({ ok: true, data: { data: [] } });
    expect(text(await render())).toContain("No transfers in transit to your locations.");
    mockList.mockResolvedValueOnce({ ok: false, error: { kind: "permission" } });
    expect(text(await render())).toContain("You don't have access to inventory.");
    mockList.mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    const tree = await render();
    const retry = tree.root.find((n) => String(n.type) === "Text" && n.props.children === "Retry");
    await act(async () => retry.props.onPress());
    expect(text(tree)).toContain("Van 1");
  });

  it("stays loading on cancel and skips fetching without a client", async () => {
    mockList.mockResolvedValueOnce({ ok: false, error: { kind: "canceled" } });
    expect(text(await render())).toContain("Loading...");
    mockList.mockClear();
    api.current = { client: null as never, apiKey: null };
    await render();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("pull to refresh refetches", async () => {
    const tree = await render();
    await act(async () => {
      await tree.root.find((n) => String(n.type) === "FlatList").props.refreshControl.props.onRefresh();
    });
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});
