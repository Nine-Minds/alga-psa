'use client';

// ee/server/src/components/layout/RightSidebarContent.tsx
import React, { useState, useEffect, useRef } from 'react';
import { usePostHog } from 'posthog-js/react';
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
  const posthog = usePostHog();
  const [chatKey, setChatKey] = useState(0);
  const [hf, setHf] = useState<HfInference | null>(null);
  const [width, setWidth] = useState(384);
  const [isResizing, setIsResizing] = useState(false);
  const [aiFeatureEnabled, setAiFeatureEnabled] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(384);

  useEffect(() => {
    if (auth_token && !hf) {
      const inference = new HfInference(auth_token);
      setHf(inference);
    }
  }, [auth_token]);

  useEffect(() => {
    if (!posthog) return;

    posthog.onFeatureFlags(function() {
      // feature flags should be available at this point
      if (posthog.isFeatureEnabled('AI-stuff')) {
        setAiFeatureEnabled(true);
      }
    });
  }, [posthog]);

  const handleNewChat = () => {
    setChatKey(prev => prev + 1);
  };

  const handleUserInput = () => {
    if (!hf && auth_token) {
      const inference = new HfInference(auth_token);
      setHf(inference);
    }
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizing) return;
      const delta = startXRef.current - event.clientX;
      const newWidth = Math.min(Math.max(startWidthRef.current + delta, 280), 640);
      if (newWidth !== width) {
        setWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, width]);

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizing(true);
    startXRef.current = event.clientX;
    startWidthRef.current = width;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Content
        style={{ width: `${width}px` }}
        ref={sidebarRef}
        className={`fixed top-0 right-0 h-full bg-gray-50 shadow-xl overflow-hidden transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          className="absolute top-0 left-0 h-full w-1 cursor-col-resize z-10 transition-colors hover:bg-gray-300/40 active:bg-gray-400/40"
          onMouseDown={startResize}
          aria-hidden="true"
        />
        <div className="flex flex-col h-full border-l-2 border-gray-200 pl-1">
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
            {hf && aiFeatureEnabled && ( // Only render Chat when hf is initialized and AI-stuff feature flag is enabled
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
