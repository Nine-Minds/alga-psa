'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bootstrapIframe } from '@ee/lib/extensions/ui/iframeBridge';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

type Props = {
  domain: string; // e.g. ext-abc.tenant.example.com
};

/**
 * Extracts theme variables from the host app's computed styles and maps them
 * to standardized CSS variable names for extensions.
 */
function extractThemeVariables(): Record<string, string> {
  if (typeof document === 'undefined') return {};

  const root = document.documentElement;
  const computed = getComputedStyle(root);

  // Helper to get RGB variable and convert to hex
  const rgbToHex = (rgb: string): string => {
    const parts = rgb.trim().split(/\s+/).map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return rgb;
    return '#' + parts.map(n => n.toString(16).padStart(2, '0')).join('');
  };

  // Helper to get a CSS variable value
  const getVar = (name: string): string => computed.getPropertyValue(name).trim();

  // Map host variables to extension-friendly names
  return {
    // Primary (Purple)
    '--alga-primary': rgbToHex(getVar('--color-primary-500')),
    '--alga-primary-light': rgbToHex(getVar('--color-primary-400')),
    '--alga-primary-dark': rgbToHex(getVar('--color-primary-600')),
    '--alga-primary-50': rgbToHex(getVar('--color-primary-50')),
    '--alga-primary-100': rgbToHex(getVar('--color-primary-100')),

    // Secondary (Blue)
    '--alga-secondary': rgbToHex(getVar('--color-secondary-500')),
    '--alga-secondary-light': rgbToHex(getVar('--color-secondary-400')),

    // Accent (Orange)
    '--alga-accent': rgbToHex(getVar('--color-accent-500')),

    // Destructive (Orange - brand color for deletions)
    '--alga-danger': rgbToHex(getVar('--color-accent-500')),
    '--alga-danger-dark': rgbToHex(getVar('--color-accent-600')),

    // Text colors
    '--alga-fg': rgbToHex(getVar('--color-text-900')),
    '--alga-muted-fg': rgbToHex(getVar('--color-text-500')),

    // Border colors
    '--alga-border': rgbToHex(getVar('--color-border-200')),
    '--alga-border-light': rgbToHex(getVar('--color-border-100')),

    // Backgrounds
    '--alga-bg': rgbToHex(getVar('--background') || '255 255 255'),
    '--alga-card-bg': rgbToHex(getVar('--color-border-50')),

    // Success/Warning (keeping standard colors)
    '--alga-success': '#16a34a',
    '--alga-warning': '#d97706',
  };
}

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

    // Send theme to the iframe
    const sendTheme = () => {
      const theme = extractThemeVariables();
      iframe.contentWindow?.postMessage(
        { alga: true, version: '1', type: 'theme', payload: theme },
        allowedOrigin || '*'
      );
    };

    // Listen for the 'ready' message from the extension to hide loading state
    const handleMessage = (ev: MessageEvent) => {
      // Validate origin matches the expected extension domain
      if (ev.origin !== allowedOrigin) return;

      const data = ev.data;
      // Check for Alga envelope format with ready message
      if (data?.alga === true && data?.version === '1' && data?.type === 'ready') {
        setIsLoading(false);
        // Send theme to the extension once it's ready
        sendTheme();
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
            spinnerProps={{ size: 'sm', color: 'border-primary-400' }}
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
