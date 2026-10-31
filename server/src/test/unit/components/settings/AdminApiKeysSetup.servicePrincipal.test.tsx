/**
 * @vitest-environment jsdom
 *
 * T034: the admin API keys list shows a principal's name plus a Service badge for principal-owned
 * keys, and renders ordinary users exactly as before. Reads the owner cell the way
 * ApiKeysStatusBadge.test.tsx reads the status cell.
 */
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDefinition } from '@alga-psa/types';

const captured = vi.hoisted(() => ({ columns: [] as ColumnDefinition<any>[] }));

const tr = vi.hoisted(() => (key: string, options?: any) =>
  typeof options === 'string' ? options : options?.defaultValue ?? key);

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ columns }: any) => {
    captured.columns = columns;
    return null;
  },
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: tr }),
  useFormatters: () => ({ formatDate: () => '' }),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (error: unknown) => String(error),
  handleError: vi.fn(),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));
vi.mock('lucide-react', () => ({ Search: () => null, RotateCcw: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <section>{children}</section> }));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ preserveCursor, ...props }: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@/lib/actions/apiKeyActions', () => ({
  adminListApiKeys: vi.fn(async () => []),
  adminDeactivateApiKey: vi.fn(),
}));
vi.mock('@/lib/actions/apiKeyRateLimitActions', () => ({
  getApiRateLimitsForKeys: vi.fn(async () => ({})),
  setApiRateLimitForKey: vi.fn(),
  clearApiRateLimitForKey: vi.fn(),
}));
// CE resolves @enterprise to a render-the-fallback stub; render the real EE cell for this test.
vi.mock(
  '@enterprise/components/service-principals/ApiKeyPrincipalCell',
  () => import('../../../../../../ee/server/src/components/service-principals/ApiKeyPrincipalCell'),
);

import AdminApiKeysSetup from '@/components/settings/security/AdminApiKeysSetup';

async function ownerCell(record: Record<string, unknown>) {
  captured.columns = [];
  render(<AdminApiKeysSetup />);
  await waitFor(() => expect(captured.columns.length).toBeGreaterThan(0));
  const column = captured.columns.find((c) => c.dataIndex === 'username') as { render?: Function };
  return render(<>{column.render!(record.username, record, 0)}</>).container;
}

afterEach(cleanup);

describe('T034 admin API keys owner cell', () => {
  it('shows the principal name with a Service badge for a principal-owned key', async () => {
    const cell = await ownerCell({
      api_key_id: 'key-1',
      username: 'svc-1a2b3c4d',
      first_name: 'Billing sync',
      last_name: null,
      user_type: 'service',
    });
    expect(cell.textContent).toContain('Billing sync');
    expect(cell.querySelector('[data-testid="service-author-badge"]')?.textContent).toBe('Service');
    expect(cell.textContent).not.toContain('svc-1a2b3c4d');
  });

  it('renders a human owner exactly as before, with no badge', async () => {
    const cell = await ownerCell({
      api_key_id: 'key-2',
      username: 'ada',
      first_name: 'Ada',
      last_name: 'Lovelace',
      user_type: 'internal',
    });
    expect(cell.textContent).toBe('Ada Lovelace');
    expect(cell.querySelector('[data-testid="service-author-badge"]')).toBeNull();
  });
});
