// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const checkCurrentUserPermissions = vi.fn();
vi.mock('@alga-psa/auth/actions', () => ({ checkCurrentUserPermissions: (...a: unknown[]) => checkCurrentUserPermissions(...a) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('../../../actions/cannedResponseActions', () => ({
  getCannedResponseMergeContext: vi.fn(),
  listVisibleCannedResponses: vi.fn(async () => []),
  recordCannedResponseUse: vi.fn(),
  searchCannedResponses: vi.fn(async () => []),
}));

import { useCannedResponseSnippets } from '../useCannedResponseSnippets';

const grant = (read: boolean) =>
  checkCurrentUserPermissions.mockResolvedValue(
    ['read', 'create', 'update', 'delete'].map((action) => ({ resource: 'canned_response', action, granted: action === 'read' ? read : false })),
  );

describe('useCannedResponseSnippets permission gate', () => {
  beforeEach(() => checkCurrentUserPermissions.mockReset());

  it('returns undefined without canned_response:read', async () => {
    grant(false);
    const { result } = renderHook(() => useCannedResponseSnippets('ticket-1', true));
    await waitFor(() => expect(checkCurrentUserPermissions).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeUndefined();
  });

  it('returns a picker config once read is granted', async () => {
    grant(true);
    const { result } = renderHook(() => useCannedResponseSnippets('ticket-1', true));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.idPrefix).toContain('ticket-1');
  });

  it('stays undefined when disabled even with the permission', async () => {
    grant(true);
    const { result } = renderHook(() => useCannedResponseSnippets('ticket-1', false));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeUndefined();
  });
});
