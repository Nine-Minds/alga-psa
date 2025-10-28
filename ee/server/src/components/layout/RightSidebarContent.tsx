'use client';

// ee/server/src/components/layout/RightSidebarContent.tsx
import React, { useState, useEffect } from 'react';
import { Chat } from '../chat/Chat';
import { HfInference } from '@huggingface/inference';
import * as Collapsible from '@radix-ui/react-collapsible';
import { PlusIcon } from '@radix-ui/react-icons';

import '../chat/chat.css';

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

const RightSidebarContent: React.FC<RightSidebarProps> = ({
  isOpen,
  setIsOpen,
  clientUrl,
  accountId,
  messages,
  userRole,
  userId,
  selectedAccount,
  handleSelectAccount,
  auth_token,
  setChatTitle,
  isTitleLocked
}) => {
  const [chatKey, setChatKey] = useState(0);
  const [hf, setHf] = useState<HfInference | null>(null);

  useEffect(() => {
    if (auth_token && !hf) {
      const inference = new HfInference(auth_token);
      setHf(inference);
    }
  }, [auth_token]);

  const handleNewChat = () => {
    setChatKey(prev => prev + 1);
  };

  const handleUserInput = () => {
    if (!hf && auth_token) {
      const inference = new HfInference(auth_token);
      setHf(inference);
    }
  };

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Content className={`fixed top-0 right-0 h-full bg-gray-50 w-96 shadow-xl overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}>
        <div className="flex flex-col h-full border-l-2 border-gray-200">
          <div className="p-4 bg-white border-b-2 border-gray-200">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Chat</h2>
              <button className="text-xl font-bold text-gray-800" onClick={handleNewChat}>
                <PlusIcon />
              </button>
            </div>
          </div>
          <div className="flex-grow overflow-y-auto">
            <div className="p-4 bg-gray-100 text-sm text-gray-500 border-b border-gray-200">
              Chat with AI - Ask anything!
            </div>
            {hf && ( // Only render Chat when hf is initialized
              <Chat
                key={chatKey}
                clientUrl={clientUrl}
                accountId={accountId}
                messages={messages}
                userRole={userRole}
                userId={userId}
                selectedAccount={selectedAccount}
                handleSelectAccount={handleSelectAccount}
                auth_token={auth_token}
                setChatTitle={setChatTitle}
                isTitleLocked={isTitleLocked}
                onUserInput={handleUserInput}
                hf={hf} // Pass hf instead of chatModel
              />
            )}
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

export default RightSidebarContent;
