/**
 * CE stub of the frozen AI gateway contract types.
 *
 * The authoritative definitions live in
 * `ee/server/src/lib/aiGateway/types.ts` and are used at EE build/runtime via
 * the `@ee` webpack alias. In Community Edition builds `@ee` resolves to
 * `packages/ee/src`, so this file supplies the same type shapes to CE-tree
 * components (e.g. the appliance AI section on the licenses page) for
 * type-checking. Keep the subset used by the UI in sync with the frozen
 * contract; changing the contract requires touching both files deliberately.
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
