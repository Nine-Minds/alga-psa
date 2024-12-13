// server/src/components/layout/RightSidebar.tsx
import React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';

interface RightSidebarProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  companyUrl: string;
  accountId: string;
  messages: any[];
  userRole: string;
  selectedAccount: string;
  handleSelectAccount: any;
  auth_token: string;
  setChatTitle: any;
  isTitleLocked: boolean;
}

const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen,
  setIsOpen
}) => {
  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Content
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
