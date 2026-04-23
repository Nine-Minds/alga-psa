'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { getTenantBrandingAction, type TenantBranding } from '../../actions';
import { generateBrandingStyles } from '../../lib/generateBrandingStyles';

interface BrandingContextType {
  branding: TenantBranding | null;
  isLoading: boolean;
  refreshBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType>({
  branding: null,
  isLoading: true,
  refreshBranding: async () => {},
});

export const useBranding = () => useContext(BrandingContext);

export function BrandingProvider({
  children,
  initialBranding = null
}: {
  children: React.ReactNode;
  initialBranding?: TenantBranding | null;
}) {
  const [branding, setBranding] = useState<TenantBranding | null>(initialBranding);
  const [isLoading, setIsLoading] = useState(!initialBranding);
  const [styleElement, setStyleElement] = useState<HTMLStyleElement | null>(null);

  const loadBranding = async () => {
    try {
      const brandingData = await getTenantBrandingAction();
      setBranding(brandingData);
    } catch (error) {
      console.error('Failed to load branding:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Only fetch branding if not provided initially
    if (!initialBranding) {
      loadBranding();
    }
  }, [initialBranding]);

  useEffect(() => {
    // Server-side injection wins — don't double-inject.
    if (document.getElementById('server-tenant-branding-styles')) {
      return;
    }

    // Clean up previous style element if it exists
    if (styleElement && document.head.contains(styleElement)) {
      document.head.removeChild(styleElement);
      setStyleElement(null);
    }

    const css = generateBrandingStyles(branding);
    if (!css) {
      return;
    }

    const style = document.createElement('style');
    style.setAttribute('data-branding', 'true');
    style.setAttribute('id', 'tenant-branding-styles');
    style.textContent = css;
    document.head.appendChild(style);
    setStyleElement(style);

    return () => {
      if (style && document.head.contains(style)) {
        document.head.removeChild(style);
      }
    };
  }, [branding]);

  return (
    <BrandingContext value={{ branding, isLoading, refreshBranding: loadBranding }}>
      {children}
    </BrandingContext>
  );
}
