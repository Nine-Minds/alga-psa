import { describe, expect, it, vi } from "vitest";

vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `alga://${path}` }));
vi.mock("../logging/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { logger } from "../logging/logger";
import { clearWebSignInSession } from "./webSession";

describe("clearWebSignInSession", () => {
  it("opens the server sign-out with the app's signed-out redirect", async () => {
    const opener = vi.fn().mockResolvedValue({ type: "success" });
    await clearWebSignInSession("https://psa.example.com", opener);

    expect(opener).toHaveBeenCalledTimes(1);
    const [url, redirectUrl] = opener.mock.calls[0] as [string, string];
    expect(redirectUrl).toBe("alga://auth/signed-out");
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://psa.example.com");
    expect(parsed.pathname).toBe("/auth/mobile/signout");
    expect(parsed.searchParams.get("redirect")).toBe("alga://auth/signed-out");
  });

  it("never throws when the browser cannot be opened", async () => {
    const opener = vi.fn().mockRejectedValue(new Error("no browser"));
    await expect(clearWebSignInSession("https://psa.example.com", opener)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
