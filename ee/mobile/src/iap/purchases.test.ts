import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";

type IapMocks = {
  initConnection: ReturnType<typeof vi.fn>;
  endConnection: ReturnType<typeof vi.fn>;
  getSubscriptions: ReturnType<typeof vi.fn>;
  requestSubscription: ReturnType<typeof vi.fn>;
  getAvailablePurchases: ReturnType<typeof vi.fn>;
  finishTransaction: ReturnType<typeof vi.fn>;
  purchaseUpdatedListener: ReturnType<typeof vi.fn>;
  purchaseErrorListener: ReturnType<typeof vi.fn>;
  purchaseRemove: ReturnType<typeof vi.fn>;
  errorRemove: ReturnType<typeof vi.fn>;
};

let mocks: IapMocks;

vi.mock("react-native-iap", () => {
  const purchaseRemove = vi.fn();
  const errorRemove = vi.fn();
  const m: IapMocks = {
    initConnection: vi.fn(async () => undefined),
    endConnection: vi.fn(async () => undefined),
    getSubscriptions: vi.fn(async () => []),
    requestSubscription: vi.fn(async () => undefined),
    getAvailablePurchases: vi.fn(async () => []),
    finishTransaction: vi.fn(async () => undefined),
    purchaseUpdatedListener: vi.fn(() => ({ remove: purchaseRemove })),
    purchaseErrorListener: vi.fn(() => ({ remove: errorRemove })),
    purchaseRemove,
    errorRemove,
  };
  mocks = m;
  return {
    initConnection: m.initConnection,
    endConnection: m.endConnection,
    getSubscriptions: m.getSubscriptions,
    requestSubscription: m.requestSubscription,
    getAvailablePurchases: m.getAvailablePurchases,
    finishTransaction: m.finishTransaction,
    purchaseUpdatedListener: m.purchaseUpdatedListener,
    purchaseErrorListener: m.purchaseErrorListener,
  };
});

async function loadPurchases() {
  return await import("./purchases");
}

const originalOS = Platform.OS;

beforeEach(async () => {
  // Reset purchases module state between tests without reloading the module
  // (reloading would also reload the react-native mock and lose Platform.OS).
  (Platform as { OS: string }).OS = "ios";
  const mod = await import("./purchases");
  await mod.closeIapConnection();
  mod.removePurchaseListeners();
  vi.clearAllMocks();
});

afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
});

describe("purchases — connection lifecycle", () => {
  it("ensureIapConnection throws on non-iOS platforms", async () => {
    (Platform as { OS: string }).OS = "android";
    const { ensureIapConnection } = await loadPurchases();

    await expect(ensureIapConnection()).rejects.toThrow("IAP is iOS-only");
    expect(mocks.initConnection).not.toHaveBeenCalled();
  });

  it("ensureIapConnection initializes once and is idempotent", async () => {
    const { ensureIapConnection } = await loadPurchases();

    await ensureIapConnection();
    await ensureIapConnection();
    await ensureIapConnection();

    expect(mocks.initConnection).toHaveBeenCalledTimes(1);
  });

  it("closeIapConnection is a no-op when never initialized", async () => {
    const { closeIapConnection } = await loadPurchases();

    await closeIapConnection();

    expect(mocks.endConnection).not.toHaveBeenCalled();
  });

  it("closeIapConnection tears down the connection and removes listeners", async () => {
    const {
      ensureIapConnection,
      installPurchaseListeners,
      closeIapConnection,
    } = await loadPurchases();

    await ensureIapConnection();
    installPurchaseListeners({
      onPurchaseComplete: vi.fn(),
      onPurchaseError: vi.fn(),
    });

    await closeIapConnection();

    expect(mocks.endConnection).toHaveBeenCalledTimes(1);
    expect(mocks.purchaseRemove).toHaveBeenCalledTimes(1);
    expect(mocks.errorRemove).toHaveBeenCalledTimes(1);
  });

  it("closeIapConnection resets state so subsequent ensureIapConnection re-initializes", async () => {
    const { ensureIapConnection, closeIapConnection } = await loadPurchases();

    await ensureIapConnection();
    await closeIapConnection();
    await ensureIapConnection();

    expect(mocks.initConnection).toHaveBeenCalledTimes(2);
    expect(mocks.endConnection).toHaveBeenCalledTimes(1);
  });
});

describe("purchases — fetchIapProducts", () => {
  it("maps StoreKit subscription shape to IapProduct", async () => {
    mocks.getSubscriptions.mockResolvedValueOnce([
      {
        productId: "com.nineminds.algapsa.solo.monthly",
        title: "Solo Monthly",
        description: "Solo plan",
        localizedPrice: "$49.99",
        currency: "USD",
        subscriptionPeriodUnitIOS: "P1M",
      },
    ]);
    const { fetchIapProducts, SOLO_MONTHLY_PRODUCT_ID } = await loadPurchases();

    const products = await fetchIapProducts();

    expect(mocks.getSubscriptions).toHaveBeenCalledWith({
      skus: [SOLO_MONTHLY_PRODUCT_ID],
    });
    expect(products).toEqual([
      {
        productId: "com.nineminds.algapsa.solo.monthly",
        title: "Solo Monthly",
        description: "Solo plan",
        localizedPrice: "$49.99",
        currency: "USD",
        subscriptionPeriod: "P1M",
      },
    ]);
  });

  it("falls back to defaults for missing fields", async () => {
    mocks.getSubscriptions.mockResolvedValueOnce([
      { productId: "com.nineminds.algapsa.solo.monthly" },
    ]);
    const { fetchIapProducts } = await loadPurchases();

    const [product] = await fetchIapProducts();

    expect(product).toEqual({
      productId: "com.nineminds.algapsa.solo.monthly",
      title: "com.nineminds.algapsa.solo.monthly",
      description: "",
      localizedPrice: "",
      currency: "USD",
      subscriptionPeriod: undefined,
    });
  });
});

