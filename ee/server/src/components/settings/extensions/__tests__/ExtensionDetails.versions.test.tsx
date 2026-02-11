/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

import ExtensionDetails from '../ExtensionDetails';

const mockFetchExtensionById = vi.fn();
const mockFetchExtensionVersions = vi.fn();
const mockToggleExtension = vi.fn();
const mockUninstallExtension = vi.fn();
const mockGetInstallInfo = vi.fn();
const mockReprovisionExtension = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ext-123' }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {} }),
}));

vi.mock('../ExtensionPermissions', () => ({
  ExtensionPermissions: () => <div>Permissions component</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@ee/lib/actions/extensionActions', () => ({
  fetchExtensionById: (...args: any[]) => mockFetchExtensionById(...args),
  toggleExtension: (...args: any[]) => mockToggleExtension(...args),
  uninstallExtension: (...args: any[]) => mockUninstallExtension(...args),
}));

vi.mock('@ee/lib/actions/extensionVersionActions', () => ({
  fetchExtensionVersions: (...args: any[]) => mockFetchExtensionVersions(...args),
}));

vi.mock('@ee/lib/actions/extensionDomainActions', () => ({
  getInstallInfo: (...args: any[]) => mockGetInstallInfo(...args),
  reprovisionExtension: (...args: any[]) => mockReprovisionExtension(...args),
}));

function extensionFixture() {
  return {
    id: 'ext-123',
    tenant_id: 'tenant-1',
    name: 'Versions Test Extension',
    description: 'Extension description',
    version: '2.0.0',
    is_enabled: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
    manifest: {
      name: 'Versions Test Extension',
      version: '2.0.0',
      author: 'Vitest',
      permissions: [],
      settings: [],
      components: [],
    },
  };
}

describe('ExtensionDetails versions section', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockFetchExtensionById.mockReset();
    mockFetchExtensionVersions.mockReset();
    mockToggleExtension.mockReset();
    mockUninstallExtension.mockReset();
    mockGetInstallInfo.mockReset();
    mockReprovisionExtension.mockReset();

    mockFetchExtensionById.mockResolvedValue(extensionFixture());
    mockGetInstallInfo.mockResolvedValue(null);
    mockToggleExtension.mockResolvedValue({ success: true });
    mockUninstallExtension.mockResolvedValue({ success: true });
    mockReprovisionExtension.mockResolvedValue({ domain: null });
  });

  it('T017: renders Versions section heading and table when version data exists', async () => {
    mockFetchExtensionVersions.mockResolvedValue([
      {
        versionId: 'v-2',
        version: '2.0.0',
        publishedAt: new Date('2026-01-02T00:00:00.000Z'),
        contentHash: 'sha256:bbbb',
        installed: true,
      },
    ]);

    render(<ExtensionDetails />);

    await waitFor(() => {
      expect(screen.getByText('Versions')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(within(table).getByText('2.0.0')).toBeInTheDocument();
  });

  it('T018: renders columns Version, Published, Content hash, Installed', async () => {
    mockFetchExtensionVersions.mockResolvedValue([
      {
        versionId: 'v-2',
        version: '2.0.0',
        publishedAt: new Date('2026-01-02T00:00:00.000Z'),
        contentHash: 'sha256:bbbb',
        installed: true,
      },
    ]);

    render(<ExtensionDetails />);

    await waitFor(() => {
      expect(screen.getByText('Versions')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Version/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Published/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Content hash/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Installed/i })).toBeInTheDocument();
  });

  it('T019: renders rows sorted newest-first by publish timestamp', async () => {
    mockFetchExtensionVersions.mockResolvedValue([
      {
        versionId: 'v-1',
        version: '1.0.0',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        contentHash: 'sha256:aaaa',
        installed: false,
      },
      {
        versionId: 'v-3',
        version: '3.0.0',
        publishedAt: new Date('2026-01-03T00:00:00.000Z'),
        contentHash: 'sha256:cccc',
        installed: true,
      },
      {
        versionId: 'v-2',
        version: '2.0.0',
        publishedAt: new Date('2026-01-02T00:00:00.000Z'),
        contentHash: 'sha256:bbbb',
        installed: false,
      },
    ]);

    render(<ExtensionDetails />);

    await waitFor(() => {
      expect(screen.getByText('Versions')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1); // drop header row
    expect(rows).toHaveLength(3);

    const firstDataCells = within(rows[0]).getAllByRole('cell');
    expect(firstDataCells[0]).toHaveTextContent('3.0.0');
  });

  it('T020: renders empty-state copy when backend returns no versions', async () => {
    mockFetchExtensionVersions.mockResolvedValue([]);

    render(<ExtensionDetails />);

    await waitFor(() => {
      expect(screen.getByText('Versions')).toBeInTheDocument();
    });

    expect(screen.getByText('No published versions available.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
