import { vi } from 'vitest';
import { TestContext } from './testContext';

// Mock Next.js headers
vi.mock('next/headers', () => ({
  headers: () => new Map([
    ['x-tenant-id', TestContext.currentTenantId]
  ]),
  cookies: () => new Map()
}));

// Mock Next.js auth session
vi.mock('next-auth/next', () => ({
  getServerSession: () => Promise.resolve({
    user: {
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      tenant: TestContext.currentTenantId
    }
  })
}));

// Mock Next.js options
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({
  options: {
    providers: []
  }
}));
