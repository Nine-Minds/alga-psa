import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HuduDocumentationCard } from './HuduDocumentationCard';

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, any>) => {
      let text = options?.defaultValue || _key;
      for (const [name, value] of Object.entries(options ?? {})) {
        text = text.replace(`{{${name}}}`, String(value));
      }
      return text;
    },
  }),
}));

function baseAsset(attributes: unknown) {
  return {
    asset_id: 'asset-1',
    asset_type: 'workstation',
    client_id: 'client-1',
    asset_tag: 'tag-1',
    name: 'EC-WS-001',
    status: 'active',
    created_at: '2026-06-12T00:00:00Z',
    updated_at: '2026-06-12T00:00:00Z',
    tenant: 'tenant-1',
    attributes,
  } as any;
}

describe('HuduDocumentationCard (T255)', () => {
  it('renders label/value rows in stored order with stable ids and a synced footer', () => {
    const html = renderToStaticMarkup(
      <HuduDocumentationCard
        asset={baseAsset({
          hudu_fields: [
            { label: 'Hostname', value: 'EC-WS-001' },
            { label: 'RAM (GB)', value: 16 },
            { label: 'Notes', value: null },
          ],
          hudu_synced_at: '2026-06-12T10:00:00.000Z',
        })}
      />
    );

    expect(html).toContain('id="hudu-doc-card"');
    expect(html).toContain('Hudu Documentation');
    expect(html).toContain('id="hudu-doc-field-0"');
    expect(html).toContain('id="hudu-doc-field-1"');
    expect(html).toContain('id="hudu-doc-field-2"');
    expect(html.indexOf('Hostname')).toBeLessThan(html.indexOf('RAM (GB)'));
    expect(html.indexOf('RAM (GB)')).toBeLessThan(html.indexOf('Notes'));
    // Values are string-coerced; null renders the N/A state.
    expect(html).toContain('EC-WS-001');
    expect(html).toContain('16');
    expect(html).toContain('N/A');
    expect(html).toContain('Last synced from Hudu');
  });

  it('renders raw date strings as-is and skips the footer without hudu_synced_at', () => {
    const html = renderToStaticMarkup(
      <HuduDocumentationCard
        asset={baseAsset({ hudu_fields: [{ label: 'Warranty Expiry', value: '2027-01-31' }] })}
      />
    );

    expect(html).toContain('2027-01-31');
    expect(html).not.toContain('Last synced from Hudu');
  });

  it('renders nothing when hudu_fields is missing, empty, malformed, or attributes is absent', () => {
    expect(renderToStaticMarkup(<HuduDocumentationCard asset={baseAsset(undefined)} />)).toBe('');
    expect(renderToStaticMarkup(<HuduDocumentationCard asset={baseAsset(null)} />)).toBe('');
    expect(renderToStaticMarkup(<HuduDocumentationCard asset={baseAsset({})} />)).toBe('');
    expect(renderToStaticMarkup(<HuduDocumentationCard asset={baseAsset({ hudu_fields: [] })} />)).toBe('');
    expect(
      renderToStaticMarkup(<HuduDocumentationCard asset={baseAsset({ hudu_fields: 'not-an-array' })} />)
    ).toBe('');
    expect(
      renderToStaticMarkup(<HuduDocumentationCard asset={baseAsset({ hudu_fields: [{ value: 'label-less' }] })} />)
    ).toBe('');
    // Sibling namespaces alone never summon the card.
    expect(
      renderToStaticMarkup(<HuduDocumentationCard asset={baseAsset({ acme_namespace: { keep: true } })} />)
    ).toBe('');
  });
});
