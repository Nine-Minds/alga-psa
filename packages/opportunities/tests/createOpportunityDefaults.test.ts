import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultTypeForLifecycle } from '../src/components/dialogs/CreateOpportunityDialog';

function source(relative: string) {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

describe('create dialog deal-type default', () => {
  it('only calls a prospect a new logo', () => {
    expect(defaultTypeForLifecycle('prospect')).toBe('new_logo');
    expect(defaultTypeForLifecycle(undefined)).toBe('new_logo');
    expect(defaultTypeForLifecycle(null)).toBe('new_logo');
  });

  it('treats an existing or former client as expansion', () => {
    expect(defaultTypeForLifecycle('active')).toBe('expansion');
    expect(defaultTypeForLifecycle('former')).toBe('expansion');
  });
});

describe('create dialog quick capture', () => {
  const dialog = source('../src/components/dialogs/CreateOpportunityDialog.tsx');

  it('requires only client and title, and names what is missing', () => {
    expect(dialog).toContain("const valid = missing.length === 0;");
    expect(dialog).toContain('id="opportunity-create-missing"');
    expect(dialog).toContain("t('opportunities.createDialog.missing'");
  });

  it('pre-fills the first action and its due date instead of demanding them', () => {
    expect(dialog).toContain('const defaultNextAction = t(suggested.key, suggested.fallback);');
    expect(dialog).toContain('useState<Date | undefined>(() => defaultDueDate())');
  });

  it('offers the dollar estimate in the same form', () => {
    expect(dialog).toContain('id="opportunity-create-mrr"');
    expect(dialog).toContain('id="opportunity-create-nrr"');
    expect(dialog).toContain('id="opportunity-create-hardware"');
  });
});
