/* @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getProjectMetadata: vi.fn() }));
vi.mock('../actions/projectActions', () => ({ getProjectMetadata: h.getProjectMetadata, updateProject: vi.fn() }));
vi.mock('./ProjectInfo', () => ({ default: ({ project }: any) => <div data-testid="project-info">{project.project_name}</div> }));
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function metadata(name: string) {
  return { project: { project_id: name, project_name: name }, phases: [], statuses: [], users: [], clients: [], assignedUser: null };
}

describe('project detail metadata access state', () => {
  it('settles in a denied state after metadata permission denial', async () => {
    h.getProjectMetadata.mockResolvedValue({ permissionError: 'Permission denied: Project fields are redacted' });
    render(<ProjectPage params={Promise.resolve({ id: 'p1' })} />);

    expect((await screen.findByRole('alert')).textContent).toContain('You do not have permission to view this project.');
    await waitFor(() => expect(screen.queryByText('projectDetail.loading')).toBeNull());
  });

  it('hides ready project content when navigation to another project is denied', async () => {
    h.getProjectMetadata.mockImplementation(async (id: string) => id === 'p1'
      ? metadata('Project One')
      : { permissionError: 'Permission denied: Project fields are redacted' });
    const { rerender } = render(<ProjectPage params={Promise.resolve({ id: 'p1' })} />);
    expect(await screen.findByText('Project One')).toBeTruthy();

    rerender(<ProjectPage params={Promise.resolve({ id: 'p2' })} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Project One')).toBeNull();
  });

  it('ignores an older successful response that completes after the newer project is denied', async () => {
    const oldRequest = deferred<any>();
    h.getProjectMetadata.mockImplementation((id: string) => id === 'p1'
      ? oldRequest.promise
      : Promise.resolve({ permissionError: 'Permission denied: Project fields are redacted' }));

    const { rerender } = render(<ProjectPage params={Promise.resolve({ id: 'p1' })} />);
    await waitFor(() => expect(h.getProjectMetadata).toHaveBeenCalledWith('p1'));
    rerender(<ProjectPage params={Promise.resolve({ id: 'p2' })} />);
    expect(await screen.findByRole('alert')).toBeTruthy();

    await act(async () => { oldRequest.resolve(metadata('Stale Project One')); });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Stale Project One')).toBeNull();
  });
});
