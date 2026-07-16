import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registeredScreens: string[] = [];

vi.mock("@react-navigation/drawer", () => ({
  createDrawerNavigator: () => ({
    Navigator: (props: { children?: React.ReactNode }) =>
      React.createElement("Navigator", null, props.children),
    Screen: (props: { name: string }) => {
      registeredScreens.push(props.name);
      return null;
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("../screens/UserActivitiesScreen", () => ({ UserActivitiesScreen: () => null }));
vi.mock("../screens/ScheduleScreen", () => ({ ScheduleScreen: () => null }));
vi.mock("../screens/TimeEntriesScreen", () => ({ TimeEntriesScreen: () => null }));
vi.mock("../screens/ClientsListScreen", () => ({ ClientsListScreen: () => null }));
vi.mock("../screens/ContactsListScreen", () => ({ ContactsListScreen: () => null }));
vi.mock("../screens/SettingsScreen", () => ({ SettingsScreen: () => null }));
vi.mock("../screens/InventoryScreen", () => ({ InventoryScreen: () => null }));
vi.mock("../screens/OpportunitiesScreen", () => ({ OpportunitiesScreen: () => null }));
vi.mock("./TicketsStackNavigator", () => ({ TicketsStackNavigator: () => null }));

let features = { inventory: false, opportunities: false };
vi.mock("../capabilities/CapabilitiesContext", () => ({
  useCapabilities: () => ({ features, loaded: true, refresh: vi.fn() }),
}));

import { DrawerNavigator } from "./DrawerNavigator";

function renderDrawer(): ReactTestRenderer {
  registeredScreens.length = 0;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<DrawerNavigator />);
  });
  return tree;
}

describe("DrawerNavigator capability gating", () => {
  beforeEach(() => {
    features = { inventory: false, opportunities: false };
  });

  it("hides Inventory and Opportunities tabs when capabilities are false", () => {
    renderDrawer();
    expect(registeredScreens).not.toContain("InventoryTab");
    expect(registeredScreens).not.toContain("OpportunitiesTab");
    expect(registeredScreens).toContain("TicketsTab");
    expect(registeredScreens).toContain("SettingsTab");
  });

  it("shows InventoryTab when the inventory capability is true", () => {
    features = { inventory: true, opportunities: false };
    renderDrawer();
    expect(registeredScreens).toContain("InventoryTab");
    expect(registeredScreens).not.toContain("OpportunitiesTab");
  });

  it("shows OpportunitiesTab when the opportunities capability is true", () => {
    features = { inventory: false, opportunities: true };
    renderDrawer();
    expect(registeredScreens).toContain("OpportunitiesTab");
    expect(registeredScreens).not.toContain("InventoryTab");
  });
});
