'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bootstrapIframe } from '@ee/lib/extensions/ui/iframeBridge';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

type Props = {
  domain: string;
  extensionId: string;
  contentHash?: string | null;
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
  // Handles both space-separated (e.g. "255 255 255") and comma-separated (e.g. "0, 0, 0") values
  const rgbToHex = (rgb: string): string => {
    const parts = rgb.trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return rgb;
    return '#' + parts.map(n => n.toString(16).padStart(2, '0')).join('');
  };

  // Helper to get a CSS variable value
  const getVar = (name: string): string => computed.getPropertyValue(name).trim();

  // Map host variables to extension-friendly names.
  // These mappings must match the --alga-* definitions in globals.css
  // (.light,.dark block) so extensions see the same resolved values.
  return {
    // Primary (Purple)
    '--alga-primary': rgbToHex(getVar('--color-primary-500')),
    '--alga-primary-foreground': rgbToHex(getVar('--color-primary-50')),
    '--alga-primary-light': rgbToHex(getVar('--color-primary-200')),
    '--alga-primary-dark': rgbToHex(getVar('--color-primary-600')),
    '--alga-primary-50': rgbToHex(getVar('--color-primary-50')),
    '--alga-primary-100': rgbToHex(getVar('--color-primary-100')),

    // Secondary (Blue)
    '--alga-secondary': rgbToHex(getVar('--color-secondary-500')),
    '--alga-secondary-foreground': rgbToHex(getVar('--color-secondary-50')),
    '--alga-secondary-light': rgbToHex(getVar('--color-secondary-400')),

    // Accent (Orange)
    '--alga-accent': rgbToHex(getVar('--color-accent-500')),
    '--alga-accent-foreground': rgbToHex(getVar('--color-accent-50')),

    // Destructive / Status
    '--alga-danger': rgbToHex(getVar('--color-status-error')),
    '--alga-danger-dark': rgbToHex(getVar('--color-destructive')),

    // Text colors
    '--alga-fg': rgbToHex(getVar('--color-text-900')),
    '--alga-muted-fg': rgbToHex(getVar('--color-text-500')),

    // Border colors
    '--alga-border': rgbToHex(getVar('--color-border-200')),
    '--alga-border-light': rgbToHex(getVar('--color-border-100')),

    // Backgrounds
    '--alga-bg': rgbToHex(getVar('--color-background') || getVar('--background') || '255 255 255'),
    '--alga-card-bg': rgbToHex(getVar('--color-card') || getVar('--color-border-50')),
    '--alga-muted': rgbToHex(getVar('--color-border-50')),

    // Table row colors
    '--alga-row-even': rgbToHex(getVar('--color-border-50') || '249 250 251'),
    '--alga-row-odd': rgbToHex(getVar('--color-background') || getVar('--background') || '255 255 255'),
    '--alga-row-hover': rgbToHex(getVar('--color-primary-50') || '239 246 255'),

    // Soft variants (for outline/ghost/soft/dashed button hovers)
    '--alga-primary-soft': rgbToHex(getVar('--color-primary-50')),
    '--alga-primary-soft-fg': rgbToHex(getVar('--color-primary-700')),
    '--alga-primary-soft-hover': rgbToHex(getVar('--color-primary-100')),
    '--alga-primary-border': rgbToHex(getVar('--color-primary-300')),

    // Success/Warning
    '--alga-success': rgbToHex(getVar('--color-status-success')),
    '--alga-warning': rgbToHex(getVar('--color-status-warning')),

    // Layout
    '--alga-radius': getVar('--radius-lg') || '8px',
    '--alga-ring': '0 0% 0%',
  };
}

export default function ExtensionIframe({ domain, extensionId, contentHash }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const parentOrigin = window.location.origin;
      // Add content hash to bust redirect cache - browser may cache 302 redirects
      // Hash changes when bundle is updated, so cached redirects are invalidated
      const cacheBuster = contentHash ? `&_h=${encodeURIComponent(contentHash)}` : '';
      setSrc(`https://${domain}?parentOrigin=${encodeURIComponent(parentOrigin)}${cacheBuster}`);
    }
  }, [domain, contentHash]);

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

      const data = ev.data as any;
      // Check for Alga envelope format with ready message
      if (data?.alga === true && data?.version === '1' && data?.type === 'ready') {
        setIsLoading(false);
        // Send theme to the extension once it's ready
        sendTheme();
      }
    };

    window.addEventListener('message', handleMessage);

    const cleanupBridge = bootstrapIframe({ iframe, allowedOrigin, extensionId });

    // Re-send theme when the host theme changes (e.g. dark mode toggle)
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'style')) {
          sendTheme();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

    return () => {
      window.removeEventListener('message', handleMessage);
      observer.disconnect();
      cleanupBridge();
    };
  }, [src, domain, extensionId]);

  useEffect(() => {
    // Reset state whenever the domain changes so we show the loading state again.
    setIsLoading(true);
    setHasError(false);
  }, [src]);

  useEffect(() => {
    if (!isLoading) return;
    const fallback = window.setTimeout(() => {
      setIsLoading(false);
    }, 1500);
    return () => window.clearTimeout(fallback);
  }, [isLoading]);

  return (
    <div className="relative flex-1 h-full w-full min-h-0 overflow-hidden" aria-busy={isLoading}>
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
        className={`absolute inset-0 h-full w-full border-0 transition-opacity duration-300 ${
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
