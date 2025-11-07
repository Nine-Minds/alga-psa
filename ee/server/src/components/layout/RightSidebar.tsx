// ee/server/src/components/layout/RightSidebar.tsx
'use client';

import React, { lazy, Suspense } from 'react';

const RightSidebarContent = lazy(() => import('./RightSidebarContent'));

interface RightSidebarProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
}

const RightSidebar: React.FC<RightSidebarProps> = (props) => {
  if (!props.isOpen) {
    return null;
  }

  return (
    <Suspense fallback={
      <div className="fixed top-0 right-0 h-full bg-gray-50 w-96 shadow-xl">
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
