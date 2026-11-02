/**
 * @vitest-environment jsdom
 *
 * T034: the admin API keys list shows a principal's name plus a Service badge for principal-owned
 * keys, and renders ordinary users exactly as before. Reads the owner cell the way
 * ApiKeysStatusBadge.test.tsx reads the status cell.
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDefinition } from '@alga-psa/types';

const captured = vi.hoisted(() => ({ columns: [] as ColumnDefinition<any>[], data: [] as any[] }));
const mocks = vi.hoisted(() => ({ list: vi.fn(async () => [] as any[]) }));

const tr = vi.hoisted(() => (key: string, options?: any) =>
  typeof options === 'string' ? options : options?.defaultValue ?? key);

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ columns, data }: any) => {
    captured.columns = columns;
    captured.data = data;
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
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@/lib/actions/apiKeyActions', () => ({
  adminListApiKeys: mocks.list,
  adminDeactivateApiKey: vi.fn(),
}));
vi.mock('@/lib/actions/apiKeyRateLimitActions', () => ({
  getApiRateLimitsForKeys: vi.fn(async (ids: string[]) => ids.map((apiKeyId) => ({
    apiKeyId,
    effective: { maxTokens: 120, refillPerMin: 60 },
    override: null,
    source: 'default',
  }))),
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

describe('admin API key status and search filters', () => {
  const keys = [
    { api_key_id: 'human-active', description: 'Human active key', username: 'ada', first_name: 'Ada', last_name: 'Lovelace', user_type: 'internal', active: true },
    { api_key_id: 'human-inactive', description: 'Human inactive key', username: 'grace', first_name: 'Grace', last_name: 'Hopper', user_type: 'internal', active: false },
    { api_key_id: 'mcp-active', description: 'mcp-agent-session permanent key', username: 'mcp-owner', first_name: 'MCP owner', last_name: null, user_type: 'service', purpose: 'service', active: true },
    { api_key_id: 'service-inactive', description: 'mcp-agent-session retired key', username: 'api-bot', first_name: 'API bot', last_name: null, user_type: 'service', purpose: 'service', active: false },
  ];

  async function renderKeys() {
    mocks.list.mockResolvedValue(keys as any);
    captured.data = [];
    render(<AdminApiKeysSetup />);
    await waitFor(() => expect(captured.data).toHaveLength(2));
  }

  it('keeps all, active, and inactive totals aligned before and after search', async () => {
    await renderKeys();
    const status = document.getElementById('admin-api-keys-status-filter') as HTMLSelectElement;
    const search = document.getElementById('search-admin-api-keys') as HTMLInputElement;

    expect(captured.data.map((key) => key.api_key_id)).toEqual(['human-active', 'mcp-active']);
    fireEvent.change(status, { target: { value: 'all' } });
    await waitFor(() => expect(captured.data).toHaveLength(4));
    fireEvent.change(status, { target: { value: 'inactive' } });
    await waitFor(() => expect(captured.data.map((key) => key.api_key_id)).toEqual(['human-inactive', 'service-inactive']));
    fireEvent.change(status, { target: { value: 'active' } });
    await waitFor(() => expect(captured.data.map((key) => key.api_key_id)).toEqual(['human-active', 'mcp-active']));

    fireEvent.change(search, { target: { value: 'mcp-agent-session' } });
    fireEvent.change(status, { target: { value: 'all' } });
    await waitFor(() => expect(captured.data.map((key) => key.api_key_id)).toEqual(['mcp-active', 'service-inactive']), { timeout: 1500 });
    fireEvent.change(status, { target: { value: 'active' } });
    await waitFor(() => expect(captured.data.map((key) => key.api_key_id)).toEqual(['mcp-active']));
    fireEvent.change(status, { target: { value: 'inactive' } });
    await waitFor(() => expect(captured.data.map((key) => key.api_key_id)).toEqual(['service-inactive']));
  });
});
