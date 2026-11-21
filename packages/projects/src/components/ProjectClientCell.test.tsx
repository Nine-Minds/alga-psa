// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@alga-psa/types';
import type { ProjectPickerClient } from '../actions/projectActions';
import { ProjectClientCell } from './ProjectClientCell';

vi.mock('@alga-psa/ui/components/ClientNameCell', () => ({
  default: ({ children, clientName, clientId, logoUrl }: any) => (
    <span data-client-id={clientId ?? ''} data-logo={logoUrl ?? ''}>{children ?? clientName ?? 'No client'}</span>
  ),
}));

const client: ProjectPickerClient = {
  client_id: 'client-1', client_name: 'Acme', client_type: 'company', is_inactive: false, logoUrl: '/acme.png',
};

afterEach(cleanup);

describe('ProjectClientCell', () => {
  it('opens the full client quick view by authorized ID when the project row exposes its client name', () => {
    const openClient = vi.fn();
    render(<ProjectClientCell
      project={{ project_id: 'project-1', client_id: 'client-1', client_name: 'Acme' } as unknown as IProject}
      clients={[client]}
      onOpenClient={openClient}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
    expect(openClient).toHaveBeenCalledWith('client-1', 'project-1');
    expect(screen.getByText('Acme').closest('[data-client-id]')?.getAttribute('data-logo')).toBe('/acme.png');
  });

  it('cannot reconstruct a redacted project client name or create a quick-view entry point from picker data', () => {
    const openClient = vi.fn();
    render(<ProjectClientCell
      project={{ project_id: 'project-1', client_id: 'client-1', client_name: null } as unknown as IProject}
      clients={[client]}
      onOpenClient={openClient}
    />);

    expect(screen.queryByRole('button', { name: 'Acme' })).toBeNull();
    expect(screen.queryByText('Acme')).toBeNull();
    expect(screen.getByText('No client').getAttribute('data-client-id')).toBe('');
    expect(openClient).not.toHaveBeenCalled();
  });
});
