import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as WebBrowserModule from "expo-web-browser";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

vi.mock("expo-localization", () => ({
  getLocales: () => [{ languageTag: "en-US" }],
}));

vi.mock("expo-linking", () => ({
  createURL: (path: string) => `alga://${path}`,
  parse: (rawUrl: string) => {
    const u = new URL(rawUrl);
    return { scheme: u.protocol.replace(":", ""), hostname: u.hostname, path: u.pathname.replace(/^\//, "") };
  },
  getInitialURL: vi.fn(async () => null),
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
}));

let openAuthSessionResult: WebBrowserModule.WebBrowserAuthSessionResult = {
  type: "success",
  url: "alga://auth/callback?ott=test-ott&state=test-state",
};

vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync: vi.fn(async () => openAuthSessionResult),
}));

vi.mock("../config/appConfig", () => ({
  getAppConfig: () => ({ ok: true, baseUrl: "https://app.example.com", env: "dev" }),
}));

vi.mock("../api", () => ({
  createApiClient: () => ({ request: vi.fn() }),
}));

vi.mock("../api/mobileAuth", () => ({
  getAuthCapabilities: vi.fn(async () => ({
    ok: true,
    data: { hostedDomainAllowlist: [], providers: { microsoft: true } },
  })),
}));

vi.mock("../analytics/analytics", () => ({
  analytics: { trackEvent: vi.fn() },
}));

vi.mock("../logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe("SignInScreen auth flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openAuthSessionResult = {
      type: "success",
      url: "alga://auth/callback?ott=test-ott&state=test-state",
    };
  });

  it("uses WebBrowser.openAuthSessionAsync (not Linking.openURL)", async () => {
    const WebBrowser = await import("expo-web-browser");

    await WebBrowser.openAuthSessionAsync("https://app.example.com/auth/signin", "alga://auth/callback");

    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      "https://app.example.com/auth/signin",
      "alga://auth/callback",
    );
  });

  it("parseAuthCallback extracts ott and state from a success redirect URL", async () => {
    const { parseAuthCallback } = await import("../auth/mobileAuth");

    const result = parseAuthCallback("alga://auth/callback?ott=abc123&state=xyz789");

    expect(result.ott).toBe("abc123");
    expect(result.state).toBe("xyz789");
    expect(result.error).toBeUndefined();
  });

  it("parseAuthCallback extracts error from a failed redirect URL", async () => {
    const { parseAuthCallback } = await import("../auth/mobileAuth");

    const result = parseAuthCallback("alga://auth/callback?error=invalid_redirect");

    expect(result.error).toBe("invalid_redirect");
    expect(result.ott).toBeUndefined();
  });

  it("parseAuthCallback returns empty for non-callback URLs", async () => {
    const { parseAuthCallback } = await import("../auth/mobileAuth");

    const result = parseAuthCallback("alga://tickets");

    expect(result.ott).toBeUndefined();
    expect(result.state).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("buildWebSignInUrl produces a valid handoff URL with state", async () => {
    const { buildWebSignInUrl } = await import("../auth/mobileAuth");

    const url = buildWebSignInUrl({
      baseUrl: "https://app.example.com",
      redirectUri: "alga://auth/callback",
      state: "test-state-123",
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/auth/signin");
    const callbackUrl = new URL(parsed.searchParams.get("callbackUrl")!);
    expect(callbackUrl.pathname).toBe("/auth/mobile/handoff");
    expect(callbackUrl.searchParams.get("redirect")).toBe("alga://auth/callback");
    expect(callbackUrl.searchParams.get("state")).toBe("test-state-123");
  });

  it("getAuthCallbackRedirectUri returns alga:// scheme URL", async () => {
    const { getAuthCallbackRedirectUri } = await import("../auth/mobileAuth");

    const uri = getAuthCallbackRedirectUri();

    expect(uri).toContain("auth/callback");
  });

  it("handles cancel result from in-app browser", async () => {
    const WebBrowser = await import("expo-web-browser");
    openAuthSessionResult = { type: "cancel" };

    const result = await WebBrowser.openAuthSessionAsync("https://example.com", "alga://auth/callback");

    expect(result.type).toBe("cancel");
  });

  it("handles dismiss result from in-app browser", async () => {
    const WebBrowser = await import("expo-web-browser");
    openAuthSessionResult = { type: "dismiss" };

    const result = await WebBrowser.openAuthSessionAsync("https://example.com", "alga://auth/callback");

    expect(result.type).toBe("dismiss");
  });
});
