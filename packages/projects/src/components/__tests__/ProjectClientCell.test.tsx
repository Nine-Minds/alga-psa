/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectClientCell } from '../ProjectClientCell';

vi.mock('@alga-psa/ui/components/ClientNameCell', () => ({
  default: ({ clientName, logoUrl, children }: any) => (
    <div>{clientName && <span>{clientName}</span>}{logoUrl && <img alt="client logo" src={logoUrl} />}{children}</div>
  ),
}));

describe('ProjectClientCell', () => {
  afterEach(cleanup);

  const clients = [{ client_id: 'client-1', client_name: 'Wonderland LLC', logoUrl: '/wonderland-logo.png' }] as any[];

  it('keeps the project row client-masked despite global client options and removes its quick-view trigger', () => {
    const onQuickView = vi.fn();
    render(<>
      <span>Wonderland Expansion</span>
      <ProjectClientCell project={{ project_id: 'project-1', client_id: 'client-1', client_name: null } as any} clients={clients} onQuickView={onQuickView} />
    </>);

    expect(screen.getByText('Wonderland Expansion')).toBeInTheDocument();
    expect(screen.queryByText('Wonderland LLC')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'client logo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wonderland LLC' })).not.toBeInTheDocument();
    expect(onQuickView).not.toHaveBeenCalled();
  });

  it('renders the client and quick view when the authorized project projection is unredacted', () => {
    const onQuickView = vi.fn();
    render(<ProjectClientCell project={{ project_id: 'project-1', client_id: 'client-1', client_name: 'Wonderland LLC' } as any} clients={clients} onQuickView={onQuickView} />);

    fireEvent.click(screen.getByRole('button', { name: 'Wonderland LLC' }));
    expect(screen.getByRole('img', { name: 'client logo' })).toHaveAttribute('src', '/wonderland-logo.png');
    expect(onQuickView).toHaveBeenCalledWith('client-1');
  });
});
