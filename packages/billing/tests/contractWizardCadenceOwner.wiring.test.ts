import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract wizard cadence_owner wiring', () => {
  it('T106: client wizard actions thread cadence_owner through live-line writes and compatibility reads', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/actions/contractWizardActions.ts'),
      'utf8'
    );

    expect(source.match(/cadence_owner: submission\.cadence_owner \?\? 'client'/g)?.length).toBe(4);
    expect(source).toContain("let cadenceOwner: CadenceOwner = 'client';");
    expect(source).toContain('cadenceOwner = line.cadence_owner ?? cadenceOwner;');
    expect(source).toContain('cadence_owner: cadenceOwner,');
  });
});
