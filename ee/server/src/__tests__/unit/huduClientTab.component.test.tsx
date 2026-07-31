// @vitest-environment jsdom
/**
 * T070 (component guard), T071, T073, T074 — client "Hudu" tab component
 * (client-hudu-tab group). jsdom + @testing-library, mirroring
 * huduCompanyMappingManager.component.test idioms: the data actions, i18n and
 * UI primitives are mocked; assertions run against the DOM.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HuduClientTab } from '@ee/components/integrations/hudu/HuduClientTab';
import type { HuduCompanyDataResult } from '@ee/lib/integrations/hudu/huduDataTypes';
import type { HuduArticle, HuduAsset } from '@ee/lib/integrations/hudu/contracts';

const { getHuduClientContextMock, getHuduCompanyAssetsMock, getHuduCompanyArticlesMock } =
  vi.hoisted(() => ({
    getHuduClientContextMock: vi.fn(),
    getHuduCompanyAssetsMock: vi.fn(),
    getHuduCompanyArticlesMock: vi.fn(),
  }));

// Same module as the component's relative import (vitest dedupes by resolved id).
vi.mock('@ee/lib/actions/integrations/huduDataActions', () => ({
  getHuduClientContext: getHuduClientContextMock,
  getHuduCompanyAssets: getHuduCompanyAssetsMock,
  getHuduCompanyArticles: getHuduCompanyArticlesMock,
}));

// F223: the Assets section delegates to the mapping manager (tested in
// huduAssetMappingManager.component.test); the tab test only checks placement.
vi.mock('@ee/components/integrations/hudu/HuduAssetMappingManager', () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="hudu-asset-mapping-manager" data-client-id={clientId} />
  ),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable identity: the component memoizes callbacks on `t`.
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

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <div id={id} role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const COMPANY_URL = 'https://docs.example.com/companies/101';

function okAssets(): HuduCompanyDataResult<HuduAsset> {
  return {
    state: 'ok',
    items: [
      {
        id: 1,
        company_id: 101,
        name: 'DC-01',
        asset_type: 'Server',
        asset_layout_id: 3,
        primary_serial: 'SN-123',
        url: '/a/1',
        hudu_url: 'https://docs.example.com/a/1',
      },
      {
        id: 2,
        company_id: 101,
        name: 'FW-01',
        asset_type: 'Firewall',
        asset_layout_id: 4,
        primary_serial: null,
        url: null,
        hudu_url: null,
      },
    ],
    count: 2,
    huduCompanyId: '101',
    companyUrl: COMPANY_URL,
    fetchedAt: '2026-06-09T00:00:00.000Z',
    fromCache: false,
  };
}

function okArticles(): HuduCompanyDataResult<HuduArticle> {
  return {
    state: 'ok',
    items: [
      {
        id: 7,
        company_id: 101,
        name: 'Onboarding Runbook',
        folder_id: 3,
        url: '/kba/7',
        hudu_url: 'https://docs.example.com/kba/7',
      },
    ],
    count: 1,
    huduCompanyId: '101',
    companyUrl: COMPANY_URL,
    fetchedAt: '2026-06-09T00:00:00.000Z',
    fromCache: false,
  };
}

async function renderTab() {
  render(<HuduClientTab clientId={CLIENT_ID} />);
  await waitFor(() => {
    expect(document.getElementById('hudu-client-tab-loading')).toBeNull();
  });
}

beforeEach(() => {
  getHuduClientContextMock.mockReset();
  getHuduCompanyAssetsMock.mockReset();
  getHuduCompanyArticlesMock.mockReset();
  getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: true });
  getHuduCompanyAssetsMock.mockResolvedValue(okAssets());
  getHuduCompanyArticlesMock.mockResolvedValue(okArticles());
});

describe('HuduClientTab', () => {
  describe('T070: component guard (connected + mapped)', () => {
    it('shows the not-connected state and fetches nothing when Hudu is not connected', async () => {
      getHuduClientContextMock.mockResolvedValue({ connected: false, mapped: false });

      await renderTab();

      expect(document.getElementById('hudu-client-tab-not-connected')?.textContent).toContain(
        'Hudu is not connected'
      );
      expect(document.getElementById('hudu-client-tab-unmapped')).toBeNull();
      expect(document.getElementById('hudu-client-tab-assets')).toBeNull();
      expect(getHuduCompanyAssetsMock).not.toHaveBeenCalled();
      expect(getHuduCompanyArticlesMock).not.toHaveBeenCalled();
    });

    it('shows the unmapped state and fetches nothing when the client is not mapped', async () => {
      getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: false });

      await renderTab();

      expect(document.getElementById('hudu-client-tab-unmapped')?.textContent).toContain(
        'not mapped to a Hudu company'
      );
      expect(document.getElementById('hudu-client-tab-not-connected')).toBeNull();
      expect(getHuduCompanyAssetsMock).not.toHaveBeenCalled();
      expect(getHuduCompanyArticlesMock).not.toHaveBeenCalled();
    });

    it('renders both sections when connected and mapped', async () => {
      await renderTab();

      expect(document.getElementById('hudu-client-tab-assets')).toBeTruthy();
      expect(document.getElementById('hudu-client-tab-articles')).toBeTruthy();
      expect(document.getElementById('hudu-client-tab-not-connected')).toBeNull();
      expect(document.getElementById('hudu-client-tab-unmapped')).toBeNull();
      expect(getHuduCompanyAssetsMock).toHaveBeenCalledWith(CLIENT_ID, { refresh: false });
      expect(getHuduCompanyArticlesMock).toHaveBeenCalledWith(CLIENT_ID, { refresh: false });
    });
  });

  describe('T071: assets and articles sections', () => {
    it('renders the asset mapping manager (F223) inside the assets section', async () => {
      await renderTab();

      const manager = screen.getByTestId('hudu-asset-mapping-manager');
      expect(manager.getAttribute('data-client-id')).toBe(CLIENT_ID);
      expect(document.getElementById('hudu-client-tab-assets')?.contains(manager)).toBe(true);
      expect(document.getElementById('hudu-client-tab-assets-error')).toBeNull();
    });

    it('renders article rows with count, folder and deep-links', async () => {
      await renderTab();

      expect(document.getElementById('hudu-client-tab-articles-count')?.textContent).toBe('1');

      const link = document.getElementById('hudu-client-tab-articles-link-7') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('https://docs.example.com/kba/7');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.textContent).toContain('Onboarding Runbook');
      expect(document.getElementById('hudu-client-tab-articles')?.textContent).toContain('Folder #3');
    });

    it('still renders the manager for an ok-but-empty asset list (it owns the empty state)', async () => {
      getHuduCompanyAssetsMock.mockResolvedValue({ ...okAssets(), items: [], count: 0 });

      await renderTab();

      expect(screen.getByTestId('hudu-asset-mapping-manager')).toBeTruthy();
      // Articles still render normally.
      expect(document.getElementById('hudu-client-tab-articles-count')?.textContent).toBe('1');
    });
  });

  describe('F074: Refresh', () => {
    it('re-runs both fetches with refresh: true', async () => {
      await renderTab();
      expect(getHuduClientContextMock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(getHuduCompanyAssetsMock).toHaveBeenCalledWith(CLIENT_ID, { refresh: true });
      });
      expect(getHuduCompanyArticlesMock).toHaveBeenCalledWith(CLIENT_ID, { refresh: true });
      expect(getHuduClientContextMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('T073: distinct empty/error states', () => {
    it('unreachable: section fetch errors render the unreachable alert per section', async () => {
      getHuduCompanyAssetsMock.mockResolvedValue({ state: 'error', error: 'HTTP 503', errorKind: 'server_error' });
      getHuduCompanyArticlesMock.mockResolvedValue({ state: 'error', error: 'HTTP 503', errorKind: 'server_error' });

      await renderTab();

      expect(document.getElementById('hudu-client-tab-assets-error')?.textContent).toContain(
        'Hudu could not be reached'
      );
      expect(document.getElementById('hudu-client-tab-articles-error')?.textContent).toContain(
        'Hudu could not be reached'
      );
      // The mapping manager only renders for an ok asset fetch.
      expect(screen.queryByTestId('hudu-asset-mapping-manager')).toBeNull();
      expect(document.getElementById('hudu-client-tab-not-connected')).toBeNull();
      expect(document.getElementById('hudu-client-tab-unmapped')).toBeNull();
    });

    it('unreachable: a failed gating probe renders the tab-level error state', async () => {
      getHuduClientContextMock.mockRejectedValue(new Error('network down'));

      await renderTab();

      expect(document.getElementById('hudu-client-tab-error')?.textContent).toContain(
        'Hudu could not be reached'
      );
      expect(document.getElementById('hudu-client-tab-not-connected')).toBeNull();
      expect(document.getElementById('hudu-client-tab-unmapped')).toBeNull();
      expect(document.getElementById('hudu-client-tab-assets')).toBeNull();
    });

    it('a mid-session unmap (fetch-level unmapped) renders the unmapped state', async () => {
      getHuduCompanyAssetsMock.mockResolvedValue({ state: 'unmapped' });
      getHuduCompanyArticlesMock.mockResolvedValue({ state: 'unmapped' });

      await renderTab();

      expect(document.getElementById('hudu-client-tab-unmapped')).toBeTruthy();
      expect(document.getElementById('hudu-client-tab-assets')).toBeNull();
    });
  });

  describe('T074: Hudu source attribution', () => {
    it('shows "Source: Hudu" with a new-tab link out to the company in Hudu', async () => {
      await renderTab();

      expect(document.getElementById('hudu-client-tab-attribution')?.textContent).toContain(
        'Source: Hudu'
      );
      const link = document.getElementById('hudu-client-tab-attribution-link') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(COMPANY_URL);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.textContent).toContain('Open in Hudu');
    });

    it('keeps the attribution visible (without a link) in empty/error states', async () => {
      getHuduClientContextMock.mockResolvedValue({ connected: false, mapped: false });

      await renderTab();

      expect(document.getElementById('hudu-client-tab-attribution')?.textContent).toContain(
        'Source: Hudu'
      );
      expect(document.getElementById('hudu-client-tab-attribution-link')).toBeNull();
    });
  });
});
