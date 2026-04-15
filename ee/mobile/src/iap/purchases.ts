/**
 * react-native-iap wrapper for the iOS Solo subscription.
 *
 * Everything in this file is iOS-only. Callers should gate on
 * `Platform.OS === 'ios'` before importing; Android pulls in a dead module.
 *
 * The product catalog is intentionally a single auto-renewable subscription.
 * Do not add more products here without talking to the IAP story as a whole —
 * App Store review notes, paywall UX, pricing, etc. all depend on there
 * being exactly one iOS-purchasable plan.
 */
import { Platform } from "react-native";
import {
  initConnection,
  endConnection,
  getSubscriptions,
  requestSubscription,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  flushFailedPurchasesCachedAsPendingAndroid,
  type Subscription,
  type SubscriptionPurchase,
  type PurchaseError,
} from "react-native-iap";
import { logger } from "../logging/logger";

/** Product ID for the Solo monthly subscription. Must match App Store Connect. */
export const SOLO_MONTHLY_PRODUCT_ID = "com.nineminds.algapsa.solo.monthly";

export const IAP_PRODUCT_IDS = [SOLO_MONTHLY_PRODUCT_ID] as const;

export type IapProduct = {
  productId: string;
  title: string;
  description: string;
  localizedPrice: string;
  currency: string;
  subscriptionPeriod?: string; // 'P1M', etc.
};

export type PurchaseCallbacks = {
  onPurchaseComplete: (purchase: SubscriptionPurchase) => void | Promise<void>;
  onPurchaseError: (error: PurchaseError | Error) => void;
};

let connectionInitialized = false;
let purchaseSub: ReturnType<typeof purchaseUpdatedListener> | null = null;
let errorSub: ReturnType<typeof purchaseErrorListener> | null = null;

/**
 * Ensure the StoreKit connection is open. Safe to call multiple times.
 * On iOS this primes the connection; on Android it's a no-op because the
 * entire module is gated on Platform.OS.
 */
export async function ensureIapConnection(): Promise<void> {
  if (Platform.OS !== "ios") {
    throw new Error("IAP is iOS-only");
  }
  if (connectionInitialized) return;
  await initConnection();
  // Android-only but harmless when called from iOS guards.
  await flushFailedPurchasesCachedAsPendingAndroid().catch(() => undefined);
  connectionInitialized = true;
}

/**
 * Close the StoreKit connection. Call on sign-out or screen unmount to free
 * native resources. Listeners must be removed separately.
 */
export async function closeIapConnection(): Promise<void> {
  if (!connectionInitialized) return;
  removePurchaseListeners();
  try {
    await endConnection();
  } finally {
    connectionInitialized = false;
  }
}

/** Fetch StoreKit product metadata for the paywall UI. */
export async function fetchIapProducts(): Promise<IapProduct[]> {
  await ensureIapConnection();
  const products = (await getSubscriptions({ skus: [...IAP_PRODUCT_IDS] })) as Subscription[];

  return products.map((p: any) => ({
    productId: p.productId,
    title: p.title ?? p.productId,
    description: p.description ?? "",
    localizedPrice: p.localizedPrice ?? p.price ?? "",
    currency: p.currency ?? "USD",
    subscriptionPeriod: p.subscriptionPeriodUnitIOS ?? p.subscriptionPeriodNumberIOS,
  }));
}

/**
 * Attach purchase listeners. Returns a teardown function. Only register once
 * per screen — calling again without teardown will produce duplicate callbacks.
 */
export function installPurchaseListeners({
  onPurchaseComplete,
  onPurchaseError,
}: PurchaseCallbacks): () => void {
  purchaseSub = purchaseUpdatedListener((purchase) => {
    // Fire-and-forget; consumer is expected to finish the transaction after
    // their server has validated the receipt.
    void Promise.resolve(onPurchaseComplete(purchase as SubscriptionPurchase)).catch((e) => {
      logger.error("IAP purchase callback failed", { error: e });
    });
  });
  errorSub = purchaseErrorListener((error) => {
    onPurchaseError(error);
  });

  return removePurchaseListeners;
}

export function removePurchaseListeners(): void {
  if (purchaseSub) {
    purchaseSub.remove();
    purchaseSub = null;
  }
  if (errorSub) {
    errorSub.remove();
    errorSub = null;
  }
}

/**
 * Kick off a subscription purchase. Resolution is delivered via the listener
 * registered by `installPurchaseListeners` — this call itself only returns
 * after StoreKit has accepted the request and is showing the payment sheet.
 *
 * `appAccountToken` is a client-generated UUID that Apple binds to the
 * transaction. We use it to tie the eventual transaction back to the mobile
 * session / workspace being created, without needing a pre-existing user.
 */
export async function startSoloSubscription(input: {
  appAccountToken: string;
}): Promise<void> {
  await ensureIapConnection();
  await requestSubscription({
    sku: SOLO_MONTHLY_PRODUCT_ID,
    // iOS 15+ — appAccountToken must be a lowercase UUID string.
    appAccountToken: input.appAccountToken,
  } as any);
}

/**
 * Restore previous purchases for reinstall / new-device flows.
 * Returns the original transaction IDs StoreKit already knows about.
 */
export async function restoreIapPurchases(): Promise<
  Array<{ productId: string; originalTransactionId: string; transactionReceipt?: string }>
> {
  await ensureIapConnection();
  const purchases = await getAvailablePurchases();
  return purchases
    .filter((p: any) => IAP_PRODUCT_IDS.includes(p.productId))
    .map((p: any) => ({
      productId: p.productId,
      originalTransactionId: String(
        p.originalTransactionIdentifierIOS ??
          p.transactionIdentifierIOS ??
          p.transactionId ??
          "",
      ),
      transactionReceipt: p.transactionReceipt,
    }))
    .filter((p) => p.originalTransactionId.length > 0);
}

/**
 * Acknowledge a purchase with StoreKit. MUST be called after the server has
 * validated the receipt and provisioned access; otherwise StoreKit will
 * re-deliver the purchase on every app launch.
 */
export async function finishIapTransaction(purchase: SubscriptionPurchase): Promise<void> {
  await finishTransaction({ purchase, isConsumable: false });
}
