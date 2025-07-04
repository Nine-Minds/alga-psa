/**
 * Teams API E2E Tests
 * 
 * Comprehensive tests for all team endpoints including:
 * - CRUD operations
 * - Member management
 * - Team roles
 * - Permissions
 * - Team hierarchy
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';
import { teamFactory } from '../factories/team.factory';
import { userFactory } from '../factories/user.factory';
import { apiKeyFactory } from '../factories/apiKey.factory';
import { getConnection } from '../../../lib/db/db';
import { runWithTenant } from '../../../lib/db';

const API_BASE_URL = 'http://localhost:3000/api/v1';

describe('Teams API E2E Tests', () => {
  let apiKey: string;
  let tenantId: string;
  let userId: string;
  let teamManagerId: string;
  let teamMemberId: string;

  beforeAll(async () => {
    // Set up test data
    const setup = await withTestSetup();
    tenantId = setup.tenantId;
    apiKey = setup.apiKey;
    userId = setup.userId;

    // Create additional users for team testing
    await runWithTenant(tenantId, async () => {
      const db = await getConnection();
      
      const manager = await userFactory(db, { 
        tenant: tenantId, 
        email: 'manager@example.com',
        firstName: 'Team',
        lastName: 'Manager'
      });
      teamManagerId = manager.user_id;
      
      const member = await userFactory(db, { 
        tenant: tenantId, 
        email: 'member@example.com',
        firstName: 'Team',
        lastName: 'Member'
      });
      teamMemberId = member.user_id;
    });
  });

  afterAll(async () => {
    // Clean up test data
    await runWithTenant(tenantId, async () => {
      const db = await getConnection();
      
      // Delete team members first
      await db('team_members').where('tenant', tenantId).delete();
      
      // Delete teams
      await db('teams').where('tenant', tenantId).delete();
    });
  });

  describe('Basic CRUD Operations', () => {
    it('should create a new team', async () => {
      const response = await fetch(`${API_BASE_URL}/teams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          team_name: 'Development Team',
          description: 'Main development team',
          manager_id: teamManagerId,
          is_active: true
        })
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        team_name: 'Development Team',
        description: 'Main development team',
        manager_id: teamManagerId,
        is_active: true
      });
    });

    it('should list teams with pagination', async () => {
      // Create multiple teams
      await runWithTenant(tenantId, async () => {
        const db = await getConnection();
        for (let i = 0; i < 5; i++) {
          await teamFactory(db, { 
            tenant: tenantId, 
            team_name: `Team ${i + 1}`,
            manager_id: userId
          });
        }
      });

      const response = await fetch(`${API_BASE_URL}/teams?page=1&limit=3`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 3,
        total: expect.any(Number)
      });
    });

    it('should get a specific team', async () => {
      const db = await getConnection();
      const team = await runWithTenant(tenantId, async () => {
        return await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'QA Team',
          manager_id: teamManagerId
        });
      });

      const response = await fetch(`${API_BASE_URL}/teams/${team.team_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.team_id).toBe(team.team_id);
      expect(result.data.team_name).toBe('QA Team');
    });

    it('should update a team', async () => {
      const db = await getConnection();
      const team = await runWithTenant(tenantId, async () => {
        return await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Old Team Name',
          manager_id: userId
        });
      });

      const response = await fetch(`${API_BASE_URL}/teams/${team.team_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          team_name: 'Updated Team Name',
          description: 'Updated description',
          manager_id: teamManagerId
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.team_name).toBe('Updated Team Name');
      expect(result.data.description).toBe('Updated description');
      expect(result.data.manager_id).toBe(teamManagerId);
    });

    it('should delete a team', async () => {
      const db = await getConnection();
      const team = await runWithTenant(tenantId, async () => {
        return await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Team to Delete',
          manager_id: userId
        });
      });

      const response = await fetch(`${API_BASE_URL}/teams/${team.team_id}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      // Verify deletion
      const getResponse = await fetch(`${API_BASE_URL}/teams/${team.team_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });
      expect(getResponse.status).toBe(404);
    });
  });

  describe('Team Members Management', () => {
    let teamId: string;

    beforeAll(async () => {
      // Create a team for member management tests
      const db = await getConnection();
      const team = await runWithTenant(tenantId, async () => {
        return await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Member Test Team',
          manager_id: teamManagerId
        });
      });
      teamId = team.team_id;
    });

    it('should add members to a team', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/${teamId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          user_ids: [teamMemberId, userId],
          role: 'member'
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.added_count).toBe(2);
    });

    it('should list team members', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/${teamId}/members`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data.some((m: any) => m.user_id === teamMemberId)).toBe(true);
      expect(result.data.some((m: any) => m.user_id === userId)).toBe(true);
    });

    it('should update member role', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/${teamId}/members/${teamMemberId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          role: 'team_lead'
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.role).toBe('team_lead');
    });

    it('should remove a member from team', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/${teamId}/members/${userId}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      // Verify member was removed
      const listResponse = await fetch(`${API_BASE_URL}/teams/${teamId}/members`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });
      const listResult = await listResponse.json();
      expect(listResult.data.some((m: any) => m.user_id === userId)).toBe(false);
    });
  });

  describe('Team Hierarchy', () => {
    let parentTeamId: string;
    let childTeamId: string;

    beforeAll(async () => {
      const db = await getConnection();
      await runWithTenant(tenantId, async () => {
        const parentTeam = await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Parent Team',
          manager_id: teamManagerId
        });
        parentTeamId = parentTeam.team_id;

        const childTeam = await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Child Team',
          manager_id: userId,
          parent_team_id: parentTeamId
        });
        childTeamId = childTeam.team_id;
      });
    });

    it('should get team hierarchy', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/${parentTeamId}/hierarchy`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('team_id', parentTeamId);
      expect(result.data).toHaveProperty('children');
      expect(result.data.children).toHaveLength(1);
      expect(result.data.children[0].team_id).toBe(childTeamId);
    });

    it('should get team path to root', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/${childTeamId}/path`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].team_id).toBe(parentTeamId);
      expect(result.data[1].team_id).toBe(childTeamId);
    });
  });

  describe('Team Permissions', () => {
    let teamId: string;

    beforeAll(async () => {
      const db = await getConnection();
      const team = await runWithTenant(tenantId, async () => {
        return await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Permission Test Team',
          manager_id: teamManagerId
        });
      });
      teamId = team.team_id;
    });

    it('should assign permissions to team', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/${teamId}/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          permissions: [
            'project:read',
            'project:create',
            'ticket:read',
            'ticket:create'
          ]
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.assigned_count).toBe(4);
    });

    it('should get team permissions', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/${teamId}/permissions`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(4);
      expect(result.data).toContain('project:read');
      expect(result.data).toContain('project:create');
    });

    it('should remove team permissions', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/${teamId}/permissions`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          permissions: ['project:create', 'ticket:create']
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.removed_count).toBe(2);
    });
  });

  describe('Advanced Features', () => {
    it('should get team statistics', async () => {
      const db = await getConnection();
      const team = await runWithTenant(tenantId, async () => {
        return await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Stats Test Team',
          manager_id: teamManagerId
        });
      });

      const response = await fetch(`${API_BASE_URL}/teams/${team.team_id}/stats`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('member_count');
      expect(result.data).toHaveProperty('active_projects');
      expect(result.data).toHaveProperty('open_tickets');
    });

    it('should bulk create teams', async () => {
      const teams = [
        {
          team_name: 'Bulk Team 1',
          description: 'First bulk team',
          manager_id: teamManagerId
        },
        {
          team_name: 'Bulk Team 2',
          description: 'Second bulk team',
          manager_id: userId
        }
      ];

      const response = await fetch(`${API_BASE_URL}/teams/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({ teams })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.created_count).toBe(2);
      expect(result.data.teams).toHaveLength(2);
    });

    it('should clone a team', async () => {
      const db = await getConnection();
      const originalTeam = await runWithTenant(tenantId, async () => {
        const team = await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Original Team',
          manager_id: teamManagerId
        });

        // Add members to original team
        await db('team_members').insert({
          tenant: tenantId,
          team_id: team.team_id,
          user_id: teamMemberId,
          role: 'member'
        });

        return team;
      });

      const response = await fetch(`${API_BASE_URL}/teams/${originalTeam.team_id}/clone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          new_team_name: 'Cloned Team',
          include_members: true,
          include_permissions: true
        })
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.team_name).toBe('Cloned Team');
      expect(result.data.manager_id).toBe(teamManagerId);
    });
  });

  describe('Error Handling', () => {
    it('should return 401 without API key', async () => {
      const response = await fetch(`${API_BASE_URL}/teams`, {
        method: 'GET',
        headers: {
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(401);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toBe('API key required');
    });

    it('should return 403 without permission', async () => {
      // Create a limited API key without team permissions
      const db = await getConnection();
      const limitedKey = await runWithTenant(tenantId, async () => {
        const user = await userFactory(db, { 
          tenant: tenantId, 
          email: 'limited@example.com' 
        });
        return await apiKeyFactory(db, { 
          tenant: tenantId, 
          user_id: user.user_id 
        });
      });

      const response = await fetch(`${API_BASE_URL}/teams`, {
        method: 'GET',
        headers: {
          'x-api-key': limitedKey.key,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(403);
    });

    it('should return 400 for invalid data', async () => {
      const response = await fetch(`${API_BASE_URL}/teams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          // Missing required team_name
          description: 'Invalid team'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('validation');
    });

    it('should return 404 for non-existent team', async () => {
      const response = await fetch(`${API_BASE_URL}/teams/non-existent-id`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(404);
      const result = await response.json();
      expect(result.success).toBe(false);
    });

    it('should prevent circular team hierarchy', async () => {
      const db = await getConnection();
      const teams = await runWithTenant(tenantId, async () => {
        const team1 = await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Team 1',
          manager_id: teamManagerId
        });

        const team2 = await teamFactory(db, { 
          tenant: tenantId, 
          team_name: 'Team 2',
          manager_id: userId,
          parent_team_id: team1.team_id
        });

        return { team1, team2 };
      });

      // Try to make team1 a child of team2 (circular reference)
      const response = await fetch(`${API_BASE_URL}/teams/${teams.team1.team_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          parent_team_id: teams.team2.team_id
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('circular');
    });
  });

  describe('Tenant Isolation', () => {
    it('should not access teams from other tenants', async () => {
      // Create another tenant and team
      const otherSetup = await withTestSetup();
      const otherTenantId = otherSetup.tenantId;
      
      const db = await getConnection();
      const otherTeam = await runWithTenant(otherTenantId, async () => {
        return await teamFactory(db, { 
          tenant: otherTenantId,
          team_name: 'Other Tenant Team',
          manager_id: otherSetup.userId
        });
      });

      // Try to access from original tenant
      const response = await fetch(`${API_BASE_URL}/teams/${otherTeam.team_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(404);
    });
  });
});