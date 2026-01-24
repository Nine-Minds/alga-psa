// server/src/components/chat/QuickAskOverlay.tsx
'use client';

import React, { Suspense, lazy, useEffect, useState } from 'react';

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
  () => import('@ee/components/chat/QuickAskOverlay')
);

export const QuickAskOverlay: React.FC<QuickAskOverlayProps> = (props) => {
  const [shouldUseEnterprise, setShouldUseEnterprise] = useState(isEnterpriseEditionEnv);

  useEffect(() => {
    if (isEnterpriseEditionEnv) {
      return;
    }
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        setShouldUseEnterprise(true);
      }
    }
  }, []);

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

