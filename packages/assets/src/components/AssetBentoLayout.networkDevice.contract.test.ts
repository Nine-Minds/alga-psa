import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, 'AssetBentoLayout.tsx'), 'utf8');
const localesDir = resolve(__dirname, '../../../../server/public/locales');

function lookup(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    tree,
  );
}

describe('AssetBentoLayout network device details', () => {
  it('renders network device details when the asset has no workstation or server extension', () => {
    expect(source).toMatch(/const networkDevice = asset\.network_device;/);
    expect(source).toMatch(/\) : networkDevice \? \(\s*<div id="asset-bento-network-device"/);
    expect(source).toMatch(/assetDetails\.deviceTypes\.\$\{networkDevice\.device_type\}/);
  });

  it('only uses translation keys that exist in every locale', () => {
    const keys = [
      'assetForm.fields.deviceType',
      'assetDetails.fields.managementIp',
      'assetDetails.fields.portCount',
      'assetDetails.fields.firmwareVersion',
      'assetDetails.fields.powerDraw',
      'assetDetails.fields.poeSupport',
      'common.yes',
      'common.no',
      ...['switch', 'router', 'firewall', 'access_point', 'load_balancer'].map((type) => `assetDetails.deviceTypes.${type}`),
    ];

    for (const locale of readdirSync(localesDir)) {
      const messages = JSON.parse(readFileSync(resolve(localesDir, locale, 'msp/assets.json'), 'utf8'));
      for (const key of keys) {
        expect(typeof lookup(messages, key), `${locale}: ${key}`).toBe('string');
      }
    }
  });
});
