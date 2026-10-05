import { describe, expect, it, vi } from 'vitest';
import { resolveMicrosoft365DiagnosticsReport } from './microsoft365DiagnosticsResult';
import type { Microsoft365DiagnosticsReport } from '@alga-psa/shared/interfaces/microsoft365-diagnostics.interfaces';

const report = (providerId: string) => ({
  createdAt: '2026-09-24T00:00:00.000Z',
  summary: { providerId, tenantId: 'tenant', providerType: 'microsoft', mailbox: 'support@example.com', folder: 'Inbox', overallStatus: 'warn' },
  steps: [],
  recommendations: [],
  supportBundle: {},
}) as unknown as Microsoft365DiagnosticsReport;

describe('resolveMicrosoft365DiagnosticsReport', () => {
  it('returns the saved callback report when OAuth tokens are missing or incomplete', async () => {
    const live = vi.fn(async () => report('live'));
    const savedReport = report('saved');
    for (const tokens of [{}, { access_token: 'only-access' }, { refresh_token: 'only-refresh' }]) {
      const result = await resolveMicrosoft365DiagnosticsReport({
        ...tokens,
        last_callback_diagnostic: { source: 'oauth_callback', createdAt: '2026-09-24T01:00:00.000Z', report: savedReport },
      }, live);
      expect(result.summary.providerId).toBe('saved');
      expect(result.diagnosticSource).toBe('oauth_callback');
      expect(result.diagnosticCreatedAt).toBe('2026-09-24T01:00:00.000Z');
    }
    expect(live).not.toHaveBeenCalled();
  });

  it('runs live diagnostics when both persisted tokens are present', async () => {
    const live = vi.fn(async () => report('live'));
    const result = await resolveMicrosoft365DiagnosticsReport({
      access_token: 'access',
      refresh_token: 'refresh',
      last_callback_diagnostic: { source: 'oauth_callback', createdAt: '2026-09-24T01:00:00.000Z', report: report('saved') },
    }, live);
    expect(live).toHaveBeenCalledOnce();
    expect(result.summary.providerId).toBe('live');
  });
});
