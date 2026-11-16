// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * Fleet Compliance panel: a sync problem must never be reported as a summary
 * problem. Only a failed summary load renders the "unavailable + Retry" card.
 */

const actions = vi.hoisted(() => ({
  getRmmComplianceSummary: vi.fn(),
  triggerPatchStatusSync: vi.fn(),
  triggerSoftwareInventorySync: vi.fn(),
}));
const jobs = vi.hoisted(() => ({ getJobProgressAction: vi.fn() }));

vi.mock('@ee/lib/actions/integrations/ninjaoneActions', () => actions);
vi.mock('@alga-psa/jobs/actions', () => jobs);
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Echo key + interpolation values so assertions can see the counts.
  const t = (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key;
  return { useTranslation: () => ({ t }) };
});

const Dashboard = (await import('../NinjaOneComplianceDashboard')).default;

const baseSummary = {
  totalDevices: 831,
  devicesOnline: 800,
  devicesOffline: 31,
  devicesWithAlerts: 2,
  devicesNeedingPatches: 10,
  patchesPending: 14,
  patchesFailed: 0,
};

const partialRecord = {
  status: 'partial',
  assetsProcessed: 831,
  assetsUpdated: 828,
  assetsFailed: 3,
  errorCount: 25,
  errors: ['PC-1: unreachable', 'PC-2: timeout'],
  startedAt: '2026-11-16T10:00:00.000Z',
  completedAt: '2026-11-16T10:30:00.000Z',
  jobId: 'job-1',
};

const summaryWith = (inventorySync: Record<string, unknown> = {}) => ({
  success: true,
  summary: { ...baseSummary, inventorySync },
});

