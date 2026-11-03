/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { IProject } from '@alga-psa/types';
import { compareProjectsByName, projectNameMatchesSearch, ProjectListProjectName } from './ProjectListProjectName';

afterEach(cleanup);

describe('project list name redaction', () => {
  it('filters and sorts partially projected projects, then renders a safe label with valid identity navigation', () => {
    const redacted = { project_id: 'p2', project_number: 'PRJ-2' } as IProject;
    const named = { project_id: 'p1', project_name: 'Project 10', project_number: 'PRJ-10' } as IProject;

    expect(projectNameMatchesSearch(redacted, 'prj-2')).toBe(true);
    expect(projectNameMatchesSearch(redacted, 'hidden confidential name')).toBe(false);
    expect([named, redacted].sort(compareProjectsByName).map((project) => project.project_id)).toEqual(['p2', 'p1']);

    render(<ProjectListProjectName project={redacted} fallback="Project name hidden" />);
    expect(screen.getByRole('link', { name: 'Project name hidden' }).getAttribute('href')).toBe('/msp/projects/p2');
    expect(document.body.textContent).not.toContain('Project 10');
  });

  it('renders no navigation when the projected record has no identity', () => {
    const redacted = { project_number: 'PRJ-3' } as IProject;
    render(<ProjectListProjectName project={redacted} fallback="Project name hidden" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Project name hidden')).toBeTruthy();
  });
});
