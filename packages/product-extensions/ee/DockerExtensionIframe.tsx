'use client';

import React, { useEffect, useRef, useState } from 'react';
import { bootstrapIframe } from '@ee/lib/extensions/ui/iframeBridge';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type Props = {
  src: string;
  extensionId?: string;
};

/**
 * Extension iframe component for Docker backend mode.
 * Uses same-origin path-based URLs instead of custom domains.
 */
export default function DockerExtensionIframe({ src, extensionId }: Props) {
  const { t } = useTranslation('msp/extensions');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !src) return;

    let allowedOrigin: string | undefined;
    try {
      allowedOrigin = new URL(iframe.src || src, window.location.href).origin;
    } catch {
      allowedOrigin = window.location.origin;
    }

    // Listen for the 'ready' message from the extension to hide loading state
    const handleMessage = (ev: MessageEvent) => {
      // Validate origin matches same origin (Docker mode)
      if (allowedOrigin && ev.origin !== allowedOrigin) {
        console.warn('DockerExtensionIframe: ignoring message from different origin', {
          expected: allowedOrigin,
          received: ev.origin
        });
        return;
      }

      const data = ev.data as any;
      // Check for Alga envelope format with ready message
      if (data?.alga === true && data?.version === '1' && data?.type === 'ready') {
        console.log('DockerExtensionIframe: extension ready');
        setIsLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);

    // Bootstrap iframe communication
    const cleanupBridge = bootstrapIframe({ iframe, allowedOrigin, extensionId });

    return () => {
      window.removeEventListener('message', handleMessage);
      cleanupBridge();
    };
  }, [src, extensionId]);

  // Ensure src includes parentOrigin
  const finalSrc = React.useMemo(() => {
    if (!src) return src;
    try {
      const url = new URL(src, window.location.href);
      url.searchParams.set('parentOrigin', window.location.origin);
      return url.toString();
    } catch {
      return src;
    }
  }, [src]);

  useEffect(() => {
    // Reset state whenever the src changes so we show the loading state again.
    setIsLoading(true);
    setHasError(false);
  }, [finalSrc]);

  useEffect(() => {
    if (!isLoading) return;
    const fallback = window.setTimeout(() => {
      setIsLoading(false);
    }, 1500);
    return () => window.clearTimeout(fallback);
  }, [isLoading]);

  return (
    <div className="relative flex-1 h-full w-full flex flex-col min-h-0" aria-busy={isLoading}>
      {isLoading && !hasError && (
        <div className="extension-loading-overlay" role="status">
          <LoadingIndicator
            layout="stacked"
            className="extension-loading-indicator"
            text={t('iframe.starting')}
            textClassName="extension-loading-text"
            spinnerProps={{ size: 'sm' }}
          />
          <p className="extension-loading-subtext">{t('iframe.loadingUi')}</p>
        </div>
      )}

      {hasError && (
        <div className="extension-loading-overlay extension-loading-overlay--error" role="alert">
          <p className="extension-loading-text">{t('iframe.loadFailed')}</p>
          <p className="extension-loading-subtext">{t('iframe.configurationHint')}</p>
        </div>
      )}

      <iframe
        ref={iframeRef}
        key={finalSrc}
        src={finalSrc}
        title={t('iframe.title')}
        className={`flex-1 h-full w-full border-0 transition-opacity duration-300 ${
          isLoading ? 'opacity-0' : 'opacity-100'
        }`}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        onLoad={() => {
          setIsLoading(false);
        }}
        onError={() => {
          console.error('DockerExtensionIframe: iframe error');
          setHasError(true);
          setIsLoading(false);
        }}
      />
    </div>
  );
}
