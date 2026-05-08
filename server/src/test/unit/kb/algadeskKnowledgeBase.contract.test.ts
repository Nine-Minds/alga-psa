import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

function read(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

describe('Algadesk knowledge base composition contracts', () => {
  it('keeps MSP and portal KB page compositions wired', () => {
    const mspPage = read('src/app/msp/knowledge-base/page.tsx');
    const portalPage = read('src/app/client-portal/knowledge-base/page.tsx');

    expect(mspPage).toContain("import { KnowledgeBasePage } from '@alga-psa/documents/components';");
    expect(mspPage).toContain('<KnowledgeBasePage activeTab="articles"');

    expect(portalPage).toContain("import { ClientKBPage, ClientKBArticleView } from '@alga-psa/client-portal/components';");
    expect(portalPage).toContain('<ClientKBPage');
    expect(portalPage).toContain('<ClientKBArticleView');
  });

  it('exposes KB article list/view/create/edit/publish API surfaces', () => {
    const listRoute = read('src/app/api/v1/kb-articles/route.ts');
    const itemRoute = read('src/app/api/v1/kb-articles/[id]/route.ts');
    const publishRoute = read('src/app/api/v1/kb-articles/[id]/publish/route.ts');
    const archiveRoute = read('src/app/api/v1/kb-articles/[id]/archive/route.ts');

    expect(listRoute).toContain('export const GET');
    expect(listRoute).toContain('export const POST');
    expect(itemRoute).toContain('export const GET');
    expect(itemRoute).toContain('export const PUT');
    expect(publishRoute).toContain('export const POST');
    expect(archiveRoute).toContain('export const POST');
  });

  it('does not link KB UI to full document management routes', () => {
    const kbPage = read('../packages/documents/src/components/kb/KnowledgeBasePage.tsx');
    const portalKbPage = read('../packages/client-portal/src/components/kb/ClientKBPage.tsx');

    expect(kbPage).not.toContain('/msp/documents');
    expect(portalKbPage).not.toContain('/client-portal/documents');
  });
});

