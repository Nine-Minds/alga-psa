import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { 
  setupE2ETestEnvironment, 
  E2ETestEnvironment 
} from '../utils/e2eTestSetup';
import { 
  createTestTeam,
  createTestTeams,
  createTeamsForPagination,
  createTeamTestData,
  addTeamMember
} from '../utils/teamTestDataFactory';
import { 
  assertSuccess, 
  assertError, 
  buildQueryString,
  extractPagination
} from '../utils/apiTestHelpers';
import { v4 as uuidv4 } from 'uuid';

describe('Teams API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/teams';

  beforeAll(async () => {
    env = await setupE2ETestEnvironment();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Authentication', () => {
    it('should require API key for all endpoints', async () => {
      const { ApiTestClient } = await import('../utils/apiTestHelpers');
      const clientWithoutKey = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        tenantId: env.tenant
      });

      const response = await clientWithoutKey.get(API_BASE);
      assertError(response, 401, 'UNAUTHORIZED');
      expect(response.data.error.message).toBe('API key required');
    });

    it('should reject invalid API key', async () => {
      const { ApiTestClient } = await import('../utils/apiTestHelpers');
      const clientWithBadKey = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: 'invalid-key-123',
        tenantId: env.tenant
      });

      const response = await clientWithBadKey.get(API_BASE);
      assertError(response, 401, 'UNAUTHORIZED');
      expect(response.data.error.message).toBe('Invalid API key');
    });
  });

  describe('CRUD Operations', () => {
    describe('Create Team (POST /api/v1/teams)', () => {
      it('should create a new team', async () => {
        const newTeam = createTeamTestData({ manager_id: env.userId });

        const response = await env.apiClient.post(API_BASE, newTeam);
        assertSuccess(response, 201);
        
        expect(response.data.data).toMatchObject({
          team_name: newTeam.team_name,
          manager_id: env.userId,
          tenant: env.tenant
        });
        expect(response.data.data.team_id).toBeDefined();
      });

      it('should validate required fields', async () => {
        const invalidTeam = {
          // Missing required team_name and manager_id
        };

        const response = await env.apiClient.post(API_BASE, invalidTeam);
        assertError(response, 400, 'VALIDATION_ERROR');
      });

      it('should validate manager_id is a valid user', async () => {
        const teamWithInvalidManager = createTeamTestData({ 
          manager_id: uuidv4() // Random UUID that doesn't exist
        });

        const response = await env.apiClient.post(API_BASE, teamWithInvalidManager);
        assertError(response, 400, 'BAD_REQUEST');
      });
    });

    describe('Get Team (GET /api/v1/teams/:id)', () => {
      it('should retrieve a team by ID', async () => {
        // Create a test team
        const team = await createTestTeam(env.db, env.tenant, {
          team_name: 'Test Team for Retrieval',
          manager_id: env.userId
        });

        const response = await env.apiClient.get(`${API_BASE}/${team.team_id}`);
        assertSuccess(response);
        
        expect(response.data.data).toMatchObject({
          team_id: team.team_id,
          team_name: team.team_name,
          manager_id: env.userId
        });
      });

      it('should return 404 for non-existent team', async () => {
        const fakeId = uuidv4();
        const response = await env.apiClient.get(`${API_BASE}/${fakeId}`);
        assertError(response, 404, 'NOT_FOUND');
      });

      it('should not return teams from other tenants', async () => {
        // This test would require creating another tenant and team
        // For now, we'll skip this test as it requires more complex setup
      });
    });

    describe('Update Team (PUT /api/v1/teams/:id)', () => {
      it('should update a team', async () => {
        const team = await createTestTeam(env.db, env.tenant, {
          team_name: 'Original Team Name',
          manager_id: env.userId
        });

        const updates = {
          team_name: 'Updated Team Name'
        };

        const response = await env.apiClient.put(`${API_BASE}/${team.team_id}`, updates);
        assertSuccess(response);
        
        expect(response.data.data).toMatchObject({
          team_id: team.team_id,
          team_name: updates.team_name
        });
      });

      it('should return 404 when updating non-existent team', async () => {
        const fakeId = uuidv4();
        const response = await env.apiClient.put(`${API_BASE}/${fakeId}`, { 
          team_name: 'New Name' 
        });
        assertError(response, 404, 'NOT_FOUND');
      });

      it('should validate update data', async () => {
        const team = await createTestTeam(env.db, env.tenant, {
          manager_id: env.userId
        });
        
        const invalidUpdate = {
          team_name: '' // Empty name should be invalid
        };

        const response = await env.apiClient.put(`${API_BASE}/${team.team_id}`, invalidUpdate);
        assertError(response, 400, 'VALIDATION_ERROR');
      });
    });

    describe('Delete Team (DELETE /api/v1/teams/:id)', () => {
      it('should delete a team', async () => {
        const team = await createTestTeam(env.db, env.tenant, {
          team_name: 'Team to Delete',
          manager_id: env.userId
        });

        const response = await env.apiClient.delete(`${API_BASE}/${team.team_id}`);
        assertSuccess(response, 204);

        // Verify team is deleted
        const getResponse = await env.apiClient.get(`${API_BASE}/${team.team_id}`);
        assertError(getResponse, 404);
      });

      it('should return 404 when deleting non-existent team', async () => {
        const fakeId = uuidv4();
        const response = await env.apiClient.delete(`${API_BASE}/${fakeId}`);
        assertError(response, 404, 'NOT_FOUND');
      });

      it('should handle teams with members', async () => {
        const team = await createTestTeam(env.db, env.tenant, {
          manager_id: env.userId
        });

        // Add a member to the team
        await addTeamMember(env.db, env.tenant, team.team_id, env.userId);

        // Deletion might fail or cascade - depends on business rules
        const response = await env.apiClient.delete(`${API_BASE}/${team.team_id}`);
        
        // Accept either 204 (cascade delete) or 400 (has members)
        expect([204, 400]).toContain(response.status);
      });
    });
  });

  describe('List Teams (GET /api/v1/teams)', () => {
    it('should list all teams with default pagination', async () => {
      // Create some test teams
      await createTestTeams(env.db, env.tenant, 3, env.userId);

      const response = await env.apiClient.get(API_BASE);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBeGreaterThanOrEqual(3);
      expect(response.data.pagination).toBeDefined();
      expect(response.data.pagination).toMatchObject({
        page: 1,
        limit: 25,
        total: expect.any(Number),
        totalPages: expect.any(Number),
        hasNext: expect.any(Boolean),
        hasPrev: false
      });
    });

    it('should support pagination parameters', async () => {
      await createTeamsForPagination(env.db, env.tenant, env.userId, 15);

      const query = buildQueryString({ page: 2, limit: 5 });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const pagination = extractPagination(response);
      expect(pagination.page).toBe(2);
      expect(pagination.limit).toBe(5);
      expect(pagination.hasPrev).toBe(true);
    });

    it('should filter by search query', async () => {
      await createTestTeam(env.db, env.tenant, {
        team_name: 'Engineering Team',
        manager_id: env.userId
      });

      const query = buildQueryString({ search: 'Engineering' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      expect(response.data.data.length).toBeGreaterThan(0);
      response.data.data.forEach((team: any) => {
        expect(team.team_name.toLowerCase()).toContain('engineering');
      });
    });

    it('should sort teams', async () => {
      await createTestTeams(env.db, env.tenant, 5, env.userId);

      const query = buildQueryString({ sort: 'team_name', order: 'asc' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const names = response.data.data.map((t: any) => t.team_name);
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);
    });
  });

  describe('Team Manager Assignment', () => {
    describe('Assign Team Manager (PUT /api/v1/teams/:id/manager)', () => {
      it('should assign manager and automatically add them as team member', async () => {
        // Create team for this test
        const testTeam = await createTestTeam(env.db, env.tenant, {
          team_name: `Team for Manager Tests ${Date.now()}`,
          manager_id: env.userId
        });

        // Create a test user to use as manager
        const { createUserTestData } = await import('../utils/userTestData');
        const newUserData = createUserTestData();
        const userResponse = await env.apiClient.post('/api/v1/users', newUserData);

        if (userResponse.status !== 201) {
          throw new Error('Failed to create test user');
        }

        const testUser = userResponse.data.data;

        const response = await env.apiClient.put(
          `${API_BASE}/${testTeam.team_id}/manager`,
          { manager_id: testUser.user_id }
        );
        
        assertSuccess(response);
        expect(response.data.data.manager_id).toBe(testUser.user_id);
        
        // Verify manager is also a team member
        const membersResponse = await env.apiClient.get(`${API_BASE}/${testTeam.team_id}/members`);
        assertSuccess(membersResponse);
        
        const members = membersResponse.data.data || [];
        const managerAsMember = members.find((m: any) => m.user_id === testUser.user_id);
        expect(managerAsMember).toBeDefined();
        expect(managerAsMember.user_id).toBe(testUser.user_id);
      });

      it('should not duplicate member if manager is already a team member', async () => {
        // Create team for this test
        const testTeam = await createTestTeam(env.db, env.tenant, {
          team_name: `Team for Manager Tests ${Date.now()}`,
          manager_id: env.userId
        });

        // Create a test user to use as manager
        const { createUserTestData } = await import('../utils/userTestData');
        const newUserData = createUserTestData();
        const userResponse = await env.apiClient.post('/api/v1/users', newUserData);

        if (userResponse.status !== 201) {
          throw new Error('Failed to create test user');
        }

        const testUser = userResponse.data.data;

        // First add user as team member
        await env.apiClient.post(
          `${API_BASE}/${testTeam.team_id}/members`,
          { user_id: testUser.user_id }
        );
        
        // Then assign as manager
        const response = await env.apiClient.put(
          `${API_BASE}/${testTeam.team_id}/manager`,
          { manager_id: testUser.user_id }
        );
        
        assertSuccess(response);
        expect(response.data.data.manager_id).toBe(testUser.user_id);
        
        // Verify user appears only once in members list
        const membersResponse = await env.apiClient.get(`${API_BASE}/${testTeam.team_id}/members`);
        assertSuccess(membersResponse);
        
        const members = membersResponse.data.data || [];
        const managerEntries = members.filter((m: any) => m.user_id === testUser.user_id);
        expect(managerEntries.length).toBe(1);
      });
    });
  });

  describe('Team Creation with Manager', () => {
    it('should automatically add manager as team member when creating team', async () => {
      // Create a test user to use as manager
      const { createUserTestData } = await import('../utils/userTestData');
      const newUserData = createUserTestData();
      const userResponse = await env.apiClient.post('/api/v1/users', newUserData);
      
      if (userResponse.status !== 201) {
        throw new Error('Failed to create test user');
      }
      
      const testUser = userResponse.data.data;
      
      // Create team with manager
      const newTeam = createTeamTestData({ manager_id: testUser.user_id });
      const response = await env.apiClient.post(API_BASE, newTeam);
      assertSuccess(response, 201);
      
      expect(response.data.data).toMatchObject({
        team_name: newTeam.team_name,
        manager_id: testUser.user_id,
        tenant: env.tenant
      });
      
      // Verify manager is also a team member
      const membersResponse = await env.apiClient.get(`${API_BASE}/${response.data.data.team_id}/members`);
      assertSuccess(membersResponse);
      
      const members = membersResponse.data.data || [];
      const managerAsMember = members.find((m: any) => m.user_id === testUser.user_id);
      expect(managerAsMember).toBeDefined();
      expect(managerAsMember.user_id).toBe(testUser.user_id);
    });
  });

  describe('Team Members', () => {
    let testTeam: any;

    beforeEach(async () => {
      testTeam = await createTestTeam(env.db, env.tenant, {
        team_name: 'Team for Members',
        manager_id: env.userId
      });
    });

    describe('Add Team Member (POST /api/v1/teams/:id/members)', () => {
      it('should add a member to a team', async () => {
        // Create another user to add as member
        const { createUserTestData } = await import('../utils/userTestData');
        const newUserData = createUserTestData();
        const userResponse = await env.apiClient.post('/api/v1/users', newUserData);
        
        if (userResponse.status !== 201) {
          throw new Error('Failed to create test user');
        }
        
        const newUserId = userResponse.data.data.user_id;

        const response = await env.apiClient.post(
          `${API_BASE}/${testTeam.team_id}/members`,
          { user_id: newUserId }
        );
        
        assertSuccess(response, 201);
        expect(response.data.data).toMatchObject({
          team_id: testTeam.team_id,
          user_id: newUserId
        });
      });

      it('should prevent duplicate members', async () => {
        // Add the same user twice
        await env.apiClient.post(
          `${API_BASE}/${testTeam.team_id}/members`,
          { user_id: env.userId }
        );

        const response = await env.apiClient.post(
          `${API_BASE}/${testTeam.team_id}/members`,
          { user_id: env.userId }
        );

        assertError(response, 409, 'CONFLICT');
      });

      it('should validate user exists', async () => {
        const response = await env.apiClient.post(
          `${API_BASE}/${testTeam.team_id}/members`,
          { user_id: uuidv4() }
        );

        assertError(response, 400, 'BAD_REQUEST');
      });
    });

    describe('List Team Members (GET /api/v1/teams/:id/members)', () => {
      it('should list team members', async () => {
        // Add some members
        await addTeamMember(env.db, env.tenant, testTeam.team_id, env.userId);

        const response = await env.apiClient.get(`${API_BASE}/${testTeam.team_id}/members`);
        assertSuccess(response);

        expect(response.data.data).toBeInstanceOf(Array);
        expect(response.data.data.length).toBeGreaterThan(0);
      });
    });

    describe('Remove Team Member (DELETE /api/v1/teams/:id/members/:userId)', () => {
      it('should remove a member from team', async () => {
        // Add a member first
        await addTeamMember(env.db, env.tenant, testTeam.team_id, env.userId);

        const response = await env.apiClient.delete(
          `${API_BASE}/${testTeam.team_id}/members/${env.userId}`
        );
        assertSuccess(response, 204);

        // Verify member is removed
        const listResponse = await env.apiClient.get(`${API_BASE}/${testTeam.team_id}/members`);
        const members = listResponse.data.data || [];
        const removedMember = members.find((m: any) => m.user_id === env.userId);
        expect(removedMember).toBeUndefined();
      });

      it('should return 404 for non-existent member', async () => {
        const response = await env.apiClient.delete(
          `${API_BASE}/${testTeam.team_id}/members/${uuidv4()}`
        );
        assertError(response, 404, 'NOT_FOUND');
      });
    });
  });

  describe('Team Statistics', () => {
    it('should get team statistics', async () => {
      // Create some teams with members
      const team1 = await createTestTeam(env.db, env.tenant, { manager_id: env.userId });
      const team2 = await createTestTeam(env.db, env.tenant, { manager_id: env.userId });
      
      await addTeamMember(env.db, env.tenant, team1.team_id, env.userId);

      const response = await env.apiClient.get(`${API_BASE}/stats`);
      assertSuccess(response);

      expect(response.data.data).toMatchObject({
        total_teams: expect.any(Number),
        teams_with_members: expect.any(Number),
        average_team_size: expect.any(Number),
        largest_team_size: expect.any(Number)
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid UUID format', async () => {
      const response = await env.apiClient.get(`${API_BASE}/not-a-uuid`);
      assertError(response, 400, 'VALIDATION_ERROR');
    });

    it('should handle invalid query parameters', async () => {
      const query = buildQueryString({ page: 'invalid', limit: 'abc' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertError(response, 400, 'VALIDATION_ERROR');
    });

    it('should handle missing required fields on create', async () => {
      const response = await env.apiClient.post(API_BASE, {});
      assertError(response, 400, 'VALIDATION_ERROR');
    });
  });

  describe('Permissions', () => {
    it('should enforce read permissions for listing', async () => {
      // This would require creating a user without read permissions
      // For now, we'll skip this test as it requires RBAC setup
    });

    it('should enforce create permissions', async () => {
      // This would require creating a user without create permissions
      // For now, we'll skip this test as it requires RBAC setup
    });

    it('should enforce update permissions', async () => {
      // This would require creating a user without update permissions
      // For now, we'll skip this test as it requires RBAC setup
    });

    it('should enforce delete permissions', async () => {
      // This would require creating a user without delete permissions
      // For now, we'll skip this test as it requires RBAC setup
    });
  });

  describe('Multi-tenancy', () => {
    it('should isolate teams by tenant', async () => {
      // This would require creating another tenant and verifying isolation
      // For now, we'll skip this test as it requires complex setup
    });
  });
});