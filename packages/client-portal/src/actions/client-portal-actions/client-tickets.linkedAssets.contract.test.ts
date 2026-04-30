import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './client-tickets.ts'),
  'utf8',
);

describe('getClientTicketDetails linked assets contract', () => {
  it('joins asset_associations -> assets and scopes by client_id', () => {
    expect(source).toContain("trx('asset_associations as aa')");
    expect(source).toContain("'aa.entity_type': 'ticket'");
    expect(source).toContain("'a.client_id': visibility.clientId");
  });

  it('returns linkedAssets with name/tag/type fields on the ticket payload', () => {
    expect(source).toMatch(/linkedAssets:\s*result\.linkedAssets/);
    expect(source).toMatch(/'a\.asset_id'/);
    expect(source).toMatch(/'a\.name'/);
    expect(source).toMatch(/'a\.asset_tag'/);
  });
});

const detailsSource = fs.readFileSync(
  path.resolve(__dirname, '../../components/tickets/TicketDetails.tsx'),
  'utf8',
);

describe('TicketDetails renders linked-asset pills', () => {
  it('reads linkedAssets off the ticket and renders Badge pills', () => {
    expect(detailsSource).toMatch(/linkedAssets\?:\s*Array</);
    expect(detailsSource).toContain('ticket-linked-asset-');
  });

  it('opens an inline asset-details dialog when a pill is clicked', () => {
    // Pill is a button, not a deep-link anchor.
    expect(detailsSource).not.toMatch(/href=\{`\/client-portal\/devices\?asset=/);
    expect(detailsSource).toContain('openAssetPreview');
    expect(detailsSource).toContain('getClientAssetById');
    expect(detailsSource).toContain('<AssetDetails');
  });
});
