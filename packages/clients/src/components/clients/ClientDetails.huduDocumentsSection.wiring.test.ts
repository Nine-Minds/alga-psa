import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientDetailsSource = readFileSync(
  new URL('./ClientDetails.tsx', import.meta.url),
  'utf8'
);

describe('ClientDetails Hudu documents section wiring', () => {
  it('T238: the Hudu Documentation section renders in the documents tab only behind huduClientTab.visible', () => {
    expect(clientDetailsSource).toContain(
      "import HuduClientDocumentsSection from './HuduClientDocumentsSection';"
    );
    // Same gate as the Hudu tab (F229) — no separate probe.
    expect(clientDetailsSource).toContain(
      '{huduClientTab.visible && (\n              <HuduClientDocumentsSection clientId={client.client_id} />\n            )}'
    );
    // The gated render lives inside the documents tab content, after the native documents block.
    const documentsTab = clientDetailsSource.slice(
      clientDetailsSource.indexOf("id: 'documents'"),
      clientDetailsSource.indexOf("id: 'tax-settings'")
    );
    expect(documentsTab).toContain('renderDocuments({');
    expect(documentsTab.indexOf('<HuduClientDocumentsSection')).toBeGreaterThan(
      documentsTab.indexOf('renderDocuments({')
    );
    // Exactly one render site, and none outside the gate.
    expect(clientDetailsSource.split('<HuduClientDocumentsSection').length).toBe(2);
  });
});
