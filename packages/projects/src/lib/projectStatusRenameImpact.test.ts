import { describe, expect, it } from 'vitest';

import {
  bucketProjectStatusRenameImpact,
  type ProjectStatusRenameImpactRow,
} from './projectStatusRenameImpact';

const STATUS_ID = 'e4734cc0-43e5-4093-8e28-72ad687398ce';
const STATUS_NAME = 'In Progress';

function row(overrides: Partial<ProjectStatusRenameImpactRow>): ProjectStatusRenameImpactRow {
  return {
    status_id: null,
    custom_name: null,
    project_id: 'project-1',
    project_name: 'Project One',
    ...overrides,
  };
}

describe('bucketProjectStatusRenameImpact', () => {
  it('splits columns that follow the rename from columns that keep the old name', () => {
    // Mirrors the real shapes behind UX finding #3: a template-created project
    // links straight to the library status (follows), while an older seeded
    // project pins the label against a standard status (never follows).
    const impact = bucketProjectStatusRenameImpact(
      [
        row({ status_id: STATUS_ID, project_id: 'p-tpl', project_name: 'project from template' }),
        row({ status_id: STATUS_ID, project_id: 'p-tpl', project_name: 'project from template' }),
        row({ custom_name: 'In Progress', project_id: 'p-wonder', project_name: 'Wonderland Expansion' }),
        row({ custom_name: 'In Progress', project_id: 'p-wonder', project_name: 'Wonderland Expansion' }),
        row({ custom_name: 'In Progress', project_id: 'p-emerald', project_name: 'Emerald City Beautification' }),
      ],
      STATUS_ID,
      STATUS_NAME
    );

    expect(impact.statusName).toBe(STATUS_NAME);
    expect(impact.following).toEqual({ columns: 2, projects: ['project from template'] });
    expect(impact.keeping).toEqual({
      columns: 3,
      projects: ['Emerald City Beautification', 'Wonderland Expansion'],
    });
  });

  it('treats a linked column with a pinned custom_name as keeping its own name', () => {
    const impact = bucketProjectStatusRenameImpact(
      [row({ status_id: STATUS_ID, custom_name: 'In Progress', project_name: 'Pinned Project' })],
      STATUS_ID,
      STATUS_NAME
    );

    expect(impact.following.columns).toBe(0);
    expect(impact.keeping).toEqual({ columns: 1, projects: ['Pinned Project'] });
  });

  it('reports an unused status as having no columns at all', () => {
    const impact = bucketProjectStatusRenameImpact([], STATUS_ID, STATUS_NAME);

    expect(impact.following).toEqual({ columns: 0, projects: [] });
    expect(impact.keeping).toEqual({ columns: 0, projects: [] });
  });

  it('counts every column but lists each project once, sorted', () => {
    const impact = bucketProjectStatusRenameImpact(
      [
        row({ status_id: STATUS_ID, project_id: 'b', project_name: 'Beta' }),
        row({ status_id: STATUS_ID, project_id: 'a', project_name: 'Alpha' }),
        row({ status_id: STATUS_ID, project_id: 'a', project_name: 'Alpha' }),
      ],
      STATUS_ID,
      STATUS_NAME
    );

    expect(impact.following.columns).toBe(3);
    expect(impact.following.projects).toEqual(['Alpha', 'Beta']);
  });

  it('falls back to a readable label when a project row has no name', () => {
    const impact = bucketProjectStatusRenameImpact(
      [row({ status_id: STATUS_ID, project_id: 'orphan-1', project_name: null })],
      STATUS_ID,
      STATUS_NAME
    );

    expect(impact.following.projects).toEqual(['Unknown project (orphan-1)']);
  });
});
