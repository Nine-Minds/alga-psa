import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  os: "ios" as string,
  configOk: true,
  navigate: vi.fn(),
  openURL: vi.fn(),
  fetchIapProducts: vi.fn(),
  restoreIapPurchases: vi.fn(),
  startSoloSubscription: vi.fn(),
  finishIapTransaction: vi.fn(),
  closeIapConnection: vi.fn(),
  teardown: vi.fn(),
  listeners: null as null | { onPurchaseComplete: (p: unknown) => Promise<void>; onPurchaseError: (e: unknown) => void },
  checkEmailExists: vi.fn(),
  provisionFromPurchase: vi.fn(),
  restorePurchase: vi.fn(),
  createPendingMobileAuth: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  translate: (key: string, def?: string) => def ?? key,
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return {
    ...actual,
    Platform: {
      get OS() {
        return mocks.os;
      },
    },
    Linking: { openURL: (...args: unknown[]) => mocks.openURL(...args) },
  };
});
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mocks.navigate }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) => React.createElement("PrimaryButton", props, props.children as React.ReactNode),
}));
vi.mock("../config/appConfig", () => ({
  getAppConfig: () => (mocks.configOk ? { ok: true, env: "dev", baseUrl: "https://algapsa.com" } : { ok: false, error: "missing" }),
}));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/iap", () => ({
  checkEmailExists: (...a: unknown[]) => mocks.checkEmailExists(...a),
  provisionFromPurchase: (...a: unknown[]) => mocks.provisionFromPurchase(...a),
  restorePurchase: (...a: unknown[]) => mocks.restorePurchase(...a),
}));
vi.mock("../iap/purchases", () => ({
  SOLO_MONTHLY_PRODUCT_ID: "solo.monthly",
  fetchIapProducts: () => mocks.fetchIapProducts(),
  restoreIapPurchases: () => mocks.restoreIapPurchases(),
  startSoloSubscription: (a: unknown) => mocks.startSoloSubscription(a),
  finishIapTransaction: (p: unknown) => mocks.finishIapTransaction(p),
  closeIapConnection: () => mocks.closeIapConnection(),
  installPurchaseListeners: (l: typeof mocks.listeners) => {
    mocks.listeners = l;
    return mocks.teardown;
  },
}));
vi.mock("../auth/mobileAuth", () => ({ createPendingMobileAuth: () => mocks.createPendingMobileAuth() }));
vi.mock("../logging/logger", () => ({ logger: mocks.logger }));

import { CreateWorkspaceScreen } from "./CreateWorkspaceScreen";

const PRODUCT = {
  productId: "solo.monthly",
  title: "AlgaPSA Solo",
  description: "One-person plan",
  localizedPrice: "$29.99",
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(CreateWorkspaceScreen));
  });
  await flush();
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

function inputs(renderer: ReactTestRenderer) {
  return renderer.root.findAll((n) => (n.type as unknown) === "TextInput");
}

async function fillForm(renderer: ReactTestRenderer, email: string, first = "", last = "", company = "") {
  const [emailInput, firstInput, lastInput, companyInput] = inputs(renderer);
  await act(async () => {
    emailInput.props.onChangeText(email);
    firstInput.props.onChangeText(first);
    lastInput.props.onChangeText(last);
    companyInput.props.onChangeText(company);
  });
}

function subscribeButton(renderer: ReactTestRenderer) {
  return renderer.root.find((n) => (n.type as unknown) === "PrimaryButton");
}

async function subscribe(renderer: ReactTestRenderer) {
  await act(async () => subscribeButton(renderer).props.onPress());
  await flush();
}

async function restore(renderer: ReactTestRenderer) {
  await act(async () => {
    renderer.root.find((n) => n.props?.accessibilityLabel === "Restore Purchases" && n.props.accessibilityRole === "button").props.onPress();
  });
  await flush();
}

