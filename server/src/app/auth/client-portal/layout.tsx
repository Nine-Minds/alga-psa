import type { ReactNode } from 'react';
import { AppThemeProvider } from '@/components/providers/AppThemeProvider';
import { ThemeBridge } from '@/components/providers/ThemeBridge';

export default function ClientPortalAuthLayout({ children }: { children: ReactNode }) {
  return (
    <AppThemeProvider>
      <ThemeBridge>
        {children}
      </ThemeBridge>
    </AppThemeProvider>
  );
}
