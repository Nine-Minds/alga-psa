import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RmmVitalsPanel } from './RmmVitalsPanel';

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('../shared/StatusBadge', () => ({
  StatusBadge: ({ status }: any) => <span>{status}</span>,
}));

vi.mock('@alga-psa/core', () => ({
  formatRelativeDateTime: () => 'moments ago',
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, any>) => options?.defaultValue || _key,
  }),
}));

describe('RmmVitalsPanel', () => {
  it('shows not connected for unmanaged assets with no cached data', () => {
    const html = renderToStaticMarkup(
      <RmmVitalsPanel
        asset={{
          asset_id: 'asset-1',
          asset_type: 'workstation',
          client_id: 'client-1',
          asset_tag: 'tag-1',
          name: 'Unmanaged Device',
          status: 'active',
          created_at: '2026-04-15T00:00:00Z',
          updated_at: '2026-04-15T00:00:00Z',
          tenant: 'tenant-1',
        } as any}
        assetFacts={[]}
        data={null}
        isLoading={false}
        onRefresh={() => undefined}
        isRefreshing={false}
      />
    );

    expect(html).toContain('Not connected to RMM');
  });

  it('treats linked Tanium assets as connected even when cached RMM data is absent', () => {
    const html = renderToStaticMarkup(
      <RmmVitalsPanel
        asset={{
          asset_id: 'asset-1',
          asset_type: 'mobile_device',
          client_id: 'client-1',
          asset_tag: 'tanium:1',
          name: '06:21:32:B6:E3:C2',
          status: 'active',
          created_at: '2026-04-15T00:00:00Z',
          updated_at: '2026-04-15T00:00:00Z',
          tenant: 'tenant-1',
          rmm_provider: 'tanium',
          rmm_device_id: '1',
          agent_status: 'online',
          last_seen_at: '2026-04-15T17:07:13Z',
          last_rmm_sync_at: '2026-04-15T17:08:00Z',
        } as any}
        assetFacts={[]}
        data={null}
        isLoading={false}
        onRefresh={() => undefined}
        isRefreshing={false}
      />
    );

    expect(html).not.toContain('Not connected to RMM');
    expect(html).toContain('online');
    expect(html).toContain('None');
    expect(html).toContain('N/A');
  });

  it('renders Tanium criticality when an available fact exists', () => {
    const html = renderToStaticMarkup(
      <RmmVitalsPanel
        asset={{
          asset_id: 'asset-1',
          asset_type: 'workstation',
          client_id: 'client-1',
          asset_tag: 'tanium:1',
          name: 'Managed Device',
          status: 'active',
          created_at: '2026-04-15T00:00:00Z',
          updated_at: '2026-04-15T00:00:00Z',
          tenant: 'tenant-1',
          rmm_provider: 'tanium',
          rmm_device_id: '1',
          agent_status: 'online',
        } as any}
        assetFacts={[
          {
            asset_fact_id: 'fact-1',
            tenant: 'tenant-1',
            asset_id: 'asset-1',
            source_type: 'integration',
            provider: 'tanium',
            namespace: 'tanium',
            fact_key: 'criticality',
            label: 'Tanium Criticality',
            value_text: 'High',
            value_number: 1.67,
            value_json: {},
            source: 'tanium.gateway.sensor.Endpoint Criticality with Level',
            is_available: true,
            created_at: '2026-04-15T00:00:00Z',
            updated_at: '2026-04-15T00:00:00Z',
          } as any,
        ]}
        data={null}
        isLoading={false}
        onRefresh={() => undefined}
        isRefreshing={false}
      />
    );

    expect(html).toContain('Tanium Criticality');
    expect(html).toContain('High');
  });
});
