/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import FolderTreeView from './FolderTreeView.tsx';

vi.mock('../actions/documentActions', () => ({
  getFolderTree: vi.fn(),
  deleteFolder: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, any> | string) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? _key),
  }),
}));

import { getFolderTree } from '../actions/documentActions';

describe('FolderTreeView visibility indicators', () => {
  it('renders client visibility indicators when enabled', async () => {
    vi.mocked(getFolderTree).mockResolvedValue([
      {
        path: '/Contracts',
        name: 'Contracts',
        children: [],
        documentCount: 1,
        is_client_visible: true,
      },
      {
        path: '/Internal',
        name: 'Internal',
        children: [],
        documentCount: 2,
        is_client_visible: false,
      },
    ]);

    render(
      <FolderTreeView
        selectedFolder={null}
        onFolderSelect={() => undefined}
        showVisibilityIndicators
      />
    );

    expect(await screen.findByText('Contracts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Visible to clients' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hidden from clients' })).toBeDisabled();
  });

  it('hides visibility indicators when disabled', async () => {
    vi.mocked(getFolderTree).mockResolvedValue([
      {
        path: '/Contracts',
        name: 'Contracts',
        children: [],
        documentCount: 1,
        is_client_visible: true,
      },
    ]);

    render(
      <FolderTreeView
        selectedFolder={null}
        onFolderSelect={() => undefined}
      />
    );

    expect(await screen.findByText('Contracts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Visible to clients' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hidden from clients' })).not.toBeInTheDocument();
  });
});
