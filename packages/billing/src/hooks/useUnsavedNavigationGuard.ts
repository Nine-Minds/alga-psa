'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Warns before leaving an editor with unsaved changes.
 *
 * Covers both exits: the browser's own beforeunload prompt, and in-app link
 * clicks, which are intercepted in the capture phase (before Next.js Link
 * handles them) so the caller can show its own confirmation dialog. Links to
 * the current path, links opening in another target and download links are
 * left alone.
 *
 * Note this deliberately does not use UnsavedChangesContext: its provider is
 * not mounted anywhere in the billing tree, and its semantics differ
 * (router.push instead of a full load, a non-translated dialog, and different
 * link-skip rules).
 */
export function useUnsavedNavigationGuard(hasUnsavedChanges: boolean) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!hasUnsavedChanges) return;

      const target = e.target as HTMLElement;
      const link = target.closest('a[href]') as HTMLAnchorElement;

      if (link && link.href) {
        const currentPath = window.location.pathname + window.location.search;
        const linkPath = new URL(link.href, window.location.origin).pathname + new URL(link.href, window.location.origin).search;

        // Only intercept if navigating to a different page
        if (linkPath !== currentPath && !link.target && !link.download) {
          e.preventDefault();
          e.stopPropagation();
          setPendingNavigation(link.href);
          setShowConfirm(true);
        }
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [hasUnsavedChanges]);

  const confirmNavigation = useCallback(() => {
    if (pendingNavigation) {
      // Allow navigation
      window.location.href = pendingNavigation;
    }
    setShowConfirm(false);
    setPendingNavigation(null);
  }, [pendingNavigation]);

  const cancelNavigation = useCallback(() => {
    setShowConfirm(false);
    setPendingNavigation(null);
  }, []);

  return { showConfirm, confirmNavigation, cancelNavigation };
}
