'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { isPostHogEnabled, posthogConfig } from '@alga-psa/analytics/client';

function SuspendedPostHogPageView() {
  const posthogClient = usePostHog();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthogClient) return;
    const search = searchParams?.toString() ?? '';
    const url = search ? `${pathname}?${search}` : pathname;
    posthogClient.capture('$pageview', { path: pathname, url });
  }, [posthogClient, pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    if (!isPostHogEnabled()) {
      console.log('Usage statistics disabled by ALGA_USAGE_STATS environment variable');
      return;
    }

    posthog.init(posthogConfig.apiKey, {
      api_host: posthogConfig.apiHost,
      ui_host: posthogConfig.uiHost,
      ...posthogConfig.defaultConfig,
      debug: process.env.NODE_ENV === 'development',
      loaded: (posthogClient) => {
        if (process.env.NEXT_PUBLIC_ANALYTICS_ANONYMIZE_USER_IDS !== 'false') {
          const anonymousId = `anonymous_${window.location.hostname}`;
          posthogClient.identify(anonymousId);
        }
        setIsInitialized(true);
      },
      bootstrap: {
        distinctID: undefined,
        isIdentifiedID: false,
        featureFlags: {},
      },
      disable_session_recording: posthogConfig.features.sessionRecording === false,
    });
  }, [isHydrated]);

  return (
    <PHProvider client={posthog}>
      {isInitialized && <SuspendedPostHogPageView />}
      {children}
    </PHProvider>
  );
}
