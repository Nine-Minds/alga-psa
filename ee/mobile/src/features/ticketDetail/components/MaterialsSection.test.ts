import React from "react";
import { Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTicketMaterialsMock = vi.fn();
const addTicketMaterialMock = vi.fn();
const listProductsMock = vi.fn();
const translate = (key: string, opts?: Record<string, unknown>) => {
  if (key === "materials.quantityRate") {
    return `Qty ${opts?.quantity} • Rate ${opts?.rate}`;
  }
  return key;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

function MockBadge(props: Record<string, unknown>) { return React.createElement("span", props, props.label as React.ReactNode); }
vi.mock("../../../ui/components/Badge", () => ({
  Badge: MockBadge,
}));

vi.mock("../../../ui/components/Card", () => ({
  Card: (props: Record<string, unknown>) => React.createElement("MockCard", props, props.children as React.ReactNode),
}));

vi.mock("../../../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) =>
    React.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
}));

vi.mock("../../../ui/components/SectionHeader", () => ({
  SectionHeader: (props: Record<string, unknown>) => React.createElement("MockSectionHeader", props, props.action as React.ReactNode),
}));

function MockEntityPickerModal(props: Record<string, unknown>) {
  if (!props.visible) return null;
  const items = (props.items as Array<Record<string, unknown>>) ?? [];
  return React.createElement(
    "div",
    props,
    [
      React.createElement(TextInput, {
        key: "search",
        accessibilityLabel: "product-search",
        onChangeText: props.onSearch as ((value: string) => void) | undefined,
      }),
      ...items.map((item) => React.createElement("div", {
        key: item.id as string,
        accessibilityLabel: item.label as string,
        subtitle: item.subtitle as string | undefined,
        onPress: () => (props.onSelect as (id: string, label: string) => void)(item.id as string, item.label as string),
      })),
    ],
  );
}
vi.mock("../../../ui/components/EntityPickerModal", () => ({
  EntityPickerModal: MockEntityPickerModal,
}));

vi.mock("../../../api/materials", () => ({
  getTicketMaterials: (...args: unknown[]) => getTicketMaterialsMock(...args),
  addTicketMaterial: (...args: unknown[]) => addTicketMaterialMock(...args),
  listProducts: (...args: unknown[]) => listProductsMock(...args),
}));

import { MaterialsSection } from "./MaterialsSection";

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
      React.createElement(MaterialsSection, {
        client: { request: vi.fn() },
        apiKey: "api-key-1",
        ticketId: "ticket-1",
      }),
    );
  });

  if (!renderer) {
    throw new Error("Renderer was not created");
  }

  return renderer;
}

function getTextContent(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

describe("MaterialsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketMaterialsMock.mockResolvedValue({ ok: true, data: { data: [] } });
    addTicketMaterialMock.mockResolvedValue({ ok: true, data: { data: { ticket_material_id: "mat-1" } } });
    listProductsMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            service_id: "service-1",
            service_name: "SSD Drive",
            sku: "SSD-1TB",
            default_rate: 7500,
          },
        ],
      },
    });
  });

  it("renders the materials list with product metadata and billed status", async () => {
    getTicketMaterialsMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            ticket_material_id: "mat-1",
            service_id: "service-1",
            service_name: "SSD Drive",
            sku: "SSD-1TB",
            quantity: 2,
            rate: 7500,
            currency_code: "USD",
            is_billed: true,
          },
        ],
      },
    });

    const renderer = renderSection();
    await flushAsyncWork();
    const textContent = getTextContent(renderer);

    expect(textContent).toContain("SSD Drive");
    expect(textContent).toContain("SSD-1TB");
    expect(textContent.some((value) => value.includes("Qty 2"))).toBe(true);
    const badges = renderer.root.findAllByType(MockBadge);
    expect(badges.some((node) => node.props.label === "1")).toBe(true);
    expect(badges.some((node) => node.props.label === "materials.billed")).toBe(true);
  });

  it("shows the empty state when no materials are attached", async () => {
    const renderer = renderSection();
    await flushAsyncWork();

    expect(getTextContent(renderer)).toContain("materials.empty");
  });

  it("opens the product picker with search and shows product name and sku", async () => {
    const renderer = renderSection();
    await flushAsyncWork();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "materials.addProduct" }).props.onPress();
    });
    await flushAsyncWork();

    expect(listProductsMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ search: "", limit: 20 }));
    expect(renderer.root.findByType(MockEntityPickerModal)).toBeTruthy();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "product-search" }).props.onChangeText("ssd");
    });

    expect(listProductsMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ search: "ssd", limit: 20 }));
    const pickerItem = renderer.root.findByProps({ accessibilityLabel: "SSD Drive" });
    expect(pickerItem.props.subtitle).toBe("SSD-1TB — $75.00");
  });

  it("shows the quantity/rate modal with the product default rate after selection", async () => {
    const renderer = renderSection();
    await flushAsyncWork();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "materials.addProduct" }).props.onPress();
    });
    await flushAsyncWork();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "SSD Drive" }).props.onPress();
    });

    const textInputs = renderer.root.findAllByType(TextInput);
    expect(textInputs.find((node) => node.props.accessibilityLabel === "materials.quantityLabel")?.props.value).toBe("1");
    expect(textInputs.find((node) => node.props.accessibilityLabel === "materials.rateLabel")?.props.value).toBe("75.00");
  });

  it("submits a material and refreshes the list", async () => {
    getTicketMaterialsMock
      .mockResolvedValueOnce({ ok: true, data: { data: [] } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          data: [
            {
              ticket_material_id: "mat-1",
              service_id: "service-1",
              service_name: "SSD Drive",
              sku: "SSD-1TB",
              quantity: 1,
              rate: 7500,
              currency_code: "USD",
              is_billed: false,
            },
          ],
        },
      });

    const renderer = renderSection();
    await flushAsyncWork();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "materials.addProduct" }).props.onPress();
    });
    await flushAsyncWork();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "SSD Drive" }).props.onPress();
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "materials.saveMaterial" }).props.onPress();
    });
    await flushAsyncWork();

    expect(addTicketMaterialMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ticketId: "ticket-1",
        data: expect.objectContaining({
          service_id: "service-1",
          quantity: 1,
          rate: 7500,
          currency_code: "USD",
        }),
      }),
    );
    expect(getTicketMaterialsMock).toHaveBeenCalledTimes(2);
    expect(getTextContent(renderer)).toContain("SSD Drive");
  });

  it("shows an error when adding a material fails", async () => {
    addTicketMaterialMock.mockResolvedValue({
      ok: false,
      error: { message: "add failed" },
    });

    const renderer = renderSection();
    await flushAsyncWork();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "materials.addProduct" }).props.onPress();
    });
    await flushAsyncWork();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "SSD Drive" }).props.onPress();
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "materials.saveMaterial" }).props.onPress();
    });
    await flushAsyncWork();

    expect(getTextContent(renderer)).toContain("add failed");
  });
});
