import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_URL,
  getAppConfig,
  hydrateAppConfig,
  isDefaultHost,
  isHostLocked,
  setActiveBaseUrl,
} from "./appConfig";

describe("appConfig resolution chain", () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_ALGA_BASE_URL;
    process.env.EXPO_PUBLIC_ALGA_ENV = "dev";
    setActiveBaseUrl(null);
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_ALGA_BASE_URL;
    setActiveBaseUrl(null);
  });

  it("falls back to the default host with no stored host", () => {
    hydrateAppConfig(null);
    const out = getAppConfig();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("uses the hydrated stored host over the default", () => {
    hydrateAppConfig("https://helpdesk.acme.com");
    const out = getAppConfig();
    if (out.ok) expect(out.baseUrl).toBe("https://helpdesk.acme.com");
  });

  it("prefers the build override over a stored host", () => {
    process.env.EXPO_PUBLIC_ALGA_BASE_URL = "https://whitelabel.example.com";
    hydrateAppConfig("https://helpdesk.acme.com");
    const out = getAppConfig();
    if (out.ok) expect(out.baseUrl).toBe("https://whitelabel.example.com");
  });

  it("rejects an invalid stored host and falls back to the default", () => {
    hydrateAppConfig("not a url");
    const out = getAppConfig();
    if (out.ok) expect(out.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("setActiveBaseUrl(null) reverts to the default", () => {
    hydrateAppConfig("https://helpdesk.acme.com");
    setActiveBaseUrl(null);
    const out = getAppConfig();
    if (out.ok) expect(out.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("resolves the default before hydration", () => {
    const out = getAppConfig();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("keeps hosted environment parsing", () => {
    process.env.EXPO_PUBLIC_ALGA_ENV = "prod";
    hydrateAppConfig(null);
    const out = getAppConfig();
    if (out.ok) expect(out.env).toBe("prod");
  });

  it("isDefaultHost matches the default hostname only", () => {
    expect(isDefaultHost(DEFAULT_BASE_URL)).toBe(true);
    expect(isDefaultHost("https://helpdesk.acme.com")).toBe(false);
    expect(isDefaultHost(null)).toBe(false);
    expect(isDefaultHost("garbage")).toBe(false);
  });

  it("isHostLocked reflects the build override", () => {
    expect(isHostLocked()).toBe(false);
    process.env.EXPO_PUBLIC_ALGA_BASE_URL = "https://whitelabel.example.com";
    expect(isHostLocked()).toBe(true);
  });
});
