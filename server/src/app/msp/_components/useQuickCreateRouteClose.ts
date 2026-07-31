'use client';

import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

export type QuickCreateRouteCloseMode = 'back' | 'replace';

export function useQuickCreateRouteClose(closeMode: QuickCreateRouteCloseMode, replaceHref: string) {
  const router = useRouter();
  const closedRef = useRef(false);

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;

    if (closeMode === 'back') {
      router.back();
      return;
    }

    router.replace(replaceHref);
  }, [closeMode, replaceHref, router]);

  return { close, router };
}
