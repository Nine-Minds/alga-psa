'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { bootstrapIframe } from '@ee/lib/extensions/ui/iframeBridge';

type Props = {
  domain: string;
};

export default function ExtensionIframe({ domain }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const src = useMemo(() => `https://${domain}` as const, [domain]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !src) return;

    const isAllowedDomain = domain === 'apps.algapsa.com' || domain.endsWith('.apps.algapsa.com');
    if (!isAllowedDomain) {
      console.warn('ExtensionIframe: refusing to bootstrap non-allowed domain', { domain });
      return;
    }

    let allowedOrigin: string | undefined = undefined;
    try {
      allowedOrigin = `https://${domain}`;
    } catch {}

    bootstrapIframe({ iframe, allowedOrigin });
  }, [src]);

  return (
    <iframe
      ref={iframeRef}
      key={src}
      src={src}
      title="Extension App"
      className="w-full h-full border-0"
      sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
    />
  );
}

