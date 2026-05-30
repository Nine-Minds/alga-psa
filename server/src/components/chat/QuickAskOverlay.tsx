// server/src/components/chat/QuickAskOverlay.tsx
'use client';

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useTier } from '@/context/TierContext';

interface QuickAskOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenInSidebar: (chatId: string) => void;

  clientUrl: string;
  accountId: string;
  messages: any[];
  userRole: string;
  userId: string | null;
  selectedAccount: string;
  handleSelectAccount: any;
  auth_token: string;
  setChatTitle: any;
  isTitleLocked: boolean;
  hf: any;
}

const resolvedEdition =
  (process.env.NEXT_PUBLIC_EDITION ?? process.env.EDITION ?? '').toLowerCase();
const isEnterpriseEditionEnv =
  resolvedEdition === 'enterprise' || resolvedEdition === 'ee';

const EnterpriseQuickAskOverlay = lazy(
  () => import('@enterprise/components/chat/QuickAskOverlay')
);

export const QuickAskOverlay: React.FC<QuickAskOverlayProps> = (props) => {
  const { eeEnabled } = useTier();
  // Module-presence guard (isEnterpriseEditionEnv) keeps the lazy import target
  // in the bundle; the render decision uses eeEnabled so the EE overlay is hidden
  // at the essentials tier.
  const [shouldUseEnterprise, setShouldUseEnterprise] = useState(isEnterpriseEditionEnv && eeEnabled);

  useEffect(() => {
    setShouldUseEnterprise(isEnterpriseEditionEnv && eeEnabled);
    if (isEnterpriseEditionEnv && eeEnabled) {
      return;
    }
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        setShouldUseEnterprise(isEnterpriseEditionEnv);
      }
    }
  }, [eeEnabled]);

  if (!shouldUseEnterprise) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <EnterpriseQuickAskOverlay {...props} />
    </Suspense>
  );
};

export default QuickAskOverlay;