describe("CreateWorkspaceScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.os = "ios";
    mocks.configOk = true;
    mocks.listeners = null;
    mocks.fetchIapProducts.mockResolvedValue([PRODUCT]);
    mocks.checkEmailExists.mockResolvedValue({ ok: true, data: { exists: false } });
    mocks.startSoloSubscription.mockResolvedValue(undefined);
    mocks.createPendingMobileAuth.mockResolvedValue({ state: "state-1" });
    mocks.finishIapTransaction.mockResolvedValue(undefined);
    mocks.closeIapConnection.mockResolvedValue(undefined);
  });

  it("shows an iOS-only notice on Android and never touches StoreKit", async () => {
    mocks.os = "android";
    const renderer = await renderScreen();
    expect(texts(renderer).some((t) => t.startsWith("Subscriptions from this app are only available on iOS"))).toBe(true);
    expect(mocks.fetchIapProducts).not.toHaveBeenCalled();
    expect(mocks.listeners).toBeNull();
  });

  it("renders the Solo product with its localized price", async () => {
    const renderer = await renderScreen();
    const all = texts(renderer);
    expect(all).toContain("AlgaPSA Solo");
    expect(all).toContain("One-person plan");
    expect(all.some((t) => t.startsWith("$29.99"))).toBe(true);
    expect(subscribeButton(renderer).props.children).toBe("Subscribe");
  });

  it("reports when no products are available or the App Store cannot be reached", async () => {
    mocks.fetchIapProducts.mockResolvedValue([]);
    let renderer = await renderScreen();
    expect(texts(renderer)).toContain("Subscription is temporarily unavailable.");

    mocks.fetchIapProducts.mockRejectedValue(new Error("StoreKit down"));
    renderer = await renderScreen();
    expect(texts(renderer)).toContain("Unable to contact the App Store.");
  });

  it("rejects an invalid email before calling the server", async () => {
    const renderer = await renderScreen();
    await fillForm(renderer, "not-an-email");
    await subscribe(renderer);
    expect(texts(renderer)).toContain("Enter a valid email address.");
    expect(mocks.checkEmailExists).not.toHaveBeenCalled();
  });

  it("reports a missing base URL", async () => {
    mocks.configOk = false;
    const renderer = await renderScreen();
    await fillForm(renderer, "a@b.co");
    await subscribe(renderer);
    expect(texts(renderer)).toContain("App is not configured.");
  });

  it("blocks the purchase when an account already exists for the email", async () => {
    mocks.checkEmailExists.mockResolvedValue({ ok: true, data: { exists: true } });
    const renderer = await renderScreen();
    await fillForm(renderer, "  owner@msp.com  ");
    await subscribe(renderer);
    expect(mocks.checkEmailExists).toHaveBeenCalledWith(expect.anything(), { email: "owner@msp.com" });
    expect(texts(renderer).some((t) => t.startsWith("An account already exists for this email"))).toBe(true);
    expect(mocks.startSoloSubscription).not.toHaveBeenCalled();
  });

  it("reports a failed or thrown email check", async () => {
    mocks.checkEmailExists.mockResolvedValueOnce({ ok: false, status: 500, error: { message: "x" } });
    const renderer = await renderScreen();
    await fillForm(renderer, "owner@msp.com");
    await subscribe(renderer);
    expect(texts(renderer)).toContain("Unable to verify email availability. Please try again.");

    mocks.checkEmailExists.mockRejectedValueOnce(new Error("offline"));
    await subscribe(renderer);
    expect(texts(renderer)).toContain("Unable to verify email availability. Please try again.");
    expect(mocks.startSoloSubscription).not.toHaveBeenCalled();
  });

  it("keeps Subscribe disabled when the product never loaded", async () => {
    mocks.fetchIapProducts.mockResolvedValue([]);
    const renderer = await renderScreen();
    await fillForm(renderer, "owner@msp.com");
    expect(subscribeButton(renderer).props.disabled).toBe(true);
    expect(texts(renderer)).toContain("Subscription is temporarily unavailable.");
  });

  it("starts the purchase, then provisions with the latched form values and hands off to AuthCallback", async () => {
    mocks.provisionFromPurchase.mockResolvedValue({ ok: true, data: { ott: "ott-1" } });
    const renderer = await renderScreen();
    await fillForm(renderer, "owner@msp.com", " Ann ", " Lee ", " Lee IT ");
    await subscribe(renderer);

    expect(mocks.startSoloSubscription).toHaveBeenCalledTimes(1);
    const { appAccountToken } = mocks.startSoloSubscription.mock.calls[0][0] as { appAccountToken: string };
    expect(appAccountToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(subscribeButton(renderer).props.disabled).toBe(true);
    expect(subscribeButton(renderer).props.children).toBe("Processing payment…");

    // Edits after tapping Subscribe must not change what gets provisioned.
    await act(async () => inputs(renderer)[3].props.onChangeText("Changed"));

    const purchase = { transactionIdentifierIOS: "tx-1", originalTransactionIdentifierIOS: "orig-1" };
    await act(async () => {
      await mocks.listeners!.onPurchaseComplete(purchase);
    });
    await flush();

    expect(mocks.provisionFromPurchase).toHaveBeenCalledWith(expect.anything(), {
      originalTransactionId: "orig-1",
      appAccountToken,
      emailHint: "owner@msp.com",
      firstName: "Ann",
      lastName: "Lee",
      workspaceName: "Lee IT",
      state: "state-1",
    });
    expect(mocks.finishIapTransaction).toHaveBeenCalledWith(purchase);
    expect(mocks.navigate).toHaveBeenCalledWith("AuthCallback", { ott: "ott-1", state: "state-1" });

    // Re-delivery of the same transaction is ignored.
    await act(async () => {
      await mocks.listeners!.onPurchaseComplete(purchase);
    });
    expect(mocks.provisionFromPurchase).toHaveBeenCalledTimes(1);
  });

  it("still navigates when finishing the transaction fails", async () => {
    mocks.provisionFromPurchase.mockResolvedValue({ ok: true, data: { ott: "ott-2" } });
    mocks.finishIapTransaction.mockRejectedValue(new Error("finish failed"));
    const renderer = await renderScreen();
    await fillForm(renderer, "owner@msp.com");
    await subscribe(renderer);
    await act(async () => {
      await mocks.listeners!.onPurchaseComplete({ transactionId: "tx-2" });
    });
    expect(mocks.provisionFromPurchase.mock.calls[0][1]).toMatchObject({
      originalTransactionId: "tx-2",
      firstName: undefined,
      lastName: undefined,
      workspaceName: undefined,
    });
    expect(mocks.logger.warn).toHaveBeenCalledWith("finishTransaction failed (non-fatal)", expect.anything());
    expect(mocks.navigate).toHaveBeenCalledWith("AuthCallback", { ott: "ott-2", state: "state-1" });
  });

  it("does not finish the transaction when provisioning fails, and reports it", async () => {
    mocks.provisionFromPurchase.mockResolvedValueOnce({ ok: false, status: 500, error: { message: "x" } });
    const renderer = await renderScreen();
    await fillForm(renderer, "owner@msp.com");
    await subscribe(renderer);
    await act(async () => {
      await mocks.listeners!.onPurchaseComplete({ transactionId: "tx-3" });
    });
    expect(mocks.finishIapTransaction).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(texts(renderer).some((t) => t.startsWith("Purchase went through but we couldn't provision"))).toBe(true);
    expect(subscribeButton(renderer).props.disabled).toBe(false);

    mocks.provisionFromPurchase.mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      await mocks.listeners!.onPurchaseComplete({ transactionId: "tx-4" });
    });
    expect(mocks.logger.error).toHaveBeenCalledWith("Provisioning threw", expect.anything());
  });

  it("ignores purchase events without a transaction id or without a pending purchase", async () => {
    await renderScreen();
    await act(async () => {
      await mocks.listeners!.onPurchaseComplete({});
      await mocks.listeners!.onPurchaseComplete({ transactionId: "stray" });
    });
    expect(mocks.provisionFromPurchase).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith("Purchase complete with no transaction ID", expect.anything());
    expect(mocks.logger.warn).toHaveBeenCalledWith("Purchase complete but no pending context — skipping", { txId: "stray" });
  });

  it("reports a failed StoreKit purchase start", async () => {
    mocks.startSoloSubscription.mockRejectedValue(new Error("nope"));
    const renderer = await renderScreen();
    await fillForm(renderer, "owner@msp.com");
    await subscribe(renderer);
    expect(texts(renderer)).toContain("Purchase could not be completed.");
  });

  it("swallows user cancellation but shows other purchase errors", async () => {
    const renderer = await renderScreen();
    await act(async () => mocks.listeners!.onPurchaseError({ code: "E_USER_CANCELLED" }));
    expect(mocks.logger.error).not.toHaveBeenCalled();

    await act(async () => mocks.listeners!.onPurchaseError({ code: "E_NETWORK", message: "Network lost" }));
    expect(texts(renderer)).toContain("Network lost");

    await act(async () => mocks.listeners!.onPurchaseError({ code: "E_UNKNOWN" }));
    expect(texts(renderer)).toContain("Purchase could not be completed.");
  });

  describe("restore", () => {
    it("restores a provisioned purchase and hands off to AuthCallback", async () => {
      mocks.restoreIapPurchases.mockResolvedValue([{ productId: "solo.monthly", originalTransactionId: "orig-9" }]);
      mocks.restorePurchase.mockResolvedValue({ ok: true, data: { ott: "ott-9" } });
      const renderer = await renderScreen();
      await restore(renderer);
      expect(mocks.restorePurchase).toHaveBeenCalledWith(expect.anything(), { originalTransactionId: "orig-9", state: "state-1" });
      expect(mocks.navigate).toHaveBeenCalledWith("AuthCallback", { ott: "ott-9", state: "state-1" });
    });

    it("explains when there is nothing to restore", async () => {
      mocks.restoreIapPurchases.mockResolvedValue([{ productId: "other", originalTransactionId: "x" }]);
      const renderer = await renderScreen();
      await restore(renderer);
      expect(texts(renderer)).toContain("No prior purchase was found on this Apple ID.");
      expect(mocks.restorePurchase).not.toHaveBeenCalled();
    });

    it("distinguishes a never-provisioned purchase (404) from other failures", async () => {
      mocks.restoreIapPurchases.mockResolvedValue([{ productId: "solo.monthly", originalTransactionId: "orig-9" }]);
      mocks.restorePurchase.mockResolvedValueOnce({ ok: false, status: 404, error: { message: "nf" } });
      const renderer = await renderScreen();
      await restore(renderer);
      expect(texts(renderer).some((t) => t.startsWith("This purchase hasn't been used to create a workspace yet"))).toBe(true);

      mocks.restorePurchase.mockResolvedValueOnce({ ok: false, status: 500, error: { message: "x" } });
      await restore(renderer);
      expect(texts(renderer)).toContain("Unable to restore your purchase.");

      mocks.restoreIapPurchases.mockRejectedValueOnce(new Error("StoreKit"));
      await restore(renderer);
      expect(mocks.logger.error).toHaveBeenCalledWith("Restore threw", expect.anything());
      expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it("reports a missing base URL", async () => {
      mocks.configOk = false;
      const renderer = await renderScreen();
      await restore(renderer);
      expect(texts(renderer)).toContain("App is not configured.");
      expect(mocks.restoreIapPurchases).not.toHaveBeenCalled();
    });
  });

  it("opens the hosted terms and privacy pages", async () => {
    const renderer = await renderScreen();
    await act(async () => {
      renderer.root.find((n) => n.props?.accessibilityLabel === "Terms of Use" && n.props.onPress).props.onPress();
      renderer.root.find((n) => n.props?.accessibilityLabel === "Privacy Policy" && n.props.onPress).props.onPress();
    });
    expect(mocks.openURL).toHaveBeenCalledWith("https://algapsa.com/static/master_terms");
    expect(mocks.openURL).toHaveBeenCalledWith("https://algapsa.com/static/privacy_policy");
  });

  it("removes the purchase listeners and closes the StoreKit connection on unmount", async () => {
    const renderer = await renderScreen();
    await act(async () => renderer.unmount());
    expect(mocks.teardown).toHaveBeenCalled();
    expect(mocks.closeIapConnection).toHaveBeenCalled();
  });
});
