/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getProjectMetadata: vi.fn() }));
vi.mock('../actions/projectActions', () => ({ getProjectMetadata: h.getProjectMetadata, updateProject: vi.fn() }));
vi.mock('./ProjectInfo', () => ({ default: () => null }));
vi.mock('./ProjectDetail', () => ({ default: () => null }));
vi.mock('./TaskShareActionsContext', () => ({ TaskShareActionsProvider: ({ children }: any) => children }));
vi.mock('./TaskSelectionContext', () => ({ TaskSelectionProvider: ({ children }: any) => children }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => '/msp/projects/p1' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => options?.defaultValue ?? key }) }));

import ProjectPage from './ProjectPage';

afterEach(() => {
  cleanup();
  h.getProjectMetadata.mockReset();
});

describe('project detail metadata access state', () => {
  it('settles in a denied state after metadata permission denial', async () => {
    h.getProjectMetadata.mockResolvedValue({ permissionError: 'Permission denied: Project fields are redacted' });
    render(<ProjectPage params={Promise.resolve({ id: 'p1' })} />);

    expect((await screen.findByRole('alert')).textContent).toContain('You do not have permission to view this project.');
    await waitFor(() => expect(screen.queryByText('projectDetail.loading')).toBeNull());
  });
});
