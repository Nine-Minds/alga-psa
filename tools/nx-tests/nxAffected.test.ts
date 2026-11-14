import { describe, expect, it } from 'vitest';
import { parseTrailingJsonArray, runNx } from './nxTestUtils';

describe('nx affected', () => {
  it('identifies affected projects from a file list', { timeout: 180_000 }, async () => {
    const output = await runNx(['show', 'projects', '--affected', '--files=packages/types/src/index.ts', '--json']);
    const projects = parseTrailingJsonArray(output);

    expect(projects).toContain('@alga-psa/types');
    // Types changes should affect the main app as a downstream consumer.
    expect(projects).toContain('server');
  });

  it('includes @alga-psa/clients when client code changes', { timeout: 180_000 }, async () => {
    const output = await runNx(['show', 'projects', '--affected', '--files=packages/clients/src/schemas/client.schema.ts', '--json']);
    const projects = parseTrailingJsonArray(output);
    expect(projects).toContain('@alga-psa/clients');
  });
});
