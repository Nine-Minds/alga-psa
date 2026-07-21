/**
 * Frozen contract for the AI gateway integration (docs/plans/2026-07-20-ai-usage-billing-plan.md).
 * Both the gateway client lib and the AI Usage UI build against these types;
 * changes here require touching both sides deliberately.
 */

export type AiFeature =
  | 'chat'
  | 'chat-title'
  | 'email-reply-ack'
  | 'email-rule-classifier'
  | 'opportunity-drafting'
  | 'workflow-inference'
  | 'inventory-classifier'
  | 'document-assist';

export type AiCreditsErrorReason =
  | 'no_subscription'
  | 'out_of_credits'
  | 'consent_required';

export class AiCreditsError extends Error {
  readonly reason: AiCreditsErrorReason;

  constructor(reason: AiCreditsErrorReason, message?: string) {
    super(message ?? `AI request rejected: ${reason}`);
    this.name = 'AiCreditsError';
    this.reason = reason;
  }
}

export type AiSubscriptionStatus =
  | 'none'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid';

/** GET /v1/account */
export interface AiAccountSummary {
  subscriptionStatus: AiSubscriptionStatus;
  /** Monthly allotment bucket; may be negative while in grace. */
  includedBalanceCredits: number;
  /** Purchased top-up bucket; persists across cycles. */
  topupBalanceCredits: number;
  graceLimitCredits: number;
  /** includedBalance + topupBalance (may be negative while in grace). */
  totalBalanceCredits: number;
  lowBalance: boolean;
  cycleStartedAt: string | null; // ISO 8601
  autoTopup: {
    enabled: boolean;
    thresholdCredits: number | null;
    packPriceId: string | null;
  };
  /** Appliance accounts only; hosted accounts always report 'granted'. */
  consentStatus: 'granted' | 'revoked' | 'missing';
  /**
   * Detail view of the latest consent record. Hosted accounts report
   * status 'granted' with all detail fields null.
   */
  consent: {
    status: 'granted' | 'revoked' | 'missing';
    grantedBy: string | null;
    termsVersion: string | null;
    grantedAt: string | null; // ISO 8601
    revokedAt: string | null; // ISO 8601
    revokedBy: string | null;
  };
}

/** GET /v1/account/usage */
export interface AiUsageEvent {
  usageId: string;
  feature: AiFeature;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  creditsCharged: number;
  createdAt: string; // ISO 8601
}

export interface AiUsagePage {
  events: AiUsageEvent[];
  nextCursor: string | null;
}

export interface AiUsageQuery {
  from?: string; // ISO 8601
  to?: string; // ISO 8601
  feature?: AiFeature;
  cursor?: string;
  limit?: number; // server clamps; default 50
}

/** POST /v1/account/auto-topup */
export interface AiAutoTopupSettings {
  enabled: boolean;
  thresholdCredits?: number;
  packPriceId?: string;
}

/**
 * Server-action surface consumed by the AI Usage UI.
 * Implemented in ee/server/src/lib/actions/aiUsageActions.ts against the
 * gateway client lib; the UI imports only these signatures.
 */
export interface AiUsageActions {
  getAiAccountSummary(): Promise<AiAccountSummary>;
  getAiUsageHistory(query: AiUsageQuery): Promise<AiUsagePage>;
  setAiAutoTopup(settings: AiAutoTopupSettings): Promise<AiAccountSummary>;
  /** Returns a Stripe Checkout URL for the AI add-on subscription. */
  startAiAddonCheckout(): Promise<{ checkoutUrl: string }>;
  /** Returns a Stripe Checkout URL for a one-time top-up pack. */
  startAiTopupCheckout(packPriceId: string): Promise<{ checkoutUrl: string }>;
}
