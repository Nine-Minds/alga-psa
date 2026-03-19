import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const {
  clearPendingMobileAuthMock,
  clearReceivedOttMock,
  createApiClientMock,
  exchangeOttWithRetryMock,
  getPendingMobileAuthMock,
  getTicketStatsMock,
  setSessionMock,
  storeReceivedOttMock,
} = vi.hoisted(() => ({
  clearPendingMobileAuthMock: vi.fn(),
  clearReceivedOttMock: vi.fn(),
  createApiClientMock: vi.fn(),
  exchangeOttWithRetryMock: vi.fn(),
  getPendingMobileAuthMock: vi.fn(),
  getTicketStatsMock: vi.fn(),
  setSessionMock: vi.fn(),
  storeReceivedOttMock: vi.fn(),
}));

vi.mock("expo-application", () => ({
  default: {
    nativeApplicationVersion: "1.0.0",
    nativeBuildVersion: "1",
  },
  nativeApplicationVersion: "1.0.0",
  nativeBuildVersion: "1",
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    setSession: (...args: unknown[]) => setSessionMock(...args),
  }),
}));

vi.mock("../auth/mobileAuth", () => ({
  clearPendingMobileAuth: () => clearPendingMobileAuthMock(),
  clearReceivedOtt: () => clearReceivedOttMock(),
  getPendingMobileAuth: () => getPendingMobileAuthMock(),
  storeReceivedOtt: (...args: unknown[]) => storeReceivedOttMock(...args),
}));

vi.mock("../config/appConfig", () => ({
  getAppConfig: () => ({
    ok: true,
    baseUrl: "https://example.com",
  }),
}));

vi.mock("../api", () => ({
  createApiClient: (...args: unknown[]) => createApiClientMock(...args),
}));

vi.mock("../api/mobileAuth", () => ({
  exchangeOttWithRetry: (...args: unknown[]) => exchangeOttWithRetryMock(...args),
}));

vi.mock("../api/tickets", () => ({
  getTicketStats: (...args: unknown[]) => getTicketStatsMock(...args),
}));

vi.mock("../device/clientMetadata", () => ({
  getStableDeviceId: async () => "device-1",
}));

vi.mock("../analytics/analytics", () => ({
  analytics: {
    trackEvent: vi.fn(),
  },
}));

vi.mock("../ui/states", () => ({
  ErrorState: (props: Record<string, unknown>) => React.createElement("MockErrorState", props),
  LoadingState: (props: Record<string, unknown>) => React.createElement("MockLoadingState", props),
}));

vi.mock("../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) =>
    React.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
}));

import { AuthCallbackScreen } from "./AuthCallbackScreen";

function encodeBase64Url(value: string): string {
  const maybeBuffer = (globalThis as typeof globalThis & {
    Buffer?: {
      from: (input: string, encoding: string) => { toString: (outputEncoding: string) => string };
    };
  }).Buffer;
  if (!maybeBuffer) {
    throw new Error("Buffer is not available in this test environment");
  }

  return maybeBuffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderScreen(params: Record<string, unknown>): {
  renderer: ReactTestRenderer;
  navigation: { reset: ReturnType<typeof vi.fn> };
} {
  const navigation = {
    reset: vi.fn(),
  };

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      React.createElement(AuthCallbackScreen, {
        navigation,
        route: {
          key: "AuthCallback-test",
          name: "AuthCallback",
          params,
        },
      } as never),
    );
  });

  if (!renderer) {
    throw new Error("Renderer was not created");
  }

  return { renderer, navigation };
}

