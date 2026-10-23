import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Client components must not runtime-import server-only template modules: that drags knex/pg into the
// Turbopack client bundle ("Can't resolve 'fs'") and 500s the template routes (alga-2026-0002502).
const src = path.resolve(__dirname, '../../..');
const clientFiles = [
  'components/templates/TicketTemplateEditor.tsx',
  'components/templates/TicketTemplatesPage.tsx',
  'components/templates/useTicketTemplatePermissions.ts',
  'components/QuickAddTicket.tsx',
  '../../msp-composition/src/tickets/MspTicketTemplates.tsx',
];

/** Module specifiers of runtime (non type-only) imports/exports-from. */
function runtimeImports(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[4] !== undefined) {
      if (m[2]) continue;
      // `import { type A, type B } from` is erased only when every specifier is type-only.
      const clause = m[3].trim();
      const named = clause.match(/^\{([^}]*)\}$/);
      if (named) {
        const specs = named[1].split(',').map((s) => s.trim()).filter(Boolean);
        if (specs.length > 0 && specs.every((s) => s.startsWith('type '))) continue;
      }
      out.push(m[4]);
    } else out.push(m[5] ?? m[6]);
  }
  return out;
}

const forbidden = /(^|\/)lib\/ticketTemplates$|(^|\/)lib\/ticketDuplicate$|^\.\/ticketTemplates$|^\.\/ticketDuplicate$|^@alga-psa\/db(\/|$)|^knex$|^pg$/;

describe('client bundle guard', () => {
  it.each(clientFiles)('%s has no runtime import of server-only template modules', (file) => {
    const specs = runtimeImports(readFileSync(path.resolve(src, file), 'utf8'));
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((s) => forbidden.test(s))).toEqual([]);
  });

  it('ticketTemplateSchema.ts imports only zod and the token module (plus type-only imports)', () => {
    const specs = runtimeImports(readFileSync(path.resolve(src, 'lib/ticketTemplateSchema.ts'), 'utf8'));
    expect(specs).toEqual(['zod', './ticketTitleTokens']);
  });

  it('ticketTitleTokens.ts has no runtime imports, so the client bundle can use it', () => {
    const specs = runtimeImports(readFileSync(path.resolve(src, 'lib/ticketTitleTokens.ts'), 'utf8'));
    expect(specs).toEqual([]);
  });
});
