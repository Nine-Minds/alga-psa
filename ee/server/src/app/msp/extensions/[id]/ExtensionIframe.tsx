'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bootstrapIframe } from '@ee/lib/extensions/ui/iframeBridge';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

type Props = {
  domain: string; // e.g. ext-abc.tenant.example.com
};

export default function ExtensionIframe({ domain }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const src = useMemo(() => `https://${domain}` as const, [domain]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !src) return;

    // Quick safety check: only allow *.apps.algapsa.com
    const isAllowedDomain = domain === 'apps.algapsa.com' || domain.endsWith('.apps.algapsa.com');
    if (!isAllowedDomain) {
      console.warn('ExtensionIframe: refusing to bootstrap non-allowed domain', { domain });
      return;
    }

    // Derive allowedOrigin from the src
    let allowedOrigin: string | undefined = undefined;
    try {
      allowedOrigin = `https://${domain}`;
    } catch {
      // ignore
    }

    // Listen for the 'ready' message from the extension to hide loading state
    const handleMessage = (ev: MessageEvent) => {
      // Validate origin matches the expected extension domain
      if (ev.origin !== allowedOrigin) return;

      const data = ev.data;
      // Check for Alga envelope format with ready message
      if (data?.alga === true && data?.version === '1' && data?.type === 'ready') {
        setIsLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);

    bootstrapIframe({ iframe, allowedOrigin });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [src, domain]);

  useEffect(() => {
    // Reset state whenever the domain changes so we show the loading state again.
    setIsLoading(true);
    setHasError(false);
  }, [src]);

  return (
    <div className="relative h-full w-full" aria-busy={isLoading}>
      {isLoading && !hasError && (
        <div className="extension-loading-overlay" role="status">
          <LoadingIndicator
            layout="stacked"
            className="extension-loading-indicator"
            text="Starting extension"
            textClassName="extension-loading-text"
            spinnerProps={{ size: 'sm' }}
          />
          <p className="extension-loading-subtext">Connecting to the runtime workspace&hellip;</p>
        </div>
      )}

      {hasError && (
        <div className="extension-loading-overlay extension-loading-overlay--error" role="alert">
          <p className="extension-loading-text">We couldn&rsquo;t load this extension.</p>
          <p className="extension-loading-subtext">Check the extension configuration and try again.</p>
        </div>
      )}

      <iframe
        ref={iframeRef}
        key={src}
        src={src}
        title="Extension App"
        className={`h-full w-full border-0 transition-opacity duration-300 ${
          isLoading ? 'opacity-0' : 'opacity-100'
        }`}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        onError={() => {
          setHasError(true);
          setIsLoading(false);
        }}
      />
    </div>
  );
}
