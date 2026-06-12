'use client';

import { Toaster } from 'react-hot-toast';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Portal the Toaster to <body> so it escapes any ancestor stacking context.
  // Drawers/dialogs render via Radix Dialog.Portal (also at <body>) with z-index
  // up to ~61; rendering the toaster in place would trap its z-index inside the
  // provider subtree and let those portals paint over it. Mounting at body level
  // with a top-tier z-index keeps toasts visible above every overlay.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return createPortal(
    <Toaster
      position="top-right"
      containerStyle={{ zIndex: 999999 }}
      toastOptions={{
        style: isDark
          ? {
              background: 'rgb(15 23 42)',
              color: 'rgb(248 250 252)',
              border: '1px solid rgb(30 41 59)',
            }
          : undefined,
      }}
    />,
    document.body
  );
}
