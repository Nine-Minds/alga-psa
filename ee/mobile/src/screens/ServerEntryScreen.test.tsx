import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
const mockReplace = vi.fn();
let routeParams: { url?: string } | undefined;

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace }),
  useRoute: () => ({ params: routeParams }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockSetHost = vi.fn(async () => undefined);
const mockClearHost = vi.fn(async () => undefined);
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    setSession: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    baseUrl: "https://algapsa.com",
    setHost: mockSetHost,
    clearHost: mockClearHost,
  }),
}));

const mockGetAuthCapabilities = vi.fn();
vi.mock("../api/mobileAuth", () => ({
  getAuthCapabilities: (...args: unknown[]) => mockGetAuthCapabilities(...args),
}));

vi.mock("../api", () => ({
  createApiClient: (options: { baseUrl: string }) => ({ baseUrl: options.baseUrl }),
}));

vi.mock("expo-camera", () => ({
  CameraView: (props: Record<string, unknown>) =>
    React.createElement("CameraView", props, props.children as React.ReactNode),
  useCameraPermissions: () => [{ granted: true }, vi.fn(async () => ({ granted: true }))],
}));

vi.mock("../logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) =>
    React.createElement("Pressable", props, props.children as React.ReactNode),
}));

import { ServerEntryScreen } from "./ServerEntryScreen";

function renderScreen(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(React.createElement(ServerEntryScreen));
  });
  return tree;
}

function getInput(tree: ReactTestRenderer) {
  return tree.root.findAll((node) => String(node.type) === "TextInput")[0]!;
}

function pressText(tree: ReactTestRenderer, label: string) {
  const node = tree.root.findAll(
    (n) => String(n.type) === "Text" && typeof n.props.onPress === "function" && n.props.accessibilityLabel === label,
  )[0]!;
  act(() => {
    node.props.onPress();
  });
}

async function pressConnect(tree: ReactTestRenderer) {
  const pressable = tree.root.findAll(
    (n) => String(n.type) === "Pressable" && n.props.accessibilityLabel === "serverEntry.connect",
  )[0]!;
  await act(async () => {
    pressable.props.onPress();
  });
}

function hasText(tree: ReactTestRenderer, text: string): boolean {
  return tree.root.findAll((n) => String(n.type) === "Text" && n.props.children === text).length > 0;
}

describe("ServerEntryScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParams = undefined;
    mockGetAuthCapabilities.mockResolvedValue({
      ok: true,
      data: { providers: { microsoft: true, google: false } },
    });
  });

  it("validates a reachable Alga server, saves the host, and navigates to SignIn", async () => {
    const tree = renderScreen();
    act(() => {
      getInput(tree).props.onChangeText("helpdesk.acme.com");
    });
    await pressConnect(tree);

    expect(mockGetAuthCapabilities).toHaveBeenCalledWith({ baseUrl: "https://helpdesk.acme.com" });
    expect(mockSetHost).toHaveBeenCalledWith("https://helpdesk.acme.com");
    expect(mockNavigate).toHaveBeenCalledWith("SignIn");
  });

  it("shows the unreachable error on network failure", async () => {
    mockGetAuthCapabilities.mockResolvedValue({ ok: false, error: { kind: "network" } });
    const tree = renderScreen();
    act(() => {
      getInput(tree).props.onChangeText("helpdesk.acme.com");
    });
    await pressConnect(tree);

    expect(hasText(tree, "serverEntry.errors.unreachable")).toBe(true);
    expect(mockSetHost).not.toHaveBeenCalled();
  });

  it("shows the not-an-Alga-server error on non-network failure", async () => {
    mockGetAuthCapabilities.mockResolvedValue({ ok: false, error: { kind: "http", status: 404 } });
    const tree = renderScreen();
    act(() => {
      getInput(tree).props.onChangeText("helpdesk.acme.com");
    });
    await pressConnect(tree);

    expect(hasText(tree, "serverEntry.errors.notAlga")).toBe(true);
    expect(mockSetHost).not.toHaveBeenCalled();
  });

  it("refuses a server that reports mobile sign-in disabled (CE)", async () => {
    mockGetAuthCapabilities.mockResolvedValue({
      ok: true,
      data: { enabled: false, providers: { microsoft: false, google: false } },
    });
    const tree = renderScreen();
    act(() => {
      getInput(tree).props.onChangeText("helpdesk.acme.com");
    });
    await pressConnect(tree);

    expect(hasText(tree, "serverEntry.errors.mobileNotAvailable")).toBe(true);
    expect(mockSetHost).not.toHaveBeenCalled();
  });

  it("treats a 200 without a capabilities shape as not an Alga server", async () => {
    mockGetAuthCapabilities.mockResolvedValue({ ok: true, data: { hello: "world" } });
    const tree = renderScreen();
    act(() => {
      getInput(tree).props.onChangeText("helpdesk.acme.com");
    });
    await pressConnect(tree);

    expect(hasText(tree, "serverEntry.errors.notAlga")).toBe(true);
    expect(mockSetHost).not.toHaveBeenCalled();
  });

  it("rejects an invalid URL without calling the network", async () => {
    const tree = renderScreen();
    act(() => {
      getInput(tree).props.onChangeText("ftp://insecure.acme.com");
    });
    await pressConnect(tree);

    expect(hasText(tree, "serverEntry.errors.invalidUrl")).toBe(true);
    expect(mockGetAuthCapabilities).not.toHaveBeenCalled();
  });

  it("prefills from a scanned QR without auto-saving", async () => {
    const tree = renderScreen();
    pressText(tree, "serverEntry.scanQr");

    const camera = tree.root.findAll((n) => String(n.type) === "CameraView")[0]!;
    act(() => {
      camera.props.onBarcodeScanned({ data: "alga://server?url=https%3A%2F%2Fhelpdesk.acme.com" });
    });

    expect(getInput(tree).props.value).toBe("https://helpdesk.acme.com");
    expect(mockSetHost).not.toHaveBeenCalled();
  });

  it("shows an error for a QR with no server payload", async () => {
    const tree = renderScreen();
    pressText(tree, "serverEntry.scanQr");

    const camera = tree.root.findAll((n) => String(n.type) === "CameraView")[0]!;
    act(() => {
      camera.props.onBarcodeScanned({ data: "hello world not a url" });
    });

    expect(hasText(tree, "serverEntry.errors.invalidQr")).toBe(true);
    expect(mockSetHost).not.toHaveBeenCalled();
  });

  it("prefills from a deep-link param without auto-saving", () => {
    routeParams = { url: "alga://server?url=https%3A%2F%2Fhelpdesk.acme.com" };
    const tree = renderScreen();

    expect(getInput(tree).props.value).toBe("https://helpdesk.acme.com");
    expect(mockSetHost).not.toHaveBeenCalled();
  });

  it("resets to Alga Cloud via clearHost", async () => {
    const tree = renderScreen();
    const node = tree.root.findAll(
      (n) =>
        String(n.type) === "Text" &&
        typeof n.props.onPress === "function" &&
        n.props.accessibilityLabel === "serverEntry.useCloud",
    )[0]!;
    await act(async () => {
      node.props.onPress();
    });

    expect(mockClearHost).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("SignIn");
  });
});
