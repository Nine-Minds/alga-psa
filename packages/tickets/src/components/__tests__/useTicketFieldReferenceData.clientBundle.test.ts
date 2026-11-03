import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_TEMPLATE_CLIENT_MISMATCH,
  isChecklistTemplateInScopeForClient,
} from '../../../../../shared/lib/ticketChecklists/scope';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8');
const hook = read('../useTicketFieldReferenceData.ts');
// Comments are stripped so the header may legitimately mention the modules it avoids.
const scope = read('../../../../../shared/lib/ticketChecklists/scope.ts')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// Source contract: this 'use client' hook must never reach @alga-psa/db -> knex -> fs
// (Turbopack "Module not found: Can't resolve 'fs'" on every /msp page).
describe('useTicketFieldReferenceData client bundle safety', () => {
  it("is a 'use client' module", () => {
    expect(hook.trimStart().startsWith("'use client'")).toBe(true);
  });

  it('imports the pure /scope subpath, never the ticketChecklists barrel or DB modules', () => {
    expect(hook).toMatch(/['"]@alga-psa\/shared\/lib\/ticketChecklists\/scope['"]/);
    expect(hook).not.toMatch(/['"]@alga-psa\/shared\/lib\/ticketChecklists['"]/);
    expect(hook).not.toMatch(/['"]@alga-psa\/db(\/[^'"]*)?['"]/);
    expect(hook).not.toMatch(/['"]knex['"]/);
    expect(hook).not.toContain('applyTemplates');
  });

  it('scope.ts has no imports at all (no db, knex, ticketActivity)', () => {
    expect(scope).not.toMatch(/^\s*import\s/m);
    expect(scope).not.toMatch(/from\s+['"]/);
    expect(scope).not.toMatch(/@alga-psa\/db|knex|ticketActivity/);
  });

  it('scope predicate behaves', () => {
    expect(isChecklistTemplateInScopeForClient(null, 'c1')).toBe(true);
    expect(isChecklistTemplateInScopeForClient(undefined, null)).toBe(true);
    expect(isChecklistTemplateInScopeForClient('c1', 'c1')).toBe(true);
    expect(isChecklistTemplateInScopeForClient('c1', 'c2')).toBe(false);
    expect(isChecklistTemplateInScopeForClient('c1', null)).toBe(false);
    expect(CHECKLIST_TEMPLATE_CLIENT_MISMATCH).toBe('template-client-mismatch');
  });
});
