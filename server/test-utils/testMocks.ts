import { vi } from 'vitest';
import { IUserWithRoles } from '../src/interfaces/auth.interfaces';

const currentUserRef = vi.hoisted(() => ({
  user: {
    user_id: 'mock-user-id',
    tenant: '11111111-1111-1111-1111-111111111111',
    username: 'mock-user',
    first_name: 'Mock',
    last_name: 'User',
    email: 'mock.user@example.com',
    hashed_password: 'hashed_password_here',
    is_inactive: false,
    user_type: 'internal',
    roles: []
  } as IUserWithRoles
}));

const sessionUserRef = vi.hoisted(() => ({
  user: {
    id: 'mock-user-id',
    tenant: '11111111-1111-1111-1111-111111111111'
  }
}));

const permissionRef = vi.hoisted(() => ({
  value: ['user_schedule:update', 'user_schedule:read'] as string[]
}));

const permissionCheckRef = vi.hoisted(() => ({
  fn: (user: IUserWithRoles, resource?: string, action?: string) =>
    user.roles?.some(role => role.role_name.toLowerCase() === 'admin') ?? true
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve(currentUserRef.user)),
  getCurrentUserPermissions: vi.fn(() => Promise.resolve(permissionRef.value))
}));

vi.mock('@/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve(currentUserRef.user)),
  getCurrentUserPermissions: vi.fn(() => Promise.resolve(permissionRef.value))
}));

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(() => Promise.resolve({ user: sessionUserRef.user }))
}));

vi.mock('@/lib/auth/getSession', () => ({
  getSession: vi.fn(() => Promise.resolve({ user: sessionUserRef.user }))
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn((user: IUserWithRoles, resource: string, action: string) =>
    Promise.resolve(permissionCheckRef.fn(user, resource, action))
  )
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn((user: IUserWithRoles, resource: string, action: string) =>
    Promise.resolve(permissionCheckRef.fn(user, resource, action))
  )
}));

/**
 * Creates a mock Headers object with tenant context
 * @param tenantId Optional tenant ID (defaults to a test UUID)
 * @returns Mock Headers object
 */
export const createMockHeaders = (tenantId: string = '11111111-1111-1111-1111-111111111111') => ({
  get: vi.fn((key: string) => {
    if (key === 'x-tenant-id') {
      return tenantId;
    }
    return null;
  }),
  append: vi.fn(),
  delete: vi.fn(),
  entries: vi.fn(),
  forEach: vi.fn(),
  has: vi.fn(),
  keys: vi.fn(),
  set: vi.fn(),
  values: vi.fn(),
});

/**
 * Sets up next/headers mock
 * @param tenantId Optional tenant ID for the headers
 */
export function mockNextHeaders(tenantId?: string) {
  const mockHeaders = createMockHeaders(tenantId);
  vi.mock('next/headers', () => ({
    headers: vi.fn(() => mockHeaders)
  }));
  return mockHeaders;
}

/**
 * Sets up next-auth session mock
 * @param userId Optional user ID for the session
 * @param tenantId Optional tenant ID for the session
 */
export function mockNextAuth(userId: string = 'mock-user-id', tenantId: string = '11111111-1111-1111-1111-111111111111') {
  vi.mock('next-auth/next', () => ({
    getServerSession: vi.fn(() => Promise.resolve({
      user: {
        id: userId,
        tenant: tenantId
      },
    })),
  }));

  vi.mock('@/app/api/auth/[...nextauth]/options', () => ({
    options: {},
  }));
}

/**
 * Sets up next/cache mock
 */
export function mockNextCache() {
  vi.mock('next/cache', () => ({
    revalidatePath: vi.fn(),
  }));
}

/**
 * Sets up RBAC mock with custom permission logic
 * @param permissionCheck Function to determine if a user has permission
 */
export function mockRBAC(
  permissionCheck: (user: IUserWithRoles, resource?: string, action?: string) => boolean =
    (user) => user.roles?.some(role => role.role_name.toLowerCase() === 'admin') ?? true
) {
  permissionCheckRef.fn = permissionCheck;
}

/**
 * Sets up getCurrentUser mock
 * @param mockUser The user object to return
 */
export function mockGetCurrentUser(mockUser: IUserWithRoles) {
  currentUserRef.user = mockUser;
}

export function setMockPermissions(permissions: string[]) {
  permissionRef.value = permissions;
}

export function setMockUser(
  user: IUserWithRoles,
  permissions: string[] = ['user_schedule:update', 'user_schedule:read']
) {
  mockGetCurrentUser(user);
  permissionRef.value = permissions;
}

/**
 * Helper to create a mock user with roles
 * @param type User type ('internal' or 'client')
 * @param overrides Optional user property overrides
 * @returns Mock user object
 */
export function createMockUser(
  type: 'internal' | 'client' = 'internal',
  overrides: Partial<IUserWithRoles> & Record<string, any> = {}
): IUserWithRoles {
  return {
    user_id: overrides.user_id || 'mock-user-id',
    tenant: overrides.tenant || '11111111-1111-1111-1111-111111111111',
    username: overrides.username || `mock-${type}`,
    first_name: overrides.first_name || 'Mock',
    last_name: overrides.last_name || type === 'internal' ? 'Internal' : 'Client',
    email: overrides.email || `mock.${type}@example.com`,
    hashed_password: overrides.hashed_password || 'hashed_password_here',
    is_inactive: overrides.is_inactive || false,
    user_type: type,
    roles: overrides.roles || [],
    ...overrides
  } as IUserWithRoles;
}

/**
 * Sets up all common mocks with default configuration
 * @param options Optional configuration for the mocks
 */
export function setupCommonMocks(options: {
  tenantId?: string;
  userId?: string;
  user?: IUserWithRoles;
  permissionCheck?: (user: IUserWithRoles, resource?: string, action?: string) => boolean;
  permissions?: string[];
} = {}) {
  const tenantId = options.tenantId || '11111111-1111-1111-1111-111111111111';
  const userId = options.userId || 'mock-user-id';
  const user = options.user || createMockUser('internal', { user_id: userId, tenant: tenantId });

  mockNextHeaders(tenantId);
  mockNextAuth(userId, tenantId);
  mockNextCache();
  mockRBAC(options.permissionCheck);
  setMockUser(user, options.permissions ?? permissionRef.value);
  sessionUserRef.user = {
    id: user.user_id,
    tenant: tenantId
  };

  return { tenantId, userId, user };
}
