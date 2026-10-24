import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The workflow worker imports '@alga-psa/tenancy/lib/tenantPortalUrl' and the
// Temporal autopay worker reaches it through billing's invoicePaymentUrls. Its
// module graph must stay free of @alga-psa/auth, next/* and React, otherwise
// services/workflow-worker's validate-runtime-imports build step fails.
const ENTRY = path.resolve(__dirname, 'tenantPortalUrl.ts');
const FORBIDDEN = /^(@alga-psa\/auth(\/|$)|next(\/|$)|react(\/|-dom(\/|$)|$))/;

function resolveLocal(from: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function collectGraph(entry: string): { files: Set<string>; specifiers: Array<{ file: string; specifier: string }> } {
  const files = new Set<string>();
  const specifiers: Array<{ file: string; specifier: string }> = [];
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = fs.readFileSync(file, 'utf8');
    const pattern = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      specifiers.push({ file, specifier });
      if (specifier.startsWith('.')) {
        const resolved = resolveLocal(file, specifier);
        if (resolved) visit(resolved);
      }
    }
  };
  visit(entry);
  return { files, specifiers };
}

describe('tenantPortalUrl module graph', () => {
  it('reaches the worker-safe portal domain store', () => {
    const { files } = collectGraph(ENTRY);
    expect([...files].some((f) => f.endsWith(path.join('lib', 'PortalDomainStore.ts')))).toBe(true);
    expect([...files].some((f) => f.endsWith(path.join('lib', 'PortalDomainModel.ts')))).toBe(false);
  });

  it('has no @alga-psa/auth, next/* or React imports', () => {
    const { specifiers } = collectGraph(ENTRY);
    const offenders = specifiers.filter(({ specifier }) => FORBIDDEN.test(specifier));
    expect(offenders).toEqual([]);
  });
});
