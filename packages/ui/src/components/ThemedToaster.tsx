'use client';

import { Toaster } from 'react-hot-toast';
import { useTheme } from 'next-themes';

export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: isDark
          ? {
              background: 'rgb(15 23 42)',
              color: 'rgb(248 250 252)',
              border: '1px solid rgb(30 41 59)',
            }
          : undefined,
      }}
    />
  );
}
