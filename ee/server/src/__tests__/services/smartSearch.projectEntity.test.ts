import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  authorizeProjectIds: vi.fn(),
  loadProjectListItemsByIds: vi.fn(),
}));
vi.mock('@alga-psa/search/acl', () => ({ aclPredicateSql: vi.fn(), resolveSearchAclPrincipal: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));

import { buildRelevanceRequest } from '../../services/smartSearch/scoreBatch';
import {
  assembleProjectCandidate,
  projectSmartSearch,
  projectSmartSearchScopeSchema,
} from '../../services/smartSearch/entities/project';
import { authorizeProjectIds, loadProjectListItemsByIds } from '@alga-psa/projects/actions/projectActions';

const row = {
  project_id: 'pid',
  project_number: 'PRJ-0007',
  project_name: 'Office move',
  description: '# Plan\n\nMove **everything** by June.',
  client_name: 'Acme',
  contact_name: 'Jo Client',
  status_name: 'In Progress',
  is_closed: false,
  is_inactive: false,
  manager_name: 'Pat Manager',
  start_date: new Date('2026-05-01T00:00:00Z'),
  end_date: '2026-06-30T00:00:00.000Z',
  created_at: '2026-04-01T09:00:00.000Z',
  updated_at: '2026-05-20T09:00:00.000Z',
  budgeted_hours: '120',
};

const task = (name: string, description: string | null = null) => ({
  project_id: 'pid',
  phase_name: 'Phase 1',
  task_name: name,
  description,
  status_name: 'To Do',
  is_closed: false,
  priority_name: null,
  assigned_to_name: 'Sam Tech',
  due_date: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-05-20T09:00:00.000Z',
});

describe('assembleProjectCandidate', () => {
  it('renders the project as named facts, description, tasks, then comments', () => {
    const candidate = assembleProjectCandidate(
      row,
      [task('Order crates', 'Get quotes from **three** vendors.'), task('Book movers')],
      [
        { project_id: 'pid', task_name: 'Order crates', body: 'Vendor A quoted 900.', source_updated_at: '2026-05-21T09:00:00.000Z' },
        { project_id: 'pid', task_name: 'Book movers', body: '   ', source_updated_at: '2026-05-19T09:00:00.000Z' },
      ]
    );
    expect(candidate.id).toBe('pid');
    expect(Object.keys(candidate.state)).toEqual([
      'project_number', 'project_name', 'client', 'contact', 'status', 'is_closed', 'is_inactive', 'project_manager',
      'start_date', 'end_date', 'created_at', 'updated_at', 'budgeted_hours', 'description', 'tasks', 'comments',
    ]);
    expect(candidate.state).toMatchObject({
      project_number: 'PRJ-0007',
      project_name: 'Office move',
      client: 'Acme',
      contact: 'Jo Client',
      status: 'In Progress',
      is_closed: false,
      is_inactive: false,
      project_manager: 'Pat Manager',
      start_date: '2026-05-01T00:00:00.000Z',
      end_date: '2026-06-30T00:00:00.000Z',
      budgeted_hours: 120,
    });
    expect(candidate.state.description).not.toMatch(/[#*]/);
    expect(candidate.state.tasks).toEqual([
      { phase: 'Phase 1', task: 'Order crates', status: 'To Do', is_closed: false, priority: null, assigned_to: 'Sam Tech', due_date: '2026-06-01T00:00:00.000Z', text: 'Get quotes from three vendors.' },
      { phase: 'Phase 1', task: 'Book movers', status: 'To Do', is_closed: false, priority: null, assigned_to: 'Sam Tech', due_date: '2026-06-01T00:00:00.000Z', text: '' },
    ]);
    expect(candidate.state.comments).toEqual([{ task: 'Order crates', text: 'Vendor A quoted 900.' }]);
    expect(JSON.stringify(candidate.state)).not.toContain('pid');
  });

  it('gives tasks budget before comments', () => {
    const long = Array.from({ length: 30 }, () => 'lorem').join(' ');
    const candidate = assembleProjectCandidate(
      row,
      [task('A', long), task('B', long)],
      [{ project_id: 'pid', task_name: 'A', body: long, source_updated_at: '2026-05-21T09:00:00.000Z' }],
      // Head ~90 tokens, each task ~80: two tasks leave ~20, not enough for the ~50-token comment.
      { tokensPerCandidate: 270, descriptionMaxTokens: 10 }
    );
    expect(candidate.state.tasks).toHaveLength(2);
    expect(candidate.state.comments).toHaveLength(0);
  });

  it('tolerates blanks: no name, no dates, no budget', () => {
    const candidate = assembleProjectCandidate(
      { ...row, project_name: '', status_name: null, start_date: null, budgeted_hours: null, description: null },
      [],
      []
    );
    expect(candidate.state.project_name).toBe('PRJ-0007');
    expect(candidate.state.status).toBeNull();
    expect(candidate.state.start_date).toBeNull();
    expect(candidate.state.budgeted_hours).toBeNull();
    expect(candidate.state.description).toBe('');
  });
});

describe('projectSmartSearch definition', () => {
  it('accepts a uuid id list as the scope and rejects anything else', () => {
    const id = '5f2b6d3e-1c4a-4b8e-9d1f-2a3b4c5d6e7f';
    expect(projectSmartSearchScopeSchema.safeParse({ projectIds: [id] }).success).toBe(true);
    expect(projectSmartSearchScopeSchema.safeParse({ projectIds: ['not-a-uuid'] }).success).toBe(false);
    expect(projectSmartSearchScopeSchema.safeParse({}).success).toBe(false);
  });

  it('dedupes the ids and re-authorizes them through the projects action', async () => {
    vi.mocked(authorizeProjectIds).mockResolvedValue(['a']);
    const scope = projectSmartSearch.normalizeScope({ projectIds: ['a', 'a', 'b', ''] });
    expect(scope).toEqual({ projectIds: ['a', 'b'] });
    await expect(projectSmartSearch.enumerate(scope)).resolves.toEqual(['a']);
    expect(authorizeProjectIds).toHaveBeenCalledWith(['a', 'b']);
  });

  it('hydrates rows through the project by-id loader and reshapes the result', async () => {
    vi.mocked(loadProjectListItemsByIds).mockResolvedValue({
      projects: [{ project_id: 'a' } as never],
      metadata: { projectTags: { a: [] } },
    });
    await expect(projectSmartSearch.hydrateRows({ projectIds: ['a'] }, ['a'])).resolves.toEqual({
      rows: [{ project_id: 'a' }],
      metadata: { projectTags: { a: [] } },
    });
    expect(loadProjectListItemsByIds).toHaveBeenCalledWith(['a']);
    expect(projectSmartSearch.rowId({ project_id: 'z' } as never)).toBe('z');
  });

  it('names the project facts, tasks, and comments in the question', () => {
    const request = buildRelevanceRequest(projectSmartSearch.relevance, 'q', [assembleProjectCandidate(row, [], [])]);
    const question = JSON.stringify(request.questions.c0.instructions);
    for (const field of ['status', 'is_closed', 'is_inactive', 'project_manager', 'contact', 'client', 'end_date', 'tasks', 'comments']) {
      expect(question).toContain(field);
    }
    expect(question).toContain('only when `query` refers to such things');
    expect(request.questions.c0.criteria?.true).toContain('tasks or comments');
  });
});
