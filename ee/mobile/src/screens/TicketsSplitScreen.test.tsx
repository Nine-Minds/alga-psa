import React from "react";
import { Pressable, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  size: { width: 390, height: 844 },
  navigate: vi.fn(),
  refreshSession: vi.fn(),
  t: (key: string) => key,
}));

vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWindowDimensions: () => ({ ...mocks.size, scale: 2, fontScale: 1 }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ session: { accessToken: "key", tenantId: "t-1" }, refreshSession: mocks.refreshSession }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.test" }) }));
vi.mock("./TicketsListScreen", () => ({
  TicketsListScreen: (props: Record<string, unknown>) => React.createElement("MockTicketsList", props),
}));
vi.mock("./TicketDetailScreen", () => ({
  TicketDetailBody: (props: Record<string, unknown>) => React.createElement("MockTicketDetailBody", props),
}));

import { TicketsListRoute } from "./TicketsSplitScreen";

const navigation = { navigate: mocks.navigate, push: vi.fn() };

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(TicketsListRoute, { navigation, route: { key: "r", name: "Tickets" } } as never));
  });
  return renderer;
}

const byType = (r: ReactTestRenderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type);
const list = (r: ReactTestRenderer) => byType(r, "MockTicketsList")[0];
const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map((n) => String(n.props.children));
const button = (r: ReactTestRenderer, label: string) =>
  r.root.findAllByType(Pressable).find((p) => p.props.accessibilityLabel === label)!;

describe("TicketsListRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders only the list on a phone, without split selection wiring", async () => {
    mocks.size = { width: 390, height: 844 };
    const r = await render();
    expect(list(r).props.onSelectTicket).toBeUndefined();
    expect(list(r).props.selectedTicketId).toBeUndefined();
    expect(list(r).props.navigation).toBe(navigation);
    expect(byType(r, "MockTicketDetailBody")).toHaveLength(0);
    expect(texts(r)).not.toContain("split.empty");
  });

  it("does not split an opened foldable below the split width", async () => {
    mocks.size = { width: 951, height: 669 };
    const r = await render();
    expect(list(r).props.onSelectTicket).toBeUndefined();
  });

  describe("split panes (iPad landscape)", () => {
    beforeEach(() => {
      mocks.size = { width: 1180, height: 820 };
    });

    it("shows the empty detail pane until a ticket is selected", async () => {
      const r = await render();
      expect(typeof list(r).props.onSelectTicket).toBe("function");
      expect(list(r).props.selectedTicketId).toBeNull();
      expect(texts(r)).toEqual(expect.arrayContaining(["split.empty", "split.emptyHint"]));
      expect(byType(r, "MockTicketDetailBody")).toHaveLength(0);
    });

    it("opens the selected ticket in the right pane with the session and pane width", async () => {
      const r = await render();
      await act(async () => {
        list(r).props.onSelectTicket("tk-1");
      });
      expect(list(r).props.selectedTicketId).toBe("tk-1");
      const body = byType(r, "MockTicketDetailBody")[0];
      expect(body.props.ticketId).toBe("tk-1");
      expect(body.props.initialWidth).toBe(1180 - 380);
      expect(body.props.session).toEqual({ accessToken: "key", tenantId: "t-1" });
      expect(body.props.refreshSession).toBe(mocks.refreshSession);
      expect(body.props.config).toEqual(expect.objectContaining({ baseUrl: "https://algapsa.test" }));
    });

    it("puts the detail title in the pane header and treats goBack as closing the pane", async () => {
      const r = await render();
      await act(async () => {
        list(r).props.onSelectTicket("tk-1");
      });
      const body = () => byType(r, "MockTicketDetailBody")[0];
      expect(body().props.navigation.navigate).toBe(mocks.navigate);
      await act(async () => {
        body().props.navigation.setOptions({ title: "#42 Printer down" });
      });
      expect(texts(r)).toContain("#42 Printer down");
      await act(async () => {
        body().props.navigation.setOptions({});
      });
      expect(texts(r)).not.toContain("#42 Printer down");

      await act(async () => {
        body().props.navigation.goBack();
      });
      expect(byType(r, "MockTicketDetailBody")).toHaveLength(0);
      expect(list(r).props.selectedTicketId).toBeNull();
    });

    it("opens the ticket full screen and closes the pane from the header buttons", async () => {
      const r = await render();
      await act(async () => {
        list(r).props.onSelectTicket("tk-9");
      });
      await act(async () => {
        button(r, "split.openFullScreen").props.onPress();
      });
      expect(mocks.navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "tk-9" });

      await act(async () => {
        button(r, "split.closeDetail").props.onPress();
      });
      expect(texts(r)).toContain("split.empty");
    });
  });
});
