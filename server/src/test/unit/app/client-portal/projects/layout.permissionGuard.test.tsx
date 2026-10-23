import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const enforceServerProductRouteMock = vi.fn();
const getCurrentUserMock = vi.fn();
const hasPermissionMock = vi.fn();

vi.mock('@/lib/serverProductRouteGuard', () => ({
  enforceServerProductRoute: (...args: unknown[]) => enforceServerProductRouteMock(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: async () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const { default: ProjectsLayout } = await import('server/src/app/client-portal/projects/layout');

const render = async () =>
  renderToStaticMarkup(
    (await ProjectsLayout({ children: <div id="projects-content">projects</div> })) as React.ReactElement,
  );

describe('client portal projects layout permission guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceServerProductRouteMock.mockResolvedValue(null);
    getCurrentUserMock.mockResolvedValue({ user_id: 'portal-user-1', user_type: 'client', tenant: 'tenant-1' });
    hasPermissionMock.mockResolvedValue(true);
  });

  it('renders the denied alert instead of the projects surface without project:read', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const html = await render();

    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'portal-user-1' }),
      'project',
      'read',
    );
    expect(html).toContain('id="project-permission-error"');
    expect(html).toContain('Insufficient permissions to view projects');
    expect(html).not.toContain('projects-content');
  });

  it('renders the denied alert when there is no resolvable caller', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const html = await render();

    expect(hasPermissionMock).not.toHaveBeenCalled();
    expect(html).toContain('id="project-permission-error"');
    expect(html).not.toContain('projects-content');
  });

  it('renders children once project:read is granted', async () => {
    const html = await render();

    expect(html).toContain('projects-content');
    expect(html).not.toContain('project-permission-error');
  });

  it('keeps the product-route boundary ahead of the permission check', async () => {
    enforceServerProductRouteMock.mockResolvedValue(<div id="product-boundary">boundary</div>);

    const html = await render();

    expect(html).toContain('product-boundary');
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });
});