describe("purchases — startSoloSubscription", () => {
  it("passes the product SKU and appAccountToken to StoreKit", async () => {
    const { startSoloSubscription, SOLO_MONTHLY_PRODUCT_ID } = await loadPurchases();

    await startSoloSubscription({ appAccountToken: "6ed9ee13-4b6a-4ef4-9c6e-3b1e5aa9b6cd" });

    expect(mocks.initConnection).toHaveBeenCalledTimes(1);
    expect(mocks.requestSubscription).toHaveBeenCalledWith({
      sku: SOLO_MONTHLY_PRODUCT_ID,
      appAccountToken: "6ed9ee13-4b6a-4ef4-9c6e-3b1e5aa9b6cd",
    });
  });
});

describe("purchases — restoreIapPurchases", () => {
  it("filters to known product IDs and prefers originalTransactionIdentifierIOS", async () => {
    mocks.getAvailablePurchases.mockResolvedValueOnce([
      {
        productId: "com.nineminds.algapsa.solo.monthly",
        originalTransactionIdentifierIOS: "1000000001",
        transactionIdentifierIOS: "1000000002",
        transactionId: "1000000003",
        transactionReceipt: "receipt-1",
      },
      {
        productId: "com.example.other",
        originalTransactionIdentifierIOS: "9999",
      },
    ]);
    const { restoreIapPurchases } = await loadPurchases();

    const restored = await restoreIapPurchases();

    expect(restored).toEqual([
      {
        productId: "com.nineminds.algapsa.solo.monthly",
        originalTransactionId: "1000000001",
        transactionReceipt: "receipt-1",
      },
    ]);
  });

  it("falls back through transactionIdentifierIOS, then transactionId", async () => {
    mocks.getAvailablePurchases.mockResolvedValueOnce([
      {
        productId: "com.nineminds.algapsa.solo.monthly",
        transactionIdentifierIOS: "tx-ios",
      },
      {
        productId: "com.nineminds.algapsa.solo.monthly",
        transactionId: "tx-id",
      },
    ]);
    const { restoreIapPurchases } = await loadPurchases();

    const restored = await restoreIapPurchases();

    expect(restored.map((p) => p.originalTransactionId)).toEqual(["tx-ios", "tx-id"]);
  });

  it("drops purchases with no recoverable transaction id", async () => {
    mocks.getAvailablePurchases.mockResolvedValueOnce([
      { productId: "com.nineminds.algapsa.solo.monthly" },
    ]);
    const { restoreIapPurchases } = await loadPurchases();

    expect(await restoreIapPurchases()).toEqual([]);
  });
});

describe("purchases — finishIapTransaction", () => {
  it("acknowledges the purchase as non-consumable", async () => {
    const { finishIapTransaction } = await loadPurchases();
    const purchase = { productId: "com.nineminds.algapsa.solo.monthly" } as never;

    await finishIapTransaction(purchase);

    expect(mocks.finishTransaction).toHaveBeenCalledWith({
      purchase,
      isConsumable: false,
    });
  });
});

describe("purchases — listeners", () => {
  it("installPurchaseListeners forwards purchases to onPurchaseComplete", async () => {
    const { installPurchaseListeners } = await loadPurchases();

    const onPurchaseComplete = vi.fn();
    const onPurchaseError = vi.fn();
    installPurchaseListeners({ onPurchaseComplete, onPurchaseError });

    const purchaseCb = mocks.purchaseUpdatedListener.mock.calls[0]?.[0] as (p: unknown) => void;
    const purchase = { transactionId: "tx-1" };
    purchaseCb(purchase);

    expect(onPurchaseComplete).toHaveBeenCalledWith(purchase);
  });

  it("installPurchaseListeners forwards errors to onPurchaseError", async () => {
    const { installPurchaseListeners } = await loadPurchases();

    const onPurchaseComplete = vi.fn();
    const onPurchaseError = vi.fn();
    installPurchaseListeners({ onPurchaseComplete, onPurchaseError });

    const errorCb = mocks.purchaseErrorListener.mock.calls[0]?.[0] as (e: unknown) => void;
    const err = new Error("boom");
    errorCb(err);

    expect(onPurchaseError).toHaveBeenCalledWith(err);
  });

  it("teardown returned by installPurchaseListeners removes both subscriptions", async () => {
    const { installPurchaseListeners } = await loadPurchases();

    const teardown = installPurchaseListeners({
      onPurchaseComplete: vi.fn(),
      onPurchaseError: vi.fn(),
    });

    teardown();

    expect(mocks.purchaseRemove).toHaveBeenCalledTimes(1);
    expect(mocks.errorRemove).toHaveBeenCalledTimes(1);
  });
});
