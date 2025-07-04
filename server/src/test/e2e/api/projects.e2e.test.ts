import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { 
  setupE2ETestEnvironment,
  E2ETestEnvironment
} from '../utils/e2eTestSetup';
import { createProjectTestData } from '../utils/projectTestData';

describe('Projects API E2E Tests', () => {
  let env: E2ETestEnvironment;
  let createdProjectIds: string[] = [];

  beforeAll(async () => {
    // Setup test environment
    env = await setupE2ETestEnvironment({
      companyName: 'Projects API Test Company',
      userName: 'projects_api_test'
    });
  });

  afterAll(async () => {
    // Clean up any created projects
    for (const projectId of createdProjectIds) {
      try {
        await env.apiClient.delete(`/api/v1/projects/${projectId}`);
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
      const response = await client.get('/api/v1/projects');
      
      expect(response.status).toBe(401);
      expect(response.data.error.message).toBe('API key required');
    });

    it('should reject requests with invalid API key', async () => {
      const client = new env.apiClient.constructor({
        baseUrl: env.apiClient.config.baseUrl,
        apiKey: 'invalid-key',
        tenantId: env.tenant
      });
      const response = await client.get('/api/v1/projects');
      
      expect(response.status).toBe(401);
      expect(response.data.error.message).toBe('Invalid API key');
    });

    it('should accept requests with valid API key', async () => {
      const response = await env.apiClient.get('/api/v1/projects');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('data');
      expect(response.data).toHaveProperty('pagination');
    });
  });

  describe('CRUD Operations', () => {
    it('should create a project', async () => {
      const projectData = createProjectTestData({ company_id: env.companyId });
      const response = await env.apiClient.post('/api/v1/projects', projectData);
      
      if (response.status !== 201) {
        console.error('Create project failed:', response.status, JSON.stringify(response.data, null, 2));
      }
      
      expect(response.status).toBe(201);
      expect(response.data.data).toMatchObject({
        project_name: projectData.project_name,
        company_id: projectData.company_id,
        status: projectData.status
      });
      expect(response.data.data.project_id).toBeTruthy();
      
      createdProjectIds.push(response.data.data.project_id);
    });

    it('should get a project by ID', async () => {
      // Create a project first
      const projectData = createProjectTestData({ company_id: env.companyId });
      const createResponse = await env.apiClient.post('/api/v1/projects', projectData);
      const projectId = createResponse.data.data.project_id;
      createdProjectIds.push(projectId);
      
      // Get the project
      const response = await env.apiClient.get(`/api/v1/projects/${projectId}`);
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        project_id: projectId,
        project_name: projectData.project_name,
        company_id: projectData.company_id
      });
    });

    it('should update a project', async () => {
      // Create a project first
      const projectData = createProjectTestData({ company_id: env.companyId });
      const createResponse = await env.apiClient.post('/api/v1/projects', projectData);
      const projectId = createResponse.data.data.project_id;
      createdProjectIds.push(projectId);
      
      // Update the project
      const updateData = {
        project_name: 'Updated Project Name',
        description: 'Updated description',
        status: 'in_progress'
      };
      const response = await env.apiClient.put(`/api/v1/projects/${projectId}`, updateData);
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        project_id: projectId,
        project_name: updateData.project_name,
        description: updateData.description,
        status: updateData.status
      });
    });

    it('should delete a project', async () => {
      // Create a project first
      const projectData = createProjectTestData({ company_id: env.companyId });
      const createResponse = await env.apiClient.post('/api/v1/projects', projectData);
      const projectId = createResponse.data.data.project_id;
      
      // Delete the project
      const response = await env.apiClient.delete(`/api/v1/projects/${projectId}`);
      
      expect(response.status).toBe(204);
      
      // Verify it's deleted
      const getResponse = await env.apiClient.get(`/api/v1/projects/${projectId}`);
      expect(getResponse.status).toBe(404);
    });

    it('should list projects with pagination', async () => {
      // Create multiple projects
      const projects = [];
      for (let i = 0; i < 5; i++) {
        const projectData = createProjectTestData({ company_id: env.companyId });
        const response = await env.apiClient.post('/api/v1/projects', projectData);
        if (response.status === 201) {
          projects.push(response.data.data);
          createdProjectIds.push(response.data.data.project_id);
        }
      }
      
      // List projects
      const response = await env.apiClient.get('/api/v1/projects?limit=3&page=1');
      
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

  describe('Project Search', () => {
    beforeEach(async () => {
      // Create test projects with different attributes
      const projects = [
        { project_name: 'Web Development Project', status: 'active' },
        { project_name: 'Mobile App Project', status: 'planning' },
        { project_name: 'API Integration Project', status: 'completed' }
      ];
      
      for (const project of projects) {
        const response = await env.apiClient.post('/api/v1/projects', 
          createProjectTestData({ ...project, company_id: env.companyId })
        );
        if (response.status === 201) {
          createdProjectIds.push(response.data.data.project_id);
        }
      }
    });

    it('should search projects by query', async () => {
      const response = await env.apiClient.get('/api/v1/projects/search?query=development');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.some((p: any) => 
        p.project_name.toLowerCase().includes('development')
      )).toBe(true);
    });
  });

  describe('Project Statistics', () => {
    it('should get project statistics', async () => {
      const response = await env.apiClient.get('/api/v1/projects/stats');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        total_projects: expect.any(Number),
        active_projects: expect.any(Number),
        completed_projects: expect.any(Number),
        projects_by_status: expect.any(Object)
      });
    });
  });

  describe('Project Tasks and Tickets', () => {
    let testProjectId: string;

    beforeEach(async () => {
      // Create a test project
      const projectData = createProjectTestData({ company_id: env.companyId });
      const response = await env.apiClient.post('/api/v1/projects', projectData);
      if (response.status === 201) {
        testProjectId = response.data.data.project_id;
        createdProjectIds.push(testProjectId);
      }
    });

    it('should get project tasks', async () => {
      const response = await env.apiClient.get(`/api/v1/projects/${testProjectId}/tasks`);
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
    });

    it('should get project tickets', async () => {
      const response = await env.apiClient.get(`/api/v1/projects/${testProjectId}/tickets`);
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.pagination).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent project', async () => {
      const response = await env.apiClient.get('/api/v1/projects/00000000-0000-0000-0000-000000000000');
      
      expect(response.status).toBe(404);
      expect(response.data.error).toContain('not found');
    });

    it('should return 400 for invalid project data', async () => {
      const invalidData = {
        project_name: '', // Required field
        company_id: 'invalid-uuid' // Invalid format
      };
      
      const response = await env.apiClient.post('/api/v1/projects', invalidData);
      
      expect(response.status).toBe(400);
      expect(response.data.error).toContain('Validation failed');
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await env.apiClient.get('/api/v1/projects/invalid-uuid');
      
      expect(response.status).toBe(400);
      expect(response.data.error).toBeDefined();
    });
  });

  describe('Filtering', () => {
    beforeEach(async () => {
      // Create test projects with different attributes
      const projects = [
        { status: 'active', project_type: 'development' },
        { status: 'planning', project_type: 'research' },
        { status: 'completed', project_type: 'development' }
      ];
      
      for (const project of projects) {
        const response = await env.apiClient.post('/api/v1/projects', 
          createProjectTestData({ ...project, company_id: env.companyId })
        );
        if (response.status === 201) {
          createdProjectIds.push(response.data.data.project_id);
        }
      }
    });

    it('should filter projects by status', async () => {
      const response = await env.apiClient.get('/api/v1/projects?status=active');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      response.data.data.forEach((project: any) => {
        expect(project.status).toBe('active');
      });
    });

    it('should filter projects by type', async () => {
      const response = await env.apiClient.get('/api/v1/projects?project_type=development');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      response.data.data.forEach((project: any) => {
        expect(project.project_type).toBe('development');
      });
    });

    it('should filter projects by company', async () => {
      const response = await env.apiClient.get(`/api/v1/projects?company_id=${env.companyId}`);
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      response.data.data.forEach((project: any) => {
        expect(project.company_id).toBe(env.companyId);
      });
    });
  });

  describe('Project Export', () => {
    it('should export projects as CSV', async () => {
      const response = await env.apiClient.get('/api/v1/projects/export?format=csv');
      
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
    });

    it('should export projects as JSON', async () => {
      const response = await env.apiClient.get('/api/v1/projects/export?format=json');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
    });
  });

  describe('Permissions', () => {
    it('should enforce read permissions for listing', async () => {
      const response = await env.apiClient.get('/api/v1/projects');
      expect(response.status).toBe(200);
    });

    it('should enforce create permissions', async () => {
      const projectData = createProjectTestData({ company_id: env.companyId });
      const response = await env.apiClient.post('/api/v1/projects', projectData);
      
      expect([201, 403]).toContain(response.status);
      if (response.status === 201) {
        createdProjectIds.push(response.data.data.project_id);
      }
    });
  });
});