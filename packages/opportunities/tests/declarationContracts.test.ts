import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tenantDeletionOrder } from '../../db/src/lib/tenantTableManifest';
import { TENANT_TABLE_FOREIGN_KEYS } from '../../db/src/lib/tenantTableForeignKeys';
import { tenantTableMetadata } from '../../db/src/lib/tenantTableMetadata';

// alga-2026-0002932 contract checks: the new strings exist in every locale, the new tenant
// table is registered wherever opportunity_evidence is, and the generated API artifacts
// carry the new endpoint.

const root = path.resolve(__dirname, '../../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const DECLARE_KEYS = [
  'editTitle', 'noteLabel', 'notePlaceholder', 'sourcesLabel', 'groupInteractions', 'groupDocuments', 'removeSource',
  'sourcesLoading', 'addSource', 'noSourcesAvailable', 'save', 'editEvidence', 'addEvidence', 'sourceHelp',
  'title', 'submit', 'source', 'sourceRemoved', 'interactionFallback', 'documentFallback',
];

describe('declaration locale strings', () => {
  const locales = fs.readdirSync(path.join(root, 'server/public/locales'))
    .filter((entry) => fs.existsSync(path.join(root, 'server/public/locales', entry, 'msp/opportunities.json')));

  it('covers every real and pseudo locale', () => {
    expect(locales.sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy']);
  });

  it.each(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy'])('%s has the dialog, rung and toast strings', (locale) => {
    const file = JSON.parse(read('server/public/locales', locale, 'msp/opportunities.json'));
    for (const key of DECLARE_KEYS) expect(file.opportunities.declare[key], `${locale} declare.${key}`).toBeTruthy();
    expect(file.opportunities.toast.evidenceSaved, `${locale} toast.evidenceSaved`).toBeTruthy();
    // Retired by the sources list: the single-source picker's labels.
    expect(file.opportunities.declare.sourceLabel).toBeUndefined();
    expect(file.opportunities.declare.noSource).toBeUndefined();
  });
});

describe('opportunity_evidence_citations registration', () => {
  it('is deleted before opportunity_evidence in the manifest order', () => {
    const order = tenantDeletionOrder();
    expect(order).toContain('opportunity_evidence_citations');
    expect(order.indexOf('opportunity_evidence_citations')).toBeLessThan(order.indexOf('opportunity_evidence'));
  });

  it('is deleted before opportunity_evidence in tenant deletion', () => {
    const source = read('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
    expect(source.indexOf("'opportunity_evidence_citations'")).toBeGreaterThan(-1);
    expect(source.indexOf("'opportunity_evidence_citations'")).toBeLessThan(source.indexOf("'opportunity_evidence'"));
  });

  it('has its tenant scope and foreign keys registered', () => {
    expect(tenantTableMetadata.opportunity_evidence_citations).toEqual({ scope: 'tenant' });
    expect(TENANT_TABLE_FOREIGN_KEYS).toEqual(expect.arrayContaining([
      expect.objectContaining({ child: 'opportunity_evidence_citations', parent: 'opportunity_evidence', column: 'evidence_id', deleteRule: 'CASCADE' }),
      expect.objectContaining({ child: 'opportunity_evidence_citations', parent: 'tenants' }),
    ]));
    expect(read('server/migrations/utils/tenantDb.cjs')).toContain('opportunity_evidence_citations');
  });
});

describe('generated API artifacts', () => {
  it('carry the declarations endpoint', () => {
    for (const file of ['sdk/docs/openapi/alga-openapi.ce.json', 'sdk/docs/openapi/alga-openapi.ee.json']) {
      const spec = JSON.parse(read(file));
      expect(spec.paths['/api/v1/opportunities/{id}/declarations/{checkpoint}']?.put, file).toBeDefined();
      const evidenceBody = JSON.stringify(spec.paths['/api/v1/opportunities/{id}/evidence'].post);
      expect(evidenceBody, file).toContain('citations');
    }
    expect(read('server/src/lib/mcp/registry.generated.ts')).toContain('/api/v1/opportunities/{id}/declarations/{checkpoint}');
    expect(read('ee/server/src/chat/registry/apiRegistry.generated.ts')).toContain('/api/v1/opportunities/{id}/declarations/{checkpoint}');
  });
});
