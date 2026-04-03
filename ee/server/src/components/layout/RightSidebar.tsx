// ee/server/src/components/layout/RightSidebar.tsx
'use client';

import React, { lazy, Suspense } from 'react';
import { ADD_ONS } from '@alga-psa/types';
import { useTier } from 'server/src/context/TierContext';

const RightSidebarContent = lazy(() => import('./RightSidebarContent'));

interface RightSidebarProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onRequestClose?: () => void;
  clientUrl: string;
  accountId: string;
  messages: any[];
  userId: string | null;
  userRole: string;
  selectedAccount: string;
  handleSelectAccount: any;
  auth_token: string;
  setChatTitle: any;
  isTitleLocked: boolean;
  handoffChatId?: string | null;
  handoffNonce?: number;
  onInterruptibleStateChange?: (isInterruptible: boolean) => void;
  onRegisterCancelHandler?: (cancelHandler: (() => void) | null) => void;
}

const RightSidebar: React.FC<RightSidebarProps> = (props) => {
  const { hasAddOn } = useTier();

  if (!props.isOpen || !hasAddOn(ADD_ONS.AI_ASSISTANT)) {
    return null;
  }

  return (
    <Suspense fallback={
      <div className="fixed top-0 right-0 z-[45] h-full bg-gray-50 w-96 shadow-xl">
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </div>
    }>
      <RightSidebarContent {...props} />
    </Suspense>
  );
};

export default RightSidebar;
