/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KBImportDialog from '../../../../../packages/documents/src/components/kb/KBImportDialog';

const mocks = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn(), resume: vi.fn(), start: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../../../../../packages/documents/src/actions/kbArticleActions', () => ({
  getUnfinishedArticleImports: mocks.list, getArticleImportStatus: mocks.status,
  resumeArticleImport: mocks.resume, startArticleImport: mocks.start,
}));
const translate = (_key: string, options: any) => typeof options === 'string' ? options : options?.defaultValue || _key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('@alga-psa/ui/hooks/useKnowledgeBaseEnumOptions', () => ({
  useArticleAudienceOptions: () => [], useArticleTypeOptions: () => [],
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant: _variant, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ isOpen, children, footer }: any) => isOpen ? <div>{children}{footer}</div> : null }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionPermissionError: (value: any) => value?._type === 'permission-error', handleError: mocks.error,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: mocks.success, error: mocks.error } }));
const batch = { jobId: 'batch-1', filename: 'Saved guide.md', total: 2, pending: 1, createdAt: '2026-09-06T00:00:00Z' };
const progress = { total: 2, imported: 1, failed: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({ imports: [batch], hasMore: false, canResume: true });
  mocks.status.mockResolvedValue({ ...progress, status: 'retry_required' });
  mocks.resume.mockResolvedValue({ jobId: batch.jobId, total: batch.total });
});
afterEach(cleanup);

describe('KB import recovery UI', () => {
  it('keeps paused files visible, disables growth, and resumes the same batch after renewal', async () => {
    mocks.list.mockResolvedValue({ imports: [batch], hasMore: false, canResume: false });
    mocks.status.mockResolvedValue({ ...progress, status: 'paused' });
    const complete = vi.fn();
    render(<KBImportDialog isOpen onClose={() => {}} onImportComplete={complete} />);
    await screen.findByText(batch.filename);
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }));
    expect(await screen.findByRole('button', { name: 'Resume import' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Your files are saved');
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue({ imports: [batch], hasMore: false, canResume: true });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume import' })).toBeEnabled());
    mocks.status.mockResolvedValue({ total: 2, imported: 2, failed: [], status: 'completed' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume import' }));
    await screen.findByRole('button', { name: 'Done' });
    expect(mocks.resume).toHaveBeenCalledExactlyOnceWith('batch-1');
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalled();
  });

  it('retains the batch after a lost resume response and never starts a replacement upload', async () => {
    mocks.resume.mockRejectedValueOnce(new Error('Connection lost'));
    render(<KBImportDialog isOpen onClose={() => {}} onImportComplete={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View progress' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume import' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume import' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Resume import' }));
    await waitFor(() => expect(mocks.resume).toHaveBeenCalledTimes(2));
    expect(mocks.resume.mock.calls).toEqual([['batch-1'], ['batch-1']]);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('ignores a pending poll result after the dialog closes', async () => {
    let resolveStatus!: (value: any) => void;
    mocks.status.mockReturnValueOnce(new Promise(resolve => { resolveStatus = resolve; }));
    const complete = vi.fn();
    const view = render(<KBImportDialog isOpen onClose={() => {}} onImportComplete={complete} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View progress' }));
    await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());
    view.rerender(<KBImportDialog isOpen={false} onClose={() => {}} onImportComplete={complete} />);
    await act(async () => resolveStatus({ ...progress, status: 'completed' }));
    expect(complete).not.toHaveBeenCalled(); expect(mocks.success).not.toHaveBeenCalled();
    view.rerender(<KBImportDialog isOpen onClose={() => {}} onImportComplete={complete} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'View progress' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }));
    expect(await screen.findByRole('button', { name: 'Resume import' })).toBeEnabled();
  });

  it('loads further retained batches on demand', async () => {
    mocks.list.mockResolvedValueOnce({ imports: [batch], hasMore: true, canResume: true });
    render(<KBImportDialog isOpen onClose={() => {}} onImportComplete={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(20));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(mocks.list.mock.calls.at(-1)).toEqual([0]));
  });
});
