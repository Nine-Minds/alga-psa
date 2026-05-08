'use client';

import React, { useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import SidebarWithFeatureFlags from './SidebarWithFeatureFlags';
import Header from './Header';
import Body from './Body';
import { PlatformNotificationBanner } from './PlatformNotificationBanner';
import { DrawerProvider, DrawerOutlet } from '@alga-psa/ui';
import { MspDocumentsCrossFeatureProvider } from '@alga-psa/msp-composition/documents';
import { AlgadeskClientCrossFeatureProvider } from '@alga-psa/msp-composition/clients';

interface AlgadeskMspShellProps {
  children: React.ReactNode;
  initialSidebarCollapsed?: boolean;
}

export default function AlgadeskMspShell({
  children,
  initialSidebarCollapsed = false,
}: AlgadeskMspShellProps): React.JSX.Element {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [modeOverride, setModeOverride] = useState<'main' | 'settings' | null>(null);

  const modeForPath = (path: string): 'main' | 'settings' => {
    return path.startsWith('/msp/settings') ? 'settings' : 'main';
  };

  const defaultSidebarMode = modeForPath(pathname ?? '/');
  const sidebarMode = modeOverride ?? defaultSidebarMode;
  const sidebarOpen = !sidebarCollapsed;

  const setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>> = (open) => {
    if (typeof open === 'function') {
      setSidebarCollapsed((prev) => !open(!prev));
      return;
    }
    setSidebarCollapsed(!open);
  };

  const handleBackToMain = () => {
    setModeOverride('main');
  };
  const setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>> = () => undefined;

  const handleMenuItemClick = (href?: string) => {
    if (!href) return;
    const [targetPath] = href.split('?');
    if (pathname !== targetPath) return;
    const nextMode = modeForPath(targetPath);
    setModeOverride(nextMode === 'main' ? null : nextMode);
  };

  React.useEffect(() => {
    setModeOverride(null);
  }, [pathname, searchParams]);

  return (
    <DrawerProvider>
      <MspDocumentsCrossFeatureProvider>
        <AlgadeskClientCrossFeatureProvider>
      <div className="flex h-screen overflow-hidden bg-gray-100" data-product-shell="algadesk">
        <SidebarWithFeatureFlags
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          mode={sidebarMode}
          onBackToMain={handleBackToMain}
          onMenuItemClick={handleMenuItemClick}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            rightSidebarOpen={false}
            setRightSidebarOpen={setRightSidebarOpen}
          />
          <PlatformNotificationBanner />
          <main className={`flex-1 overflow-hidden flex ${sidebarMode !== 'main' ? 'pt-0 pl-0 pr-3' : 'pt-2 px-3'}`}>
            <Body>{children}</Body>
          </main>
        </div>
      </div>
      <DrawerOutlet />
        </AlgadeskClientCrossFeatureProvider>
      </MspDocumentsCrossFeatureProvider>
    </DrawerProvider>
  );
}
