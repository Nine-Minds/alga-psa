import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { 
  setupE2ETestEnvironment,
  E2ETestEnvironment
} from '../utils/e2eTestSetup';
import { withoutTestUserPermission } from '../utils/simpleRoleSetup';
import { createUserTestData } from '../utils/userTestData';
import { ApiTestClient, createTestApiKey } from '../utils/apiTestHelpers';

describe('Users API E2E Tests', () => {
  let env: E2ETestEnvironment;
  let createdUserIds: string[] = [];

  beforeAll(async () => {
    // Setup test environment
    env = await setupE2ETestEnvironment({
      clientName: 'Users API Test Client',
      userName: 'users_api_test'
    });
  });

  afterAll(async () => {
    // Clean up any created users
    for (const userId of createdUserIds) {
      try {
        await env.apiClient.delete(`/api/v1/users/${userId}`);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    
    // Clean up test environment
    await env.cleanup();
  });

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const client = new ApiTestClient({
        baseUrl: process.env.TEST_API_BASE_URL!,
      });
      const response = await client.get('/api/v1/users');
      
      expect(response.status).toBe(401);
      expect(response.data.error.message).toBe('API key required');
    });

    it('should reject requests with invalid API key', async () => {
      const client = new ApiTestClient({
        baseUrl: process.env.TEST_API_BASE_URL!,
        apiKey: 'invalid-key',
      });
      const response = await client.get('/api/v1/users');
      
      expect(response.status).toBe(401);
      expect(response.data.error.message).toBe('Invalid API key');
    });

    it('should accept requests with valid API key', async () => {
      const response = await env.apiClient.get('/api/v1/users');
      
      if (response.status !== 200) {
        console.error('List users failed:', response.status, JSON.stringify(response.data, null, 2));
      }
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('data');
      expect(response.data).toHaveProperty('pagination');
    });
  });

  describe('CRUD Operations', () => {
    it('should create a user', async () => {
      const userData = createUserTestData();
      const response = await env.apiClient.post('/api/v1/users', userData);
      
      if (response.status !== 201) {
        console.error('Create user failed:', response.status, JSON.stringify(response.data, null, 2));
      }
      
      expect(response.status).toBe(201);
      expect(response.data.data).toMatchObject({
        username: userData.username,
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name
      });
      expect(response.data.data.user_id).toBeTruthy();
      
      createdUserIds.push(response.data.data.user_id);
    });

    it('should get a user by ID', async () => {
      // Create a user first
      const userData = createUserTestData();
      const createResponse = await env.apiClient.post('/api/v1/users', userData);
      
      // Debug the response structure
      if (createResponse.status !== 201) {
        console.error('Create user failed:', createResponse.status, JSON.stringify(createResponse.data, null, 2));
      }
      
      // Handle different response structures
      let userId;
      if (createResponse.data && createResponse.data.data && createResponse.data.data.user_id) {
        userId = createResponse.data.data.user_id;
      } else if (createResponse.data && createResponse.data.user_id) {
        userId = createResponse.data.user_id;
      } else {
        console.error('Unexpected response structure:', JSON.stringify(createResponse.data, null, 2));
        throw new Error('Could not extract user_id from create response');
      }
      
      createdUserIds.push(userId);
      
      // Get the user
      const response = await env.apiClient.get(`/api/v1/users/${userId}`);
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        user_id: userId,
        username: userData.username,
        email: userData.email
      });
    });

    it('should update a user', async () => {
      // Create a user first
      const userData = createUserTestData();
      const createResponse = await env.apiClient.post('/api/v1/users', userData);
      
      // Debug the response
      if (createResponse.status !== 201) {
        console.error('Create user failed:', createResponse.status, JSON.stringify(createResponse.data, null, 2));
      }
      
      // Handle different response structures
      let userId;
      if (createResponse.data && createResponse.data.data && createResponse.data.data.user_id) {
        userId = createResponse.data.data.user_id;
      } else if (createResponse.data && createResponse.data.user_id) {
        userId = createResponse.data.user_id;
      } else {
        console.error('Create response structure:', JSON.stringify(createResponse.data, null, 2));
        throw new Error('Could not extract user_id from create response');
      }
      
      createdUserIds.push(userId);
      
      // Update the user
      const updateData = {
        first_name: 'Updated',
        last_name: 'Name',
        phone: '+1234567890'
      };
      const response = await env.apiClient.put(`/api/v1/users/${userId}`, updateData);
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        user_id: userId,
        first_name: updateData.first_name,
        last_name: updateData.last_name,
        phone: updateData.phone
      });
    });

    it('should delete a user', async () => {
      // Create a user first
      const userData = createUserTestData();
      const createResponse = await env.apiClient.post('/api/v1/users', userData);
      
      // Debug the response
      if (createResponse.status !== 201) {
        console.error('Create user failed:', createResponse.status, JSON.stringify(createResponse.data, null, 2));
      }
      
      // Handle different response structures
      let userId;
      if (createResponse.data && createResponse.data.data && createResponse.data.data.user_id) {
        userId = createResponse.data.data.user_id;
      } else if (createResponse.data && createResponse.data.user_id) {
        userId = createResponse.data.user_id;
      } else {
        console.error('Create response structure:', JSON.stringify(createResponse.data, null, 2));
        throw new Error('Could not extract user_id from create response');
      }
      
      // Delete the user
      const response = await env.apiClient.delete(`/api/v1/users/${userId}`);
      
      expect(response.status).toBe(204);
      
      // Verify it's deleted
      const getResponse = await env.apiClient.get(`/api/v1/users/${userId}`);
      expect(getResponse.status).toBe(404);
    });

    it('should list users with pagination', async () => {
      // Create multiple users
      for (let i = 0; i < 5; i++) {
        const userData = createUserTestData();
        const response = await env.apiClient.post('/api/v1/users', userData);
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        createdUserIds.push(response.data.data.user_id);
      }
      
      // List users
      const response = await env.apiClient.get('/api/v1/users?limit=3&page=1');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data).toHaveLength(3);
      expect(response.data.pagination).toMatchObject({
        page: 1,
        limit: 3,
        total: expect.any(Number)
      });
    });
  });

  describe('User Search', () => {
    it('should search users by query', async () => {
      // Create test users with different attributes
      const timestamp = Date.now();
      const testUserIds: string[] = [];
      const users = [
        { first_name: 'John', last_name: 'Doe', email: `john.doe.${timestamp}@test.com` },
        { first_name: 'Jane', last_name: 'Smith', email: `jane.smith.${timestamp}@test.com` },
        { first_name: 'Bob', last_name: 'Johnson', email: `bob.johnson.${timestamp}@test.com` }
      ];

      for (const user of users) {
        const response = await env.apiClient.post('/api/v1/users', createUserTestData(user));
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        testUserIds.push(response.data.data.user_id);
        createdUserIds.push(response.data.data.user_id);
      }

      // The unique fixture timestamp must find the three newly created users.
      const response = await env.apiClient.get(`/api/v1/users/search?query=${timestamp}`);

      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBeGreaterThan(0);

      expect(response.data.data.map((user: any) => user.user_id).sort()).toEqual([...testUserIds].sort());
    });
  });

  describe('User Statistics', () => {
    it('should get user statistics', async () => {
      const response = await env.apiClient.get('/api/v1/users/stats');
      
      if (response.status !== 200) {
        console.error('Stats failed:', response.status, JSON.stringify(response.data, null, 2));
      }
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        total_users: expect.any(Number),
        active_users: expect.any(Number),
        inactive_users: expect.any(Number),
        users_by_type: expect.any(Object)
      });
    });
  });

  describe('User Activity', () => {
    it('should get user activity', async () => {
      const response = await env.apiClient.get('/api/v1/users/activity');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.pagination).toBeDefined();
    });
  });

  describe('User Permissions and Roles', () => {
    let testUserId: string;

    beforeEach(async () => {
      // Create a test user
      const userData = createUserTestData();
      const response = await env.apiClient.post('/api/v1/users', userData);
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      testUserId = response.data.data.user_id;
      createdUserIds.push(testUserId);
    });

    it('should get user permissions', async () => {
      const response = await env.apiClient.get(`/api/v1/users/${testUserId}/permissions`);
      
      if (response.status !== 200) {
        console.error('Permissions failed:', response.status, JSON.stringify(response.data, null, 2));
      }
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        user_id: testUserId,
        permissions: expect.any(Array),
        roles: expect.any(Array),
        effective_permissions: expect.any(Array)
      });
    });

    it('should get user roles', async () => {
      const response = await env.apiClient.get(`/api/v1/users/${testUserId}/roles`);
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
    });
  });

  describe('Password Management', () => {
    let testUserId: string;
    let ownClient: ApiTestClient;
    let originalHash: string;
    const currentPassword = 'TestPassword123!';
    const replacementPassword = 'NewPassword123!';
    const storedHash = async () => (await env.db('users')
      .where({ tenant: env.tenant, user_id: testUserId }).first('hashed_password')).hashed_password;

    beforeEach(async () => {
      const response = await env.apiClient.post('/api/v1/users', createUserTestData({ password: currentPassword, user_type: 'internal' }));
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      testUserId = response.data.data.user_id;
      createdUserIds.push(testUserId);
      originalHash = await storedHash();
      const key = await createTestApiKey(env.db, testUserId, env.tenant);
      ownClient = new ApiTestClient({ baseUrl: process.env.TEST_API_BASE_URL!, apiKey: key.api_key });
    });

    it('rejects another user password change without administrator permission and preserves the password', async () => {
      const response = await env.apiClient.put(`/api/v1/users/${testUserId}/password`, {
        new_password: replacementPassword, confirm_password: replacementPassword,
      });
      expect(response.status).toBe(403);
      expect(response.data.error).toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('administrators') });
      expect(await storedHash()).toBe(originalHash);
    });

    it.each([undefined, 'WrongPassword123!'])('rejects an invalid current password (%s) without modifying it', async (password) => {
      const response = await ownClient.put(`/api/v1/users/${testUserId}/password`, {
        current_password: password, new_password: replacementPassword, confirm_password: replacementPassword,
      });
      expect(response.status).toBe(400);
      expect(response.data.error).toMatchObject({
        code: 'VALIDATION_ERROR', message: password ? 'Current password is incorrect' : 'Current password is required',
      });
      expect(await storedHash()).toBe(originalHash);
    });

    it('changes the password as its owner and uses the persisted replacement for a subsequent change', async () => {
      const path = `/api/v1/users/${testUserId}/password`;
      const first = await ownClient.put(path, {
        current_password: currentPassword, new_password: replacementPassword, confirm_password: replacementPassword,
      });
      expect(first.status, JSON.stringify(first.data)).toBe(200);
      const replacementHash = await storedHash();
      expect(replacementHash).not.toBe(originalHash);
      expect(replacementHash).not.toBe(replacementPassword);
      const second = await ownClient.put(path, {
        current_password: replacementPassword, new_password: 'FinalPassword789!', confirm_password: 'FinalPassword789!',
      });
      expect(second.status, JSON.stringify(second.data)).toBe(200);
      expect(await storedHash()).not.toBe(replacementHash);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent user', async () => {
      const response = await env.apiClient.get('/api/v1/users/00000000-0000-0000-0000-000000000000');
      
      expect(response.status).toBe(404);
      expect(response.data.error.message).toContain('not found');
    });

    it('should return 400 for invalid user data', async () => {
      const invalidData = {
        username: '', // Required field
        email: 'invalid-email' // Invalid format
      };
      
      const response = await env.apiClient.post('/api/v1/users', invalidData);
      
      expect(response.status).toBe(400);
      expect(response.data.error.message).toContain('Validation failed');
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await env.apiClient.get('/api/v1/users/invalid-uuid');
      
      expect(response.status).toBe(400);
      expect(response.data.error.message).toBeDefined();
    });

    it('should prevent duplicate usernames', async () => {
      const userData = createUserTestData();
      
      // Create first user
      const response1 = await env.apiClient.post('/api/v1/users', userData);
      if (response1.status === 201) {
        // Handle different response structures
        let userId;
        if (response1.data && response1.data.data && response1.data.data.user_id) {
          userId = response1.data.data.user_id;
        } else if (response1.data && response1.data.user_id) {
          userId = response1.data.user_id;
        }
        if (userId) {
          createdUserIds.push(userId);
        }
      }
      
      // Try to create second user with same username
      const response2 = await env.apiClient.post('/api/v1/users', userData);
      
      expect(response2.status).toBe(409);
      expect(response2.data.error.message).toContain('already exists');
    });
  });

  describe('Filtering', () => {
    beforeEach(async () => {
      // Create test users with different attributes
      const users = [
        { user_type: 'internal', is_inactive: false },
        { user_type: 'client', is_inactive: false },
        { user_type: 'internal', is_inactive: true }
      ];
      
      for (const user of users) {
        const response = await env.apiClient.post('/api/v1/users', createUserTestData(user));
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        createdUserIds.push(response.data.data.user_id);
      }
    });

    it('should filter users by type', async () => {
      const response = await env.apiClient.get('/api/v1/users?user_type=internal');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBeGreaterThan(0);
      response.data.data.forEach((user: any) => {
        expect(user.user_type).toBe('internal');
      });
    });

    it('should filter users by active status', async () => {
      const response = await env.apiClient.get('/api/v1/users?is_inactive=false');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBeGreaterThan(0);
      response.data.data.forEach((user: any) => {
        expect(user.is_inactive).toBe(false);
      });
    });
  });

  describe('Permissions', () => {
    it('denies listing without user read permission and permits it after restoration', async () => {
      expect((await env.apiClient.get('/api/v1/users')).status).toBe(200);
      await withoutTestUserPermission(env.db, env.userId, env.tenant, 'user', 'read', async () => {
        const denied = await env.apiClient.get('/api/v1/users');
        expect(denied.status, JSON.stringify(denied.data)).toBe(403);
        expect((await env.apiClient.get('/api/v1/clients')).status).toBe(200);
      });
      expect((await env.apiClient.get('/api/v1/users')).status).toBe(200);
    });

    it('denies user creation without a grant without writing users or roles', async () => {
      const userData = createUserTestData({ user_type: 'internal' });
      const persisted = async () => ({
        users: await env.db('users').where({ tenant: env.tenant }).orderBy('user_id'),
        roles: await env.db('user_roles').where({ tenant: env.tenant }).orderBy(['user_id', 'role_id']),
      });
      await withoutTestUserPermission(env.db, env.userId, env.tenant, 'user', 'create', async () => {
        const before = await persisted();
        const denied = await env.apiClient.post('/api/v1/users', userData);
        expect(denied.status, JSON.stringify(denied.data)).toBe(403);
        expect(await persisted()).toEqual(before);
        expect((await env.apiClient.get('/api/v1/users')).status).toBe(200);
      });
      const allowed = await env.apiClient.post('/api/v1/users', userData);
      expect(allowed.status, JSON.stringify(allowed.data)).toBe(201);
      createdUserIds.push(allowed.data.data.user_id);
      const reopened = await env.apiClient.get(`/api/v1/users/${allowed.data.data.user_id}`);
      expect(reopened.status).toBe(200);
      expect(reopened.data.data).toMatchObject({ username: userData.username, user_type: 'internal' });
      expect(await env.db('users').where({ tenant: env.tenant, user_id: allowed.data.data.user_id }).first())
        .toMatchObject({ username: userData.username, email: userData.email, user_type: 'internal' });
    });
  });
});
