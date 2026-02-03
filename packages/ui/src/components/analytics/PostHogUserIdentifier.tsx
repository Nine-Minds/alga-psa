'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { usePostHog } from 'posthog-js/react';

export function PostHogUserIdentifier() {
  const posthog = usePostHog();
  const { data: session } = useSession();
  const lastIdentifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!posthog || !session?.user) return;

    const user = session.user as any;

    // PostHog can be initialized async (after hydration). In some cases (especially in prod),
    // calling identify immediately can be dropped or later overwritten.
    // Wait until the client is fully loaded, then identify and reload feature flags.
    let cancelled = false;
    const waitForPostHogAndIdentify = () => {
      if (cancelled) return;
      if (!(posthog as any).__loaded) {
        const timeoutId = window.setTimeout(waitForPostHogAndIdentify, 50);
        (waitForPostHogAndIdentify as any).__timeoutId = timeoutId;
        return;
      }

      const shouldAnonymize =
        process.env.NEXT_PUBLIC_ANALYTICS_ANONYMIZE_USER_IDS !== 'false';

      if (!user?.id || !user?.tenant) {
        // Without these, tenant-scoped feature flags cannot work reliably.
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PostHog] Missing user id/tenant for identify()', {
            userId: user?.id,
            tenant: user?.tenant,
          });
        }
        return;
      }

      const expectedDistinctId = shouldAnonymize
        ? `anonymous_${user.tenant}_${user.id}`
        : String(user.id);

      const currentDistinctId = typeof (posthog as any).get_distinct_id === 'function'
        ? (posthog as any).get_distinct_id()
        : undefined;
      const currentTenant = typeof (posthog as any).get_property === 'function'
        ? (posthog as any).get_property('tenant')
        : undefined;

      if (
        process.env.NODE_ENV !== 'production' &&
        typeof currentDistinctId === 'string' &&
        currentDistinctId === `anonymous_${window.location.hostname}` &&
        currentTenant !== user.tenant
      ) {
        console.warn('[PostHog] Tenant mismatch: PostHog still on hostname-based anonymous distinct_id', {
          currentDistinctId,
          expectedDistinctId,
          currentTenant,
          expectedTenant: user.tenant,
        });
      }

      // Avoid spamming identify calls on rerenders/navigation, but never skip if we're currently wrong.
      if (currentDistinctId === expectedDistinctId && currentTenant === user.tenant) {
        lastIdentifiedRef.current = expectedDistinctId;
        return;
      }

      if (lastIdentifiedRef.current === expectedDistinctId) {
        // We've already attempted to identify this session, and PostHog still isn't reflecting it.
        // Don't loop forever; rely on subsequent navigations/refresh if needed.
        return;
      }

      if (currentDistinctId !== expectedDistinctId || currentTenant !== user.tenant) {
        // Debug logging in development
        if (process.env.NODE_ENV === 'development') {
          console.log('[PostHog] Identifying user:', {
            anonymize: process.env.NEXT_PUBLIC_ANALYTICS_ANONYMIZE_USER_IDS,
            userId: user.id,
            tenant: user.tenant,
            userType: user.user_type
          });
        }

        if (!shouldAnonymize) {
          posthog.identify(user.id, {
            email: user.email,
            name: user.name,
            username: user.username,
            tenant: user.tenant,
            user_type: user.user_type,
            client_id: user.clientId,
            contact_id: user.contactId
          });
        } else {
          posthog.identify(expectedDistinctId, {
            tenant: user.tenant,
            user_type: user.user_type
          });
        }

        lastIdentifiedRef.current = expectedDistinctId;
        posthog.reloadFeatureFlags();

        if (process.env.NODE_ENV === 'development') {
          console.log('[PostHog] User identified, feature flags reloaded');
        }
      }
    };
    
    waitForPostHogAndIdentify();
    return () => {
      cancelled = true;
      const timeoutId = (waitForPostHogAndIdentify as any).__timeoutId as number | undefined;
      if (typeof timeoutId === 'number') {
        clearTimeout(timeoutId);
      }
    };
  }, [session, posthog]);

  return null;
}
