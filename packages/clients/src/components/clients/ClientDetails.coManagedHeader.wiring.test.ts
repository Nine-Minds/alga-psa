// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const clientDetailsSource = read('./ClientDetails.tsx');
const quickViewSource = read('./ClientQuickView.tsx');
const contextSource = readFileSync(
  new URL('../../context/ClientCrossFeatureContext.tsx', import.meta.url),
  'utf8'
);

/** The header's action cluster, from its container to the Entra sync action. */
function headerClusterBody(): string {
  const start = clientDetailsSource.indexOf('<div className="flex items-center gap-2 mr-8" data-print-hide>');
  const end = clientDetailsSource.indexOf('{showEntraSyncAction', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return clientDetailsSource.slice(start, end);
}

describe('client header carries no co-managed status', () => {
  it('ClientDetails header renders nothing from the co-managed slots', () => {
    const header = headerClusterBody();
    expect(header).not.toContain('coManagedSlots');
    expect(clientDetailsSource).not.toMatch(/coManagedSlots\??\.summary/);
    // The integration still supplies the tab.
    expect(clientDetailsSource).toContain('coManagedSlots?.tab');
  });

  it('the slot contract has no summary member', () => {
    const start = contextSource.indexOf('export interface ClientCoManagedSlots');
    const end = contextSource.indexOf('}', start);
    expect(start).toBeGreaterThan(-1);
    const body = contextSource.slice(start, end);
    expect(body).toContain('tab: TabContent');
    expect(body).not.toMatch(/\bsummary\b\s*:/);
  });

  it('quick view does not render the co-managed integration or any slot', () => {
    expect(quickViewSource).not.toContain('renderClientCoManagedIntegration');
    expect(quickViewSource).not.toMatch(/slots\??\.summary/);
  });

  it.each([
    ['ClientDetails.tsx', clientDetailsSource],
    ['ClientQuickView.tsx', quickViewSource],
  ])('%s references no co-managed summary component', (_name, source) => {
    expect(source).not.toMatch(/CoManaged\w*Summary/);
  });
});
