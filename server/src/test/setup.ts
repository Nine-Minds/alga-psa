import '@testing-library/jest-dom'
import { vi } from 'vitest';

// Add ResizeObserver polyfill
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock UI reflection hooks
vi.mock('../types/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('../types/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => vi.fn(),
}));

vi.mock('../types/ui-reflection/useRegisterChild', () => ({
  useRegisterChild: () => ({
    register: vi.fn(),
    unregister: vi.fn(),
  }),
}));

vi.mock('../types/ui-reflection/UIStateContext', () => ({
  useUIState: () => ({
    state: {},
    dispatch: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
  UIStateProvider: ({ children }: { children: React.ReactNode }) => children,
}))

