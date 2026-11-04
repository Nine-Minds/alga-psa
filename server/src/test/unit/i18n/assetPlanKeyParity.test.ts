import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T089 / T117 / T146 / T153: key parity for the strings this plan added.
 *
 * `tools/i18n` already proves every locale has English's keys (see
 * localeQualityGates.test.ts). This pins the specific keys, so a string added
 * to `en` and forgotten elsewhere fails here with the key name rather than as
 * a count in an audit summary.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy'];

function read(locale: string, namespace: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'server/public/locales', locale, 'msp', `${namespace}.json`), 'utf8')
  );
}

function dig(root: any, dotted: string): any {
  return dotted.split('.').reduce((node, key) => (node == null ? node : node[key]), root);
}

/** Every leaf key under the English subtree, so new keys are picked up free. */
function leafKeys(node: any, prefix = ''): string[] {
  if (node == null || typeof node !== 'object') return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key)
  );
}

const SUBTREES: Array<{ namespace: string; subtree: string; label: string }> = [
  // T117 — group strings on the MSP side.
  { namespace: 'assets', subtree: 'assetGroups', label: 'T117 asset groups' },
  // T117/T153 — the drawer rows, including the new Group row.
  { namespace: 'assets', subtree: 'assetDetailDrawer.info', label: 'T117 asset drawer info' },
  // T089 — RMM signed-in user matching.
  { namespace: 'integrations', subtree: 'integrations.rmm.signedInUsers', label: 'T089 signed-in users' },
  { namespace: 'integrations', subtree: 'integrations.rmm.peopleMode', label: 'T089 people mode' },
  { namespace: 'integrations', subtree: 'integrations.rmm.clientChange', label: 'F094 client change' },
  { namespace: 'integrations', subtree: 'integrations.rmm.billingProfile', label: 'F090 mapping billing profile' },
];

describe('asset plan locale key parity', () => {
  it.each(SUBTREES)('$label has the same keys in every locale', ({ namespace, subtree }) => {
    const english = dig(read('en', namespace), subtree);
    expect(english, `en is missing ${namespace}:${subtree}`).toBeTruthy();
    const expected = leafKeys(english).sort();
    expect(expected.length).toBeGreaterThan(0);

    for (const locale of LOCALES) {
      const node = dig(read(locale, namespace), subtree);
      expect(node, `${locale} is missing ${namespace}:${subtree}`).toBeTruthy();
      expect(leafKeys(node).sort(), `${locale} key drift in ${namespace}:${subtree}`).toEqual(expected);
    }
  });

  it('T146: the merge dialog billing-strategy strings exist in every locale', () => {
    const keys = [
      'mergeClients.billingStrategyHeading',
      'mergeClients.billingStrategySource',
      'mergeClients.billingStrategyTarget',
      'mergeClients.billingStrategyHelp',
    ];
    for (const locale of LOCALES) {
      const clients = read(locale, 'clients');
      for (const key of keys) {
        expect(typeof dig(clients, key), `${locale} missing ${key}`).toBe('string');
      }
    }
  });

  it('T153: the mobile en locale keys are the ones the screen reads', () => {
    const mobile = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'ee/mobile/src/i18n/locales/en/assets.json'), 'utf8')
    );
    expect(leafKeys(mobile.identity).sort()).toEqual(
      expect.arrayContaining([
        'assignedTo', 'bundle', 'manufacturer', 'model', 'sharedWorkspace', 'unassigned', 'vendor',
      ])
    );
  });
});
