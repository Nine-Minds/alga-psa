'use client';

import React, { createContext, useContext } from 'react';

type QuickAskContextValue = {
  aiAssistantAvailable: boolean;
  openQuickAsk: () => void;
};

const QuickAskContext = createContext<QuickAskContextValue>({
  aiAssistantAvailable: false,
  openQuickAsk: () => undefined,
});

export const QuickAskProvider: React.FC<{
  value: QuickAskContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <QuickAskContext.Provider value={value}>{children}</QuickAskContext.Provider>
);

export const useQuickAsk = () => useContext(QuickAskContext);
