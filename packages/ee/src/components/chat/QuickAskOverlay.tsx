'use client';

// CE stub for QuickAskOverlay (EE feature)
// In EE builds, @enterprise resolves directly to ee/server/src, bypassing this file.
// In CE builds, this stub returns null since Quick Ask requires Enterprise Edition.

import React from 'react';

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

export const QuickAskOverlay: React.FC<QuickAskOverlayProps> = () => {
  return null;
};

export default QuickAskOverlay;
