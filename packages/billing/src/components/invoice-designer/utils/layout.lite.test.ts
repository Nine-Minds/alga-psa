import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('utils/layout.ts (lightweight-only)', () => {
  it('does not contain legacy geometry/constraint solver helpers', () => {
    const source = fs.readFileSync(path.join(here, 'layout.ts'), 'utf8');

    // High-signal guardrails: keep this module as a tiny mapper/parser, not a geometry engine.
    expect(source.length).toBeLessThan(6_000);
    expect(source.split('\n').length).toBeLessThan(200);

    const forbidden = [
      'constraintSolver',
      'dropParentResolution',
      'getBoundingClientRect',
      'closestCenter',
      'pointerWithin',
      'cassowary',
      'kiwi',
      'solver',
    ];

    forbidden.forEach((needle) => {
      expect(source).not.toContain(needle);
    });
  });
});
