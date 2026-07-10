'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShortcutHelpDialog,
  ShortcutHintHud,
  useCatalogShortcut,
  useShortcutScope,
} from '@alga-psa/ui/keyboard-shortcuts';
import VimNavigationLayer from './VimNavigationLayer';
import { QUICK_CREATE_OPEN_EVENT } from './Header';

interface GlobalShortcutLayerProps {
  /** AlgaDesk has no /msp/assets surface (productSurfaceRegistry) — its shell passes false so 'g a' stays inert. */
  navAssetsEnabled?: boolean;
}

/**
 * Product-agnostic keyboard layer shared by the MSP shells (DefaultLayout and
 * AlgaDeskMspShell): the base 'page' shortcut scope, help/quick-create/
 * navigation actions, vim navigation, and the help dialog + hint HUD.
 * Product-specific actions (e.g. the AI chat toggles) stay in their shell.
 */
export default function GlobalShortcutLayer({
  navAssetsEnabled = true,
}: GlobalShortcutLayerProps): React.JSX.Element {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  const openHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);

  const quickCreate = useCallback(() => {
    const trigger = document.getElementById('global-quick-create-trigger');
    if (!(trigger instanceof HTMLElement)) {
      return false;
    }
    window.dispatchEvent(new CustomEvent(QUICK_CREATE_OPEN_EVENT));
  }, []);

  const goTickets = useCallback(() => {
    router.push('/msp/tickets');
  }, [router]);

  const goAssets = useCallback(() => {
    router.push('/msp/assets');
  }, [router]);

  const goClients = useCallback(() => {
    router.push('/msp/clients');
  }, [router]);

  useShortcutScope('page');
  useCatalogShortcut('global.openShortcuts', openHelp);
  useCatalogShortcut('global.quickCreate', quickCreate);
  useCatalogShortcut('navigation.goTickets', goTickets);
  useCatalogShortcut('navigation.goAssets', goAssets, { enabled: navAssetsEnabled });
  useCatalogShortcut('navigation.goClients', goClients);

  return (
    <>
      <VimNavigationLayer onOpenHelp={openHelp} />
      <ShortcutHelpDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <ShortcutHintHud />
    </>
  );
}
