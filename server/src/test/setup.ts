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

// Mock storage provider to avoid importing Node fs in jsdom context
vi.mock('../lib/storage/StorageProviderFactory', () => ({
  __esModule: true,
  StorageProviderFactory: {
    createProvider: vi.fn(async () => ({
      putObject: vi.fn(),
      getObjectStream: vi.fn(),
      deleteObject: vi.fn(),
      exists: vi.fn(),
    })),
  },
  generateStoragePath: vi.fn(() => 'mock/path/file.txt'),
}));
