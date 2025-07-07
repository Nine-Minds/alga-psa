/**
 * Test setup file for EE server tests
 * This file runs before each test file and configures the test environment
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Next.js router
vi.mock('next/router', () => ({
  useRouter() {
    return {
      route: '/',
      pathname: '/',
      query: {},
      asPath: '/',
      push: vi.fn(),
      pop: vi.fn(),
      reload: vi.fn(),
      back: vi.fn(),
      prefetch: vi.fn(),
      beforePopState: vi.fn(),
      events: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      },
      isFallback: false,
    };
  },
}));

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    };
  },
  useSearchParams() {
    return new URLSearchParams();
  },
  usePathname() {
    return '/';
  },
}));

// Set test environment variables  
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}
process.env.NEXTAUTH_SECRET = 'test-secret';

// Console warnings that we want to suppress in tests
const originalConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  const message = args[0];
  if (
    typeof message === 'string' &&
    (message.includes('Warning: ReactDOM.render is deprecated') ||
     message.includes('Warning: componentWillReceiveProps') ||
     message.includes('Warning: componentWillMount'))
  ) {
    return;
  }
  originalConsoleWarn(...args);
};