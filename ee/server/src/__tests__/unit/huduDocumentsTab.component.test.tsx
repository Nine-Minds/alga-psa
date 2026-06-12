// @vitest-environment jsdom
/**
 * T244 — Documents page "Hudu" tab component (global-docs group). jsdom +
 * @testing-library, mirroring huduClientPasswordsTab.component.test idioms:
 * the global-docs action, i18n and UI primitives are mocked; assertions run
 * against the DOM. Covers row rendering (deep-links + Unmapped badge), the
 * debounced search refetch, and prev/next paging incl. disabled states.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HuduDocumentsTab } from '@ee/components/integrations/hudu/HuduDocumentsTab';
import type { HuduGlobalArticlesResult } from '@ee/lib/actions/integrations/huduGlobalDocsActions';

const { listHuduArticlesAcrossCompaniesMock } = vi.hoisted(() => ({
  listHuduArticlesAcrossCompaniesMock: vi.fn(),
}));

// Same module as the component's relative import (vitest dedupes by resolved id).
vi.mock('@ee/lib/actions/integrations/huduGlobalDocsActions', () => ({
  listHuduArticlesAcrossCompanies: listHuduArticlesAcrossCompaniesMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <span id={id} data-variant={variant}>
      {children}
    </span>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button id={id} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { id?: string }) => (
    <input id={id} {...props} />
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <div id={id} role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const CLIENT_1 = '11111111-1111-1111-1111-111111111111';

function okResult(overrides: Partial<Extract<HuduGlobalArticlesResult, { state: 'ok' }>> = {}):
  HuduGlobalArticlesResult {
  return {
    state: 'ok',
    articles: [
      {
        id: 1,
        name: 'Mapped Runbook',
        updated_at: '2026-06-01T00:00:00Z',
        url: 'https://docs.example.com/articles/1',
        company_id: 101,
        company_name: 'ExampleCo',
        client_id: CLIENT_1,
        client_name: 'Example Client',
      },
      {
        id: 2,
        name: 'Orphan Article',
        updated_at: null,
        url: null,
        company_id: 999,
        company_name: null,
        client_id: null,
        client_name: null,
      },
    ],
    page: 1,
    hasMore: true,
    fetchedAt: '2026-06-11T00:00:00.000Z',
    ...overrides,
  };
}

async function renderTab() {
  const utils = render(<HuduDocumentsTab />);
  await waitFor(() => {
    expect(document.getElementById('hudu-docs-loading')).toBeNull();
  });
  return utils;
}

beforeEach(() => {
  listHuduArticlesAcrossCompaniesMock.mockReset();
  listHuduArticlesAcrossCompaniesMock.mockResolvedValue(okResult());
});

describe('T244: HuduDocumentsTab', () => {
  it('renders article rows: deep-linked names, resolved client or Unmapped badge, company, updated', async () => {
    await renderTab();

    const link = document.getElementById('hudu-docs-link-1') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://docs.example.com/articles/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toContain('Mapped Runbook');

    expect(document.getElementById('hudu-docs-client-1')?.textContent).toBe('Example Client');
    expect(document.getElementById('hudu-docs-unmapped-1')).toBeNull();
    expect(document.getElementById('hudu-docs-company-1')?.textContent).toBe('ExampleCo');
    expect(document.getElementById('hudu-docs-updated-1')?.textContent).not.toBe('—');

    // Unmapped/unknown row: plain name (no link), Unmapped badge, dashes.
    const orphan = document.getElementById('hudu-docs-link-2') as HTMLElement;
    expect(orphan.tagName).toBe('SPAN');
    expect(document.getElementById('hudu-docs-client-2')).toBeNull();
    expect(document.getElementById('hudu-docs-unmapped-2')?.textContent).toBe('Unmapped');
    expect(document.getElementById('hudu-docs-company-2')?.textContent).toBe('—');
    expect(document.getElementById('hudu-docs-updated-2')?.textContent).toBe('—');
  });

  it('renders the empty state when the page has no articles', async () => {
    listHuduArticlesAcrossCompaniesMock.mockResolvedValue(okResult({ articles: [], hasMore: false }));
    await renderTab();

    expect(document.getElementById('hudu-docs-empty')?.textContent).toBe('No Hudu articles found.');
    expect(document.getElementById('hudu-docs-table')).toBeNull();
  });

  it('renders distinct disconnected and error states', async () => {
    listHuduArticlesAcrossCompaniesMock.mockResolvedValue({ state: 'disconnected' });
    const { unmount } = await renderTab();
    expect(document.getElementById('hudu-docs-disconnected')).toBeTruthy();
    expect(document.getElementById('hudu-docs-error')).toBeNull();
    unmount();

    listHuduArticlesAcrossCompaniesMock.mockResolvedValue({ state: 'error', error: 'boom' });
    await renderTab();
    expect(document.getElementById('hudu-docs-error')).toBeTruthy();
    expect(document.getElementById('hudu-docs-disconnected')).toBeNull();
  });

  it('search input (debounced) refetches with the term and resets to page 1', async () => {
    await renderTab();
    // Advance to page 2 first so the search reset is observable.
    fireEvent.click(document.getElementById('hudu-docs-next')!);
    await waitFor(() => {
      expect(listHuduArticlesAcrossCompaniesMock).toHaveBeenCalledWith({ page: 2 });
    });

    fireEvent.change(document.getElementById('hudu-docs-search')!, { target: { value: 'wifi' } });

    await waitFor(() => {
      expect(listHuduArticlesAcrossCompaniesMock).toHaveBeenCalledWith({ page: 1, search: 'wifi' });
    });
  });

  it('next/prev call the action with page±1 and respect their disabled states', async () => {
    await renderTab();
    expect(listHuduArticlesAcrossCompaniesMock).toHaveBeenCalledWith({ page: 1 });

    const prev = () => document.getElementById('hudu-docs-prev') as HTMLButtonElement;
    const next = () => document.getElementById('hudu-docs-next') as HTMLButtonElement;

    // Page 1: prev disabled, next enabled (hasMore true).
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);

    fireEvent.click(next());
    await waitFor(() => {
      expect(listHuduArticlesAcrossCompaniesMock).toHaveBeenCalledWith({ page: 2 });
    });
    await waitFor(() => {
      expect(prev().disabled).toBe(false);
    });
    expect(document.getElementById('hudu-docs-page')?.textContent).toContain('2');

    fireEvent.click(prev());
    await waitFor(() => {
      expect(listHuduArticlesAcrossCompaniesMock).toHaveBeenLastCalledWith({ page: 1 });
    });
    await waitFor(() => {
      expect(prev().disabled).toBe(true);
    });
  });

  it('next is disabled on a short (last) page', async () => {
    listHuduArticlesAcrossCompaniesMock.mockResolvedValue(okResult({ hasMore: false }));
    await renderTab();

    expect((document.getElementById('hudu-docs-next') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('hudu-docs-prev') as HTMLButtonElement).disabled).toBe(true);
  });
});
