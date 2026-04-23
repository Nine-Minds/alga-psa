import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platformOS = { current: "ios" as "ios" | "android" | "web" };

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return platformOS.current;
    },
  },
}));

const isAvailableAsyncMock = vi.fn();
const signInAsyncMock = vi.fn();

vi.mock("expo-apple-authentication", () => ({
  isAvailableAsync: (...args: unknown[]) => isAvailableAsyncMock(...args),
  signInAsync: (...args: unknown[]) => signInAsyncMock(...args),
  AppleAuthenticationScope: {
    FULL_NAME: 0,
    EMAIL: 1,
  },
}));

describe("appleSignIn wrapper", () => {
  beforeEach(() => {
    platformOS.current = "ios";
    isAvailableAsyncMock.mockReset();
    signInAsyncMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("isAppleSignInAvailable returns false on Android without invoking the native check", async () => {
    platformOS.current = "android";
    const mod = await import("./appleSignIn");

    const result = await mod.isAppleSignInAvailable();

    expect(result).toBe(false);
    expect(isAvailableAsyncMock).not.toHaveBeenCalled();
  });

  it("isAppleSignInAvailable returns the native availability on iOS", async () => {
    isAvailableAsyncMock.mockResolvedValueOnce(true);
    const mod = await import("./appleSignIn");

    const result = await mod.isAppleSignInAvailable();

    expect(result).toBe(true);
    expect(isAvailableAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("isAppleSignInAvailable swallows native errors and returns false", async () => {
    isAvailableAsyncMock.mockRejectedValueOnce(new Error("native blew up"));
    const mod = await import("./appleSignIn");

    const result = await mod.isAppleSignInAvailable();

    expect(result).toBe(false);
  });

  it("signInWithApple throws AppleSignInUnavailableError on Android", async () => {
    platformOS.current = "android";
    const mod = await import("./appleSignIn");

    await expect(mod.signInWithApple()).rejects.toBeInstanceOf(mod.AppleSignInUnavailableError);
    expect(signInAsyncMock).not.toHaveBeenCalled();
  });

  it("signInWithApple throws AppleSignInUnavailableError when native availability is false", async () => {
    isAvailableAsyncMock.mockResolvedValueOnce(false);
    const mod = await import("./appleSignIn");

    await expect(mod.signInWithApple()).rejects.toBeInstanceOf(mod.AppleSignInUnavailableError);
    expect(signInAsyncMock).not.toHaveBeenCalled();
  });

  it("signInWithApple maps ERR_REQUEST_CANCELED to AppleSignInCancelledError", async () => {
    isAvailableAsyncMock.mockResolvedValueOnce(true);
    const cancellationError = Object.assign(new Error("cancelled"), { code: "ERR_REQUEST_CANCELED" });
    signInAsyncMock.mockRejectedValueOnce(cancellationError);
    const mod = await import("./appleSignIn");

    await expect(mod.signInWithApple()).rejects.toBeInstanceOf(mod.AppleSignInCancelledError);
  });

  it("signInWithApple rethrows unexpected native errors as-is", async () => {
    isAvailableAsyncMock.mockResolvedValueOnce(true);
    const failure = new Error("native exploded");
    signInAsyncMock.mockRejectedValueOnce(failure);
    const mod = await import("./appleSignIn");

    await expect(mod.signInWithApple()).rejects.toBe(failure);
  });

  it("signInWithApple errors when the credential omits identityToken", async () => {
    isAvailableAsyncMock.mockResolvedValueOnce(true);
    signInAsyncMock.mockResolvedValueOnce({
      identityToken: null,
      authorizationCode: "code",
      fullName: null,
      user: "001234.user",
      email: null,
    });
    const mod = await import("./appleSignIn");

    await expect(mod.signInWithApple()).rejects.toThrow(/identityToken/);
  });

  it("signInWithApple normalizes a successful credential into the wrapper shape", async () => {
    isAvailableAsyncMock.mockResolvedValueOnce(true);
    signInAsyncMock.mockResolvedValueOnce({
      identityToken: "id.tok",
      authorizationCode: "code-1",
      fullName: { givenName: "Ada", familyName: "Lovelace" },
      user: "001234.user",
      email: "ada@example.com",
    });
    const mod = await import("./appleSignIn");

    const result = await mod.signInWithApple();

    expect(result).toEqual({
      identityToken: "id.tok",
      authorizationCode: "code-1",
      fullName: { givenName: "Ada", familyName: "Lovelace" },
      user: "001234.user",
      email: "ada@example.com",
    });

    expect(signInAsyncMock).toHaveBeenCalledTimes(1);
    const call = signInAsyncMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.requestedScopes).toEqual([0, 1]);
  });

  it("signInWithApple coalesces missing optional fields to null", async () => {
    isAvailableAsyncMock.mockResolvedValueOnce(true);
    signInAsyncMock.mockResolvedValueOnce({
      identityToken: "id.tok",
      // no authorizationCode, no fullName, no email
      user: "001234.user",
    });
    const mod = await import("./appleSignIn");

    const result = await mod.signInWithApple();

    expect(result.authorizationCode).toBeNull();
    expect(result.fullName).toBeNull();
    expect(result.email).toBeNull();
    expect(result.identityToken).toBe("id.tok");
    expect(result.user).toBe("001234.user");
  });
});
