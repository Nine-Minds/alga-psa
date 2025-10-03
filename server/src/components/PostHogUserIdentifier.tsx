'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePostHog } from 'posthog-js/react';

export function PostHogUserIdentifier() {
  const posthog = usePostHog();
  const { data: session } = useSession();

  useEffect(() => {
    if (!posthog || !session?.user) return;

    const user = session.user as any;
    
    // Debug logging in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[PostHog] Identifying user:', {
        anonymize: process.env.NEXT_PUBLIC_ANALYTICS_ANONYMIZE_USER_IDS,
        userId: user.id,
        tenant: user.tenant,
        userType: user.user_type
      });
    }
    
    // Only identify if we're not anonymizing
    if (process.env.NEXT_PUBLIC_ANALYTICS_ANONYMIZE_USER_IDS === 'false') {
      // Identify the user with their actual ID
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
      // When anonymized, identify with a stable anonymous ID
      // This ensures feature flags work correctly based on properties
      const anonymousId = `anonymous_${user.tenant}_${user.id}`;
      posthog.identify(anonymousId, {
        tenant: user.tenant,
        user_type: user.user_type
      });
    }
    
    // Force reload feature flags after identification
    posthog.reloadFeatureFlags();
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[PostHog] User identified, feature flags reloaded');
    }
  }, [session, posthog]);

  return null;
}