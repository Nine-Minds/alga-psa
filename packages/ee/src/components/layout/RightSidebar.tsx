// Community Edition stub for Enterprise RightSidebar
// This feature is only available in Enterprise Edition
'use client';

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
}

const RightSidebar: React.FC<RightSidebarProps> = (props) => {
  // CE stub - should not be rendered as the parent component
  // shows a CE fallback, but this ensures type compatibility
  return null;
};

export default RightSidebar;
