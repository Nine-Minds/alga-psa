import type { Microsoft365DiagnosticsReport } from '@alga-psa/shared/interfaces/microsoft365-diagnostics.interfaces';

interface StoredCallbackDiagnostic {
  source: 'oauth_callback';
  createdAt: string;
  report: Microsoft365DiagnosticsReport;
}

interface MicrosoftDiagnosticTokenState {
  access_token?: string | null;
  refresh_token?: string | null;
  last_callback_diagnostic?: StoredCallbackDiagnostic | null;
}

export async function resolveMicrosoft365DiagnosticsReport(
  vendorConfig: MicrosoftDiagnosticTokenState | null | undefined,
  runLive: () => Promise<Microsoft365DiagnosticsReport>,
): Promise<Microsoft365DiagnosticsReport> {
  const stored = vendorConfig?.last_callback_diagnostic;
  if (stored && !(vendorConfig?.access_token && vendorConfig?.refresh_token)) {
    return {
      ...stored.report,
      diagnosticSource: 'oauth_callback',
      diagnosticCreatedAt: stored.createdAt,
    } as Microsoft365DiagnosticsReport;
  }
  return runLive();
}
