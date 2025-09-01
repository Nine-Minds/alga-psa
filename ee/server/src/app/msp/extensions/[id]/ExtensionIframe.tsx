'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { bootstrapIframe } from '@ee/lib/extensions/ui';

type Props = {
  domain: string; // e.g. ext-abc.tenant.example.com
};

export default function ExtensionIframe({ domain }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

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