const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NinjaOneComplianceDashboard', () => {
  it('keeps metrics and sync buttons visible for a partial sync and shows the counts', async () => {
    actions.getRmmComplianceSummary.mockResolvedValue(summaryWith({ software: partialRecord }));
    render(<Dashboard />);

    expect(await screen.findByText('integrations.rmm.ninjaOne.compliance.metrics.devicesOnline')).toBeTruthy();
    expect(screen.getByRole('button', { name: /actions\.syncSoftware/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /actions\.syncPatches/ })).toBeTruthy();

    const strip = document.getElementById('ninjaone-sync-software-strip')!;
    expect(strip.textContent).toContain('compliance.sync.partial.software');
    expect(strip.textContent).toContain('compliance.sync.updated {"value":828}');
    expect(strip.textContent).toContain('compliance.sync.failedCount {"value":3}');
    expect(screen.queryByText('integrations.rmm.ninjaOne.compliance.summaryError')).toBeNull();
    expect(screen.queryByText('integrations.rmm.ninjaOne.compliance.actions.retry')).toBeNull();
  });

  it('lists the capped errors behind the Details disclosure', async () => {
    actions.getRmmComplianceSummary.mockResolvedValue(summaryWith({ software: partialRecord }));
    render(<Dashboard />);
    await screen.findByText('integrations.rmm.ninjaOne.compliance.metrics.devicesOnline');

    expect(screen.queryByText('PC-1: unreachable')).toBeNull();
    fireEvent.click(document.getElementById('ninjaone-sync-software-details-btn')!);
    expect(screen.getByText('PC-1: unreachable')).toBeTruthy();
    expect(screen.getByText('PC-2: timeout')).toBeTruthy();
    // 25 total errors, only 2 stored: the panel says so.
    expect(document.getElementById('ninjaone-sync-software-strip')!.textContent)
      .toContain('compliance.sync.truncated {"shown":2,"total":25}');
  });

  it('renders the unavailable card only when the summary itself fails', async () => {
    actions.getRmmComplianceSummary.mockResolvedValue({ success: false, error: 'Unable to load NinjaOne compliance summary.' });
    render(<Dashboard />);

    expect(await screen.findByText('Unable to load NinjaOne compliance summary.')).toBeTruthy();
    expect(document.getElementById('ninjaone-compliance-retry-btn')).toBeTruthy();
    expect(document.getElementById('ninjaone-sync-software-btn')).toBeNull();
    expect(screen.queryByText('integrations.rmm.ninjaOne.compliance.metrics.devicesOnline')).toBeNull();
  });

  it('shows a sync-specific failure with Retry and leaves the panel intact when starting a sync fails', async () => {
    actions.getRmmComplianceSummary.mockResolvedValue(summaryWith());
    actions.triggerSoftwareInventorySync.mockResolvedValue({ success: false, error: 'NinjaOne integration not configured' });
    render(<Dashboard />);
    await screen.findByText('integrations.rmm.ninjaOne.compliance.metrics.devicesOnline');

    fireEvent.click(document.getElementById('ninjaone-sync-software-btn')!);
    await flush();

    const strip = document.getElementById('ninjaone-sync-software-strip')!;
    expect(strip.textContent).toContain('compliance.sync.failed.software');
    expect(strip.textContent).toContain('NinjaOne integration not configured');
    expect(document.getElementById('ninjaone-sync-software-retry-btn')).toBeTruthy();
    // The panel stayed: metrics, buttons, and no summary-error wording.
    expect(screen.getByText('integrations.rmm.ninjaOne.compliance.metrics.devicesOnline')).toBeTruthy();
    expect(document.getElementById('ninjaone-sync-patches-btn')).toBeTruthy();
    expect(screen.queryByText('integrations.rmm.ninjaOne.compliance.summaryError')).toBeNull();
  });

  it('seeds a failed outcome from the stored record and Retry re-triggers that kind', async () => {
    actions.getRmmComplianceSummary.mockResolvedValue(summaryWith({
      patches: { ...partialRecord, status: 'failed', assetsFailed: 0, assetsUpdated: 0, errors: ['boom'], errorCount: 1 },
    }));
    actions.triggerPatchStatusSync.mockResolvedValue({ success: true, jobId: 'job-9' });
    jobs.getJobProgressAction.mockResolvedValue({ header: { status: 'processing' }, details: [] });
    render(<Dashboard />);
    await screen.findByText('integrations.rmm.ninjaOne.compliance.metrics.devicesOnline');

    expect(document.getElementById('ninjaone-sync-patches-strip')!.textContent).toContain('boom');
    fireEvent.click(document.getElementById('ninjaone-sync-patches-retry-btn')!);
    await flush();
    expect(actions.triggerPatchStatusSync).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ninjaone-sync-patches-strip')!.textContent).toContain('compliance.sync.running.patches');
  });

  describe('polling a running job', () => {
    const running = { status: 'running', jobId: 'job-live', startedAt: '2026-11-16T10:00:00.000Z' };
    const progress = (status: string, done?: number, total?: number) => ({
      header: { status },
      details: done === undefined ? [] : [{ result: JSON.stringify({ kind: 'software', done, total }) }],
    });

    it('shows done/total, disables only the running kind, and refetches once when the job finishes', async () => {
      vi.useFakeTimers();
      actions.getRmmComplianceSummary
        .mockResolvedValueOnce(summaryWith({ software: running }))
        .mockResolvedValueOnce(summaryWith({ software: { ...partialRecord, jobId: 'job-live' } }));
      jobs.getJobProgressAction
        .mockResolvedValueOnce(progress('processing', 412, 831))
        .mockResolvedValueOnce(progress('processing', 600, 831))
        .mockResolvedValueOnce(progress('completed', 831, 831));

      render(<Dashboard />);
      await flush();
      await flush();

      const strip = () => document.getElementById('ninjaone-sync-software-strip')!.textContent;
      expect(strip()).toContain('compliance.sync.progress {"done":412,"total":831}');
      expect((document.getElementById('ninjaone-sync-software-btn') as HTMLButtonElement).disabled).toBe(true);
      expect((document.getElementById('ninjaone-sync-patches-btn') as HTMLButtonElement).disabled).toBe(false);

      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(strip()).toContain('"done":600');

      expect(actions.getRmmComplianceSummary).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      await flush();
      // Terminal job → exactly one more summary fetch, which delivers the durable outcome.
      expect(actions.getRmmComplianceSummary).toHaveBeenCalledTimes(2);
      expect(strip()).toContain('compliance.sync.partial.software');
      expect((document.getElementById('ninjaone-sync-software-btn') as HTMLButtonElement).disabled).toBe(false);

      // Polling has stopped.
      const calls = jobs.getJobProgressAction.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(jobs.getJobProgressAction.mock.calls.length).toBe(calls);
    });

    it('stops polling when the panel unmounts', async () => {
      vi.useFakeTimers();
      actions.getRmmComplianceSummary.mockResolvedValue(summaryWith({ software: running }));
      jobs.getJobProgressAction.mockResolvedValue(progress('processing', 1, 831));

      const { unmount } = render(<Dashboard />);
      await flush();
      await flush();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      const calls = jobs.getJobProgressAction.mock.calls.length;
      expect(calls).toBeGreaterThanOrEqual(2);

      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(jobs.getJobProgressAction.mock.calls.length).toBe(calls);
    });

    it('a record still saying running once the job is terminal is reported as a sync failure, not a summary failure', async () => {
      vi.useFakeTimers();
      actions.getRmmComplianceSummary.mockResolvedValue(summaryWith({ software: running }));
      jobs.getJobProgressAction.mockResolvedValue(progress('completed'));

      render(<Dashboard />);
      await flush();
      await flush();
      await flush();

      expect(document.getElementById('ninjaone-sync-software-strip')!.textContent)
        .toContain('compliance.sync.endedWithoutResult');
      expect(screen.getByText('integrations.rmm.ninjaOne.compliance.metrics.devicesOnline')).toBeTruthy();
    });
  });
});
