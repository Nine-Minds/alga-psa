import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stable t across renders — an unstable t would make the load callback (which
// depends on it) change every render and loop the fetch effect forever.
const translate = (_key: string, fallback?: string) => fallback ?? _key;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const getTicketAssetsMock = vi.fn();
vi.mock("../../../api/tickets", () => ({
  getTicketAssets: (...args: unknown[]) => getTicketAssetsMock(...args),
}));

function MockBadge(props: Record<string, unknown>) {
  return React.createElement("span", props, props.label as React.ReactNode);
}
vi.mock("../../../ui/components/Badge", () => ({ Badge: MockBadge }));
vi.mock("../../../ui/components/Card", () => ({
  Card: (props: Record<string, unknown>) => React.createElement("MockCard", props, props.children as React.ReactNode),
}));
vi.mock("../../../ui/components/SectionHeader", () => ({
  SectionHeader: (props: Record<string, unknown>) =>
    React.createElement("MockSectionHeader", props, [props.title as React.ReactNode, props.action as React.ReactNode]),
}));

import { AssetsSection } from "./AssetsSection";

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderSection(): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      React.createElement(AssetsSection, {
        client: { request: vi.fn() } as never,
        apiKey: "key",
        ticketId: "tk-1",
      }),
    );
  });
  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

function hosts(tree: ReactTestRenderer, testID: string): ReactTestInstance[] {
  return tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
}

function textContent(tree: ReactTestRenderer): string {
  return tree.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  }).join("\n");
}

describe("AssetsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketAssetsMock.mockResolvedValue(ok({ data: [] }));
  });

  it("lists linked assets and opens one on tap", async () => {
    getTicketAssetsMock.mockResolvedValue(
      ok({ data: [{ asset_id: "as-1", name: "Front desk PC", asset_tag: "OZLAP001", serial_number: "OZLAP001", status: "active" }] }),
    );
    const tree = renderSection();
    await flushAsyncWork();

    expect(getTicketAssetsMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ticketId: "tk-1" }));
    expect(textContent(tree)).toContain("Front desk PC");

    act(() => hosts(tree, "ticket-asset-as-1")[0].props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("AssetDetail", { assetId: "as-1", assetName: "Front desk PC" });
  });

  it("renders nothing when no assets are linked", async () => {
    const tree = renderSection();
    await flushAsyncWork();
    expect(tree.toJSON()).toBeNull();
  });

  it("shows an error but stays visible when the fetch fails", async () => {
    getTicketAssetsMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: { kind: "server", message: "boom", status: 500 },
    });
    const tree = renderSection();
    await flushAsyncWork();
    expect(textContent(tree)).toContain("Couldn't load linked devices.");
  });
});
