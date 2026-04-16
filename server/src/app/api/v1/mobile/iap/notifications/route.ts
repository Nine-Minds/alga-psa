import { NextRequest, NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { getConnection } from '@/lib/db/db';
import {
  getAppleIapConfig,
  verifyNotificationPayload,
  type JWSTransactionDecodedPayload,
  type JWSRenewalInfoDecodedPayload,
  type NotificationV2DecodedPayload,
} from '@/lib/iap/appStoreServer';
import { startTenantDeletionWorkflow } from '@ee/lib/tenant-management/workflowClient';
import { getStripeService } from '@ee/lib/stripe/StripeService';

/**
 * POST /api/v1/mobile/iap/notifications
 *
 * App Store Server Notifications v2 webhook. Apple sends subscription
 * lifecycle events here. We verify the JWS, persist the raw notification
 * for audit, and update apple_iap_subscriptions accordingly.
 *
 * Must always respond 200 OK to Apple (unless the request is unauthenticated
 * or malformed). Apple retries non-2xx responses aggressively.
 *
 * Body: { signedPayload: string }  // a JWS from Apple
 */

const notificationBodySchema = z.object({
  signedPayload: z.string().min(1),
});

type SubscriptionStatus = 'active' | 'grace_period' | 'expired' | 'revoked' | 'refunded';

function statusForNotification(
  notificationType: string,
  subtype: string | undefined,
): SubscriptionStatus | null {
  switch (notificationType) {
    case 'SUBSCRIBED':
    case 'DID_RENEW':
    case 'OFFER_REDEEMED':
    case 'RENEWAL_EXTENDED':
    case 'RENEWAL_EXTENSION':
      return 'active';

    case 'DID_FAIL_TO_RENEW':
      // Apple distinguishes between "will retry in grace period" and "fatal".
      return subtype === 'GRACE_PERIOD' ? 'grace_period' : 'expired';

    case 'GRACE_PERIOD_EXPIRED':
    case 'EXPIRED':
      return 'expired';

    case 'REVOKE':
      return 'revoked';

    case 'REFUND':
      return 'refunded';

    // These are informational — no status change.
    case 'DID_CHANGE_RENEWAL_STATUS':
    case 'DID_CHANGE_RENEWAL_PREF':
    case 'PRICE_INCREASE':
    case 'CONSUMPTION_REQUEST':
    case 'REFUND_DECLINED':
    case 'REFUND_REVERSED':
    case 'TEST':
      return null;

    default:
      return null;
  }
}

type IapSubscriptionRow = {
  tenant: string;
  transition_stripe_subscription_external_id: string | null;
};

/**
 * Record the raw notification. Returns true if this is a new notification,
 * false if we've already seen this notification_uuid.
 */
async function recordNotification(
  notification: NotificationV2DecodedPayload,
  transaction: JWSTransactionDecodedPayload | null,
  payload: unknown,
): Promise<boolean> {
  const knex = await getConnection(null);

  // Try to find the tenant for this transaction. May be null if the notification
  // arrives before /provision finishes (unusual but possible for SUBSCRIBED).
  let tenantId: string | null = null;
  if (transaction?.originalTransactionId) {
    const sub = await knex('apple_iap_subscriptions')
      .where({ original_transaction_id: transaction.originalTransactionId })
      .first('tenant');
    tenantId = (sub as any)?.tenant ?? null;
  }

  try {
    await knex('apple_iap_notifications').insert({
      notification_uuid: notification.notificationUUID,
      notification_type: notification.notificationType,
      subtype: notification.subtype ?? null,
      original_transaction_id: transaction?.originalTransactionId ?? null,
      tenant: tenantId,
      payload: payload as any,
    });
    return true;
  } catch (err: any) {
    // Duplicate notification_uuid → already processed. Acknowledge successfully.
    if (err?.code === '23505' /* unique_violation */) {
      return false;
    }
    throw err;
  }
}

// Terminal statuses mirror Stripe's customer.subscription.deleted: the paid
// period is over (or the entitlement has been revoked / refunded) and we
// should hand the tenant to the deletion workflow OR complete a pending
// Apple → Stripe transition.
const TERMINAL_STATUSES = new Set<SubscriptionStatus>(['expired', 'revoked', 'refunded']);

async function applyStatusUpdate(
  notification: NotificationV2DecodedPayload,
  transaction: JWSTransactionDecodedPayload,
  renewalInfo: JWSRenewalInfoDecodedPayload | null,
  nextStatus: SubscriptionStatus,
): Promise<void> {
  const knex = await getConnection(null);
  const expiresAt = transaction.expiresDate ? new Date(transaction.expiresDate) : null;

  // Look up the tenant and transition state first so the UPDATE is single-shard
  // on Citus (apple_iap_subscriptions is distributed by tenant).
  const sub = await knex('apple_iap_subscriptions')
    .where({ original_transaction_id: transaction.originalTransactionId })
    .first<IapSubscriptionRow | undefined>(
      'tenant',
      'transition_stripe_subscription_external_id',
    );

  if (!sub) {
    // No subscription row matched — provision must have failed earlier. The
    // audit log row still records what happened; nothing else to do.
    return;
  }

  const { tenant: tenantId, transition_stripe_subscription_external_id: transitionSubId } = sub;

  // Apply the status/expiry update. Renewal-info fields (auto_renew_status)
  // are folded in via applyRenewalInfo below so they stay in sync on every
  // notification that carries renewalInfo, regardless of status change.
  await knex('apple_iap_subscriptions')
    .where({ tenant: tenantId, original_transaction_id: transaction.originalTransactionId })
    .update({
      status: nextStatus,
      expires_at: expiresAt,
      latest_transaction_id: transaction.transactionId,
      latest_notification_type: notification.notificationType,
      latest_notification_subtype: notification.subtype ?? null,
      latest_notification_at: new Date(),
      updated_at: new Date(),
    });

  // Renewal safety net. If Apple charged the user again while a Stripe
  // transition is pending (user re-enabled auto-renew after we verified it
  // off), push Stripe's trial_end out to the new Apple expiry so Stripe
  // won't charge during an active Apple billing window. Belt and braces:
  // the transition flow already required auto-renew off at start time.
  if (
    transitionSubId &&
    nextStatus === 'active' &&
    expiresAt &&
    notification.notificationType === 'DID_RENEW'
  ) {
    try {
      const stripeService = getStripeService();
      await stripeService.extendSubscriptionTrialEnd(tenantId, transitionSubId, expiresAt);
      // eslint-disable-next-line no-console
      console.info(
        `[iap/notifications] extended Stripe trial for ${transitionSubId} to ${expiresAt.toISOString()} (tenant ${tenantId}, Apple renewed)`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[iap/notifications] failed to extend Stripe trial for ${transitionSubId} (tenant ${tenantId})`,
        err,
      );
    }
  }

  if (!TERMINAL_STATUSES.has(nextStatus)) return;

  // Terminal status branch: transition completion vs tenant deletion.
  if (transitionSubId) {
    // Apple is done charging → Stripe takes over. Flip billing_source and
    // let the already-existing Stripe trialing subscription roll into its
    // first paid cycle on its own. No deletion workflow — this tenant stays.
    try {
      const stripeService = getStripeService();
      await stripeService.completeIapToStripeTransition(
        tenantId,
        transaction.originalTransactionId,
        transitionSubId,
      );
      // eslint-disable-next-line no-console
      console.info(
        `[iap/notifications] completed IAP → Stripe transition for tenant ${tenantId} (stripe sub ${transitionSubId})`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[iap/notifications] failed to complete IAP → Stripe transition for tenant ${tenantId}`,
        err,
      );
      // Don't start deletion if the transition is in flight — re-raise so Apple retries.
      throw err;
    }
    return;
  }

  // No pending transition → original behavior: hand the tenant to the
  // deletion workflow, which deactivates users, awaits confirmation, and
  // (eventually) wipes data. The workflow short-circuits its Stripe-cancel
  // step for apple_iap_webhook since IAP tenants have no Stripe subscription.
  try {
    const result = await startTenantDeletionWorkflow({
      tenantId,
      triggerSource: 'apple_iap_webhook',
      subscriptionExternalId: transaction.originalTransactionId,
      reason: `Apple IAP subscription ${nextStatus} (${notification.notificationType})`,
    });
    if (!result.available) {
      // eslint-disable-next-line no-console
      console.warn(
        `[iap/notifications] tenant deletion workflow unavailable for tenant ${tenantId}: ${result.error ?? 'unknown'}`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[iap/notifications] failed to start tenant deletion workflow for tenant ${tenantId}`,
      err,
    );
  }
}

/**
 * Persist the auto-renew state from renewalInfo (if present) into the
 * subscription row. We do this on every notification that carries renewal
 * info, not just DID_CHANGE_RENEWAL_STATUS, so our local copy never gets
 * stale between toggles.
 */
async function applyRenewalInfo(
  transaction: JWSTransactionDecodedPayload,
  renewalInfo: JWSRenewalInfoDecodedPayload | null,
): Promise<void> {
  if (!renewalInfo) return;
  const knex = await getConnection(null);

  const sub = await knex('apple_iap_subscriptions')
    .where({ original_transaction_id: transaction.originalTransactionId })
    .first<{ tenant: string } | undefined>('tenant');

  if (!sub) return;

  await knex('apple_iap_subscriptions')
    .where({ tenant: sub.tenant, original_transaction_id: transaction.originalTransactionId })
    .update({
      auto_renew_status: renewalInfo.autoRenewStatus === 1,
      auto_renew_status_updated_at: new Date(),
      updated_at: new Date(),
    });
}

async function markNotificationProcessed(
  notificationUuid: string,
  error?: string,
): Promise<void> {
  const knex = await getConnection(null);
  await knex('apple_iap_notifications')
    .where({ notification_uuid: notificationUuid })
    .update({
      processed_at: new Date(),
      processing_error: error ?? null,
    });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = notificationBodySchema.parse(body);

    const config = await getAppleIapConfig();

    // Verify the JWS (signature + x5c chain when root CA configured).
    const { notification, transaction, renewalInfo } = await verifyNotificationPayload(
      parsed.signedPayload,
      config,
    );

    // Persist first, then process. If processing fails we can replay from
    // the stored row.
    const isNew = await recordNotification(notification, transaction, {
      notification,
      transaction,
      renewalInfo,
    });

    if (!isNew) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    if (!transaction) {
      await markNotificationProcessed(notification.notificationUUID);
      return NextResponse.json({ ok: true, handled: false, reason: 'no transaction info' });
    }

    // Keep auto-renew state in sync on every notification that carries
    // renewalInfo, regardless of whether the status changes. This ensures
    // the pre-transition check in StripeService reads fresh data.
    await applyRenewalInfo(transaction, renewalInfo);

    const nextStatus = statusForNotification(notification.notificationType, notification.subtype);

    if (nextStatus) {
      try {
        await applyStatusUpdate(notification, transaction, renewalInfo, nextStatus);
        await markNotificationProcessed(notification.notificationUUID);
      } catch (err) {
        await markNotificationProcessed(
          notification.notificationUUID,
          err instanceof Error ? err.message : 'unknown error',
        );
        throw err;
      }
    } else {
      await markNotificationProcessed(notification.notificationUUID);
    }

    return NextResponse.json({ ok: true, notificationType: notification.notificationType });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
    }
    // Log and return 500 so Apple retries. Never expose error details.
    // eslint-disable-next-line no-console
    console.error('[iap/notifications] processing failed', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
