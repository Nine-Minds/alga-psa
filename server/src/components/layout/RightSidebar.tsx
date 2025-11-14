// server/src/components/layout/RightSidebar.tsx
'use client';

import React, { useEffect, useId, Suspense, lazy, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';

interface RightSidebarProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
}

const resolvedEdition =
  (process.env.NEXT_PUBLIC_EDITION ?? process.env.EDITION ?? '').toLowerCase();
const isEnterpriseEditionEnv =
  resolvedEdition === 'enterprise' || resolvedEdition === 'ee';
const EnterpriseRightSidebar = lazy(
  () => import('@ee/components/layout/RightSidebar')
);

const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen,
  setIsOpen,
  ...props
}) => {
  const collapsibleId = useId();
  const [shouldUseEnterpriseSidebar, setShouldUseEnterpriseSidebar] = useState(
    isEnterpriseEditionEnv
  );

  useEffect(() => {
    if (isEnterpriseEditionEnv) {
      return;
    }
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        setShouldUseEnterpriseSidebar(true);
      }
    }
  }, [isEnterpriseEditionEnv]);

  if (shouldUseEnterpriseSidebar) {
    return (
      <Suspense
        fallback={
          <div className="fixed top-0 right-0 h-full bg-gray-50 w-96 shadow-xl">
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          </div>
        }
      >
        <EnterpriseRightSidebar isOpen={isOpen} setIsOpen={setIsOpen} {...props} />
      </Suspense>
    );
  }

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Content
        id={`right-sidebar-${collapsibleId}`}
        className={`fixed top-0 right-0 h-full bg-gray-50 w-96 shadow-xl overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex flex-col h-full border-l-2 border-gray-200">
          <div className="p-4">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Chat</h2>
            <p className="text-gray-600">
              The chat feature is only available in the Enterprise Edition.
            </p>
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

export default RightSidebar;
