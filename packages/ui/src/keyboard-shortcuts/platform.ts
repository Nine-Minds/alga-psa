'use client';

import { useEffect, useState } from 'react';
import type { Platform } from './types';

export const DEFAULT_PLATFORM: Platform = 'other';

export function detectPlatformFromString(value: string | null | undefined): Platform {
  if (!value) {
    return DEFAULT_PLATFORM;
  }

  return /mac|iphone|ipad|ipod/i.test(value) ? 'mac' : 'other';
}

export function detectClientPlatform(): Platform | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return null;
  }

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  return detectPlatformFromString(nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent);
}

export function useClientPlatform(fallback: Platform = DEFAULT_PLATFORM): Platform {
  const [platform, setPlatform] = useState<Platform>(fallback);

  useEffect(() => {
    setPlatform(detectClientPlatform() ?? fallback);
  }, [fallback]);

  return platform;
}
