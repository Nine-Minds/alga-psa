import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const disambiguationGuideSource = readFileSync(
  new URL('../../clients/src/components/clients/ClientContractLineDisambiguationGuide.tsx', import.meta.url),
  'utf8'
);

describe('Multi-active disambiguation copy wiring', () => {
  it('T031: copy does not promise hidden most-recent-assignment fallback behavior', () => {
    expect(disambiguationGuideSource).not.toContain('most recently created contract line');
    expect(disambiguationGuideSource).not.toContain('the system will use');
    expect(disambiguationGuideSource).toContain('ambiguity error that requires user choice');
    expect(disambiguationGuideSource).toContain('Explicit Assignment Required');
  });
});
