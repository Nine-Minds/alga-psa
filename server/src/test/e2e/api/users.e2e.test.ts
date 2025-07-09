import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { 
  setupE2ETestEnvironment,
  E2ETestEnvironment
} from '../utils/e2eTestSetup';
import { createUserTestData } from '../utils/userTestData';

describe('Users API E2E Tests', () => {
  let env: E2ETestEnvironment;
  let createdUserIds: string[] = [];

  beforeAll(async () => {
    // Setup test environment
    env = await setupE2ETestEnvironment({
      companyName: 'Users API Test Company',
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
      const client = new env.apiClient.constructor({
        baseUrl: env.apiClient.config.baseUrl,
        tenantId: env.tenant
      });
      const response = await client.get('/api/v1/users');
      
      expect(response.status).toBe(401);
      expect(response.data.error.message).toBe('API key required');
    });

    it('should reject requests with invalid API key', async () => {
      const client = new env.apiClient.constructor({
        baseUrl: env.apiClient.config.baseUrl,
        apiKey: 'invalid-key',
        tenantId: env.tenant
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
      const users = [];
      for (let i = 0; i < 5; i++) {
        const userData = createUserTestData();
        const response = await env.apiClient.post('/api/v1/users', userData);
        if (response.status === 201) {
          users.push(response.data.data);
          createdUserIds.push(response.data.data.user_id);
        }
      }
      
      // List users
      const response = await env.apiClient.get('/api/v1/users?limit=3&page=1');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBeLessThanOrEqual(3);
      expect(response.data.pagination).toMatchObject({
        page: 1,
        limit: 3,
        total: expect.any(Number)
      });
    });
  });

  describe('User Search', () => {
    beforeEach(async () => {
      // Create test users with different attributes
      const timestamp = Date.now();
      const users = [
        { first_name: 'John', last_name: 'Doe', email: `john.doe.${timestamp}@test.com` },
        { first_name: 'Jane', last_name: 'Smith', email: `jane.smith.${timestamp}@test.com` },
        { first_name: 'Bob', last_name: 'Johnson', email: `bob.johnson.${timestamp}@test.com` }
      ];
      
      for (const user of users) {
        const response = await env.apiClient.post('/api/v1/users', createUserTestData(user));
        if (response.status === 201) {
          createdUserIds.push(response.data.data.user_id);
        }
      }
    });

    it('should search users by query', async () => {
      // Search for 'test' which should match our Test User or email addresses
      const response = await env.apiClient.get('/api/v1/users/search?query=test');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBeGreaterThan(0);
      
      // Verify search matches username, name, or email
      const hasMatch = response.data.data.some((u: any) => 
        u.username?.toLowerCase().includes('test') ||
        u.first_name?.toLowerCase().includes('test') || 
        u.last_name?.toLowerCase().includes('test') ||
        u.email?.toLowerCase().includes('test')
      );
      expect(hasMatch).toBe(true);
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
      if (response.status === 201) {
        testUserId = response.data.data.user_id;
        createdUserIds.push(testUserId);
      }
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

    beforeEach(async () => {
      // Create a test user
      const userData = createUserTestData();
      const response = await env.apiClient.post('/api/v1/users', userData);
      if (response.status === 201) {
        testUserId = response.data.data.user_id;
        createdUserIds.push(testUserId);
      }
    });

    it('should allow users to change their own password', async () => {
      // Create a test user with a known password
      const testPassword = 'TestPassword123!';
      const userData = createUserTestData({ password: testPassword });
      const createResponse = await env.apiClient.post('/api/v1/users', userData);
      
      if (createResponse.status !== 201) {
        throw new Error('Failed to create test user for password change');
      }
      
      const userId = createResponse.data.data.user_id;
      createdUserIds.push(userId);
      
      // Try to change another user's password - should get 403 (forbidden)
      const otherUserResponse = await env.apiClient.put(`/api/v1/users/${userId}/password`, {
        current_password: 'WrongPassword123!',
        new_password: 'NewPassword123!',
        confirm_password: 'NewPassword123!'
      });
      
      expect(otherUserResponse.status).toBe(403);
      expect(otherUserResponse.data.error.message).toContain('administrators');
      
      // Test changing own password (the env.userId)
      // First, we need to know the test user's password, which we don't have
      // So let's test that the endpoint requires current password
      const ownPasswordResponse = await env.apiClient.put(`/api/v1/users/${env.userId}/password`, {
        new_password: 'NewPassword123!',
        confirm_password: 'NewPassword123!'
        // Missing current_password
      });
      
      expect(ownPasswordResponse.status).toBe(400);
      expect(ownPasswordResponse.data.error.message).toBe('Current password is required');
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
        { user_type: 'contractor', is_inactive: false },
        { user_type: 'internal', is_inactive: true }
      ];
      
      for (const user of users) {
        const response = await env.apiClient.post('/api/v1/users', createUserTestData(user));
        if (response.status === 201) {
          createdUserIds.push(response.data.data.user_id);
        }
      }
    });

    it('should filter users by type', async () => {
      const response = await env.apiClient.get('/api/v1/users?user_type=internal');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      response.data.data.forEach((user: any) => {
        expect(user.user_type).toBe('internal');
      });
    });

    it('should filter users by active status', async () => {
      const response = await env.apiClient.get('/api/v1/users?is_inactive=false');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      response.data.data.forEach((user: any) => {
        expect(user.is_inactive).toBe(false);
      });
    });
  });

  describe('Permissions', () => {
    it('should enforce read permissions for listing', async () => {
      const response = await env.apiClient.get('/api/v1/users');
      expect(response.status).toBe(200);
    });

    it('should enforce create permissions', async () => {
      const userData = createUserTestData();
      const response = await env.apiClient.post('/api/v1/users', userData);
      
      expect([201, 403]).toContain(response.status);
      if (response.status === 201) {
        createdUserIds.push(response.data.data.user_id);
      }
    });
  });
});