describe("AuthCallbackScreen dev QA session import", () => {
  beforeEach(() => {
    clearPendingMobileAuthMock.mockReset();
    clearReceivedOttMock.mockReset();
    createApiClientMock.mockReset();
    exchangeOttWithRetryMock.mockReset();
    getPendingMobileAuthMock.mockReset();
    getTicketStatsMock.mockReset();
    setSessionMock.mockReset();
    storeReceivedOttMock.mockReset();

    clearPendingMobileAuthMock.mockResolvedValue(undefined);
    clearReceivedOttMock.mockResolvedValue(undefined);
    getPendingMobileAuthMock.mockResolvedValue({
      state: "state-123",
    });
    storeReceivedOttMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("imports a dev QA session without triggering the OTT exchange path", async () => {
    const qaSession = encodeBase64Url(
      JSON.stringify({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAtMs: 123456789,
        tenantId: "tenant-1",
        user: {
          id: "user-1",
          email: "qa@example.com",
          name: "QA User",
        },
      }),
    );

    const { navigation } = renderScreen({
      qaSession,
      qaTargetTicketId: "ticket-123",
      qaScenario: "richtext-smoke",
    });

    await flushAsync();

    expect(setSessionMock).toHaveBeenCalledWith({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAtMs: 123456789,
      tenantId: "tenant-1",
      user: {
        id: "user-1",
        email: "qa@example.com",
        name: "QA User",
      },
    });
    expect(clearPendingMobileAuthMock).toHaveBeenCalled();
    expect(clearReceivedOttMock).toHaveBeenCalled();
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 1,
      routes: [
        { name: "Tabs" },
        {
          name: "TicketDetail",
          params: {
            ticketId: "ticket-123",
            qaScenario: "richtext-smoke",
          },
        },
      ],
    });
    expect(createApiClientMock).not.toHaveBeenCalled();
    expect(exchangeOttWithRetryMock).not.toHaveBeenCalled();
    expect(getTicketStatsMock).not.toHaveBeenCalled();
  });

  it("completes a normal OTT exchange without forcing a navigator reset", async () => {
    exchangeOttWithRetryMock.mockResolvedValue({
      ok: true,
      data: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresInSec: 60,
        tenantId: "tenant-1",
        user: {
          id: "user-1",
          email: "qa@example.com",
          name: "QA User",
        },
      },
    });
    getTicketStatsMock.mockResolvedValue({
      ok: true,
      data: {
        data: {
          active: 1,
          overdue: 0,
          unassigned: 0,
          dueToday: 0,
        },
      },
    });

    const { navigation } = renderScreen({
      ott: "ott-123",
      state: "state-123",
    });

    await flushAsync();

    expect(exchangeOttWithRetryMock).toHaveBeenCalled();
    expect(setSessionMock).toHaveBeenCalledWith({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAtMs: expect.any(Number),
      tenantId: "tenant-1",
      user: {
        id: "user-1",
        email: "qa@example.com",
        name: "QA User",
      },
    });
    expect(clearPendingMobileAuthMock).toHaveBeenCalled();
    expect(clearReceivedOttMock).toHaveBeenCalled();
    expect(storeReceivedOttMock).toHaveBeenCalledWith("ott-123", "state-123");
    expect(navigation.reset).not.toHaveBeenCalled();
  });

  it("allows a dev QA OTT exchange without requiring pending browser state", async () => {
    getPendingMobileAuthMock.mockResolvedValue(null);
    exchangeOttWithRetryMock.mockResolvedValue({
      ok: true,
      data: {
        accessToken: "qa-access-token",
        refreshToken: "qa-refresh-token",
        expiresInSec: 60,
        tenantId: "tenant-qa",
        user: {
          id: "user-qa",
          email: "qa@example.com",
          name: "QA User",
        },
      },
    });
    getTicketStatsMock.mockResolvedValue({
      ok: true,
      data: {
        data: {
          active: 1,
          overdue: 0,
          unassigned: 0,
          dueToday: 0,
        },
      },
    });

    const { navigation } = renderScreen({
      qaOtt: "qa-ott-123",
      qaState: "qa-state-123",
    });

    await flushAsync();

    expect(exchangeOttWithRetryMock).toHaveBeenCalled();
    expect(setSessionMock).toHaveBeenCalledWith({
      accessToken: "qa-access-token",
      refreshToken: "qa-refresh-token",
      expiresAtMs: expect.any(Number),
      tenantId: "tenant-qa",
      user: {
        id: "user-qa",
        email: "qa@example.com",
        name: "QA User",
      },
    });
    expect(storeReceivedOttMock).not.toHaveBeenCalled();
    expect(navigation.reset).not.toHaveBeenCalled();
  });
});
