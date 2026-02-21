import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ReviewContractStep.tsx', import.meta.url), 'utf8');

describe('ReviewContractStep renewal preview wiring', () => {
  it('includes renewal mode, notice period, and renewal term preview rows', () => {
    expect(source).toContain('Renewal Mode');
    expect(source).toContain('Notice Period');
    expect(source).toContain('Renewal Term');
  });

  it('gates renewal preview details by mode and available values', () => {
    expect(source).toContain('{data.renewal_mode && (');
    expect(source).toContain("data.renewal_mode && data.renewal_mode !== 'none'");
    expect(source).toContain("data.renewal_mode === 'auto'");
  });
});
