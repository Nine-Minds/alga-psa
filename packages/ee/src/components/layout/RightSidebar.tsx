// CE stub for RightSidebar (EE feature)
// In EE builds, @enterprise resolves directly to ee/server/src, bypassing this file.
// In CE builds, this stub returns null since the AI sidebar requires Enterprise Edition.

import React from 'react';

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
  handoffChatId?: string | null;
  handoffNonce?: number;
}

const RightSidebar: React.FC<RightSidebarProps> = () => {
  return null;
};

export default RightSidebar;
