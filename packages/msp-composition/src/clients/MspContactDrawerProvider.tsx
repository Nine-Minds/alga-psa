'use client';

import React, { useCallback, useMemo, type ReactNode } from 'react';
import { ContactDrawerContext, type ContactDrawerOptions } from '@alga-psa/ui';
import { useContactQuickViewDrawer } from '@alga-psa/clients/components/contacts/bento/useContactQuickViewDrawer';

/**
 * Lets a feature package open a contact's quick view in the shared drawer
 * without importing @alga-psa/clients — the asset page's assignee, for one,
 * which used to navigate away to /msp/contacts/[id] and lose the asset.
 *
 * Mounted per surface rather than in WorkspaceProviders so the contact quick
 * view tree only reaches the routes that actually offer it.
 */
export function MspContactDrawerProvider({ children }: { children: ReactNode }) {
  const openContactQuickView = useContactQuickViewDrawer();

  const openContactDrawer = useCallback((contactId: string, options?: ContactDrawerOptions) => {
    if (!contactId) return;
    void openContactQuickView(contactId, { onChangesSaved: options?.onChangesSaved });
  }, [openContactQuickView]);

  const contextValue = useMemo(() => ({ openContactDrawer }), [openContactDrawer]);

  return (
    <ContactDrawerContext value={contextValue}>
      {children}
    </ContactDrawerContext>
  );
}
