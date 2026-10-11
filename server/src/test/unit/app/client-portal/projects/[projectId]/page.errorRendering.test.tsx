import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const PROJECT_ID = '6f1b0e3c-6a4f-4d5e-9b2a-7c8d9e0f1a2b';
const SQL_ERROR_MESSAGE =
  'select "p".* from "projects" as "p" where "p"."project_id" = $1 - invalid input syntax for type uuid: "garbage"';

const getClientProjectDetailsMock = vi.fn();
const loggerMock = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientProjectDetails: getClientProjectDetailsMock,
}));

vi.mock('@alga-psa/client-portal/components', () => ({
  ProjectDetailsContainer: () => <div id="project-details">project details</div>,
}));

vi.mock('@alga-psa/core/logger', () => ({ default: loggerMock }));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: async () => ({
    t: (key: string, options?: { defaultValue?: string; message?: string }) =>
      (options?.defaultValue ?? key).replace('{{message}}', options?.message ?? ''),
  }),
}));

const { default: ProjectPage } = await import('server/src/app/client-portal/projects/[projectId]/page');

const render = async () =>
  renderToStaticMarkup(await ProjectPage({ params: Promise.resolve({ projectId: PROJECT_ID }) }));

describe('client portal project page error rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only the generic message when the project action throws, and logs the raw detail', async () => {
    getClientProjectDetailsMock.mockRejectedValue(new Error(SQL_ERROR_MESSAGE));

    const html = await render();

    expect(html).toContain('id="project-error-message"');
    expect(html).toContain('Failed to load project details');
    expect(html).not.toContain('select');
    expect(html).not.toContain('projects');
    expect(html).not.toContain('uuid');
    expect(html).not.toContain('at ');
    expect(html).not.toContain('Error:');
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[ClientPortal] Failed to fetch project details',
      expect.objectContaining({ projectId: PROJECT_ID, error: SQL_ERROR_MESSAGE }),
    );
  });

  it('renders the action error text for a returned action error', async () => {
    getClientProjectDetailsMock.mockResolvedValue({
      actionError: 'Project not found or access denied',
    });

    const html = await render();

    expect(html).toContain('id="project-error-message"');
    expect(html).toContain('Project not found or access denied');
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('renders the project when the action succeeds', async () => {
    getClientProjectDetailsMock.mockResolvedValue({ project_id: PROJECT_ID, project_name: 'Alpha' });

    const html = await render();

    expect(html).toContain('project details');
    expect(html).not.toContain('project-error-message');
  });
});
