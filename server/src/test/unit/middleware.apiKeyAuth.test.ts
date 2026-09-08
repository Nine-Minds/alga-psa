import { describe, expect, it } from 'vitest';

import { shouldSkipApiKeyAuth } from 'server/src/middleware';

describe('shouldSkipApiKeyAuth', () => {
  it('lets only the co-managed browser export and file routes perform their tracked session admission', () => {
    for (const path of ['/api/co-management/export', '/api/co-management/attachments/file-id', '/api/co-management/archive-files/file-id']) expect(shouldSkipApiKeyAuth(path)).toBe(true);
    for (const path of ['/api/co-management/export-admin', '/api/co-management/export/extra', '/api/co-management/attachments/file-id/extra', '/api/co-management/unknown']) expect(shouldSkipApiKeyAuth(path)).toBe(false);
  });
  it('allows SCIM routes to perform Bearer authentication in the route handler', () => {
    expect(shouldSkipApiKeyAuth('/api/scim/v2/connection-id/Users')).toBe(true);
    expect(shouldSkipApiKeyAuth('/api/scim-malicious/v2/connection-id/Users')).toBe(false);
  });

  it('allows the Teams package download route to use session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/teams/package/download')).toBe(true);
  });

  it('allows the Teams artifact webhook (Microsoft Graph notifications, clientState-authenticated)', () => {
    expect(shouldSkipApiKeyAuth('/api/teams/webhooks/recordings')).toBe(true);
  });

  it('allows document preview routes to use session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/documents/123/preview')).toBe(true);
    expect(shouldSkipApiKeyAuth('/api/documents/123/thumbnail')).toBe(true);
  });

  it('allows document download/content routes to use session auth (e.g. meeting transcripts)', () => {
    expect(shouldSkipApiKeyAuth('/api/documents/123/download')).toBe(true);
    expect(shouldSkipApiKeyAuth('/api/documents/123/content')).toBe(true);
  });

  it('allows the Teams online-meeting recording proxy to use session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/online-meetings/recordings/artifact-123')).toBe(true);
  });

  it('allows public appointment calendar downloads from email links', () => {
    expect(shouldSkipApiKeyAuth('/api/calendar/appointment/2187d639-b796-4b0e-b760-8a2576bb435f.ics')).toBe(true);
  });

  it('allows the email watch refresh route to use session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/email/refresh-watch')).toBe(true);
  });

  it('allows workflow run APIs to use MSP session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/workflow-runs')).toBe(true);
    expect(shouldSkipApiKeyAuth('/api/workflow-runs/run-123/audit/export')).toBe(true);
    expect(shouldSkipApiKeyAuth('/api/workflow-runs/run-123')).toBe(true);
  });

  it('allows workflow definition APIs to use MSP session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/workflow-definitions')).toBe(true);
    expect(shouldSkipApiKeyAuth('/api/workflow-definitions/workflow-123/audit/export')).toBe(true);
  });

  it('allows ticket live token APIs to use MSP session auth', () => {
    expect(shouldSkipApiKeyAuth('/api/tickets/ticket-123/live-token')).toBe(true);
  });

  it('still requires an API key for unrelated API routes', () => {
    expect(shouldSkipApiKeyAuth('/api/teams/package/upload')).toBe(false);
    expect(shouldSkipApiKeyAuth('/api/instanceinfo')).toBe(false);
  });
});
