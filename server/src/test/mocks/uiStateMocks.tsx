import React from 'react';

// Mock UIStateProvider
export const MockUIStateProvider = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};

// Mock hooks
export const mockUseUIState = () => ({
  state: {},
  dispatch: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
});

export const mockUseRegisterUIComponent = () => ({
  register: jest.fn(),
  unregister: jest.fn(),
  updateMetadata: jest.fn(),
});

export const mockUseAutomationIdAndRegister = () => ({
  automationIdProps: {},
  updateMetadata: jest.fn(),
});