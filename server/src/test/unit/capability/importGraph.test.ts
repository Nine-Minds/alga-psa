import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, closure, importGraphParseCount } from './importGraph';

const WORKER = 'services/email-service/src/index.ts';
const PURE = 'packages/core/src/lib/capability.ts';

describe('import graph closure', () => {
  it('parses each on-disk file once across entries, so overlapping worker graphs are not re-walked', () => {
    const before = importGraphParseCount();
    const first = closure(WORKER);
    const afterFirst = importGraphParseCount();
    expect(afterFirst - before).toBeLessThanOrEqual(first.files.size);

    const again = closure(WORKER);
    expect(importGraphParseCount()).toBe(afterFirst);
    expect([...again.files].sort()).toEqual([...first.files].sort());
    expect([...again.bare].sort()).toEqual([...first.bare].sort());

    // A second entry only parses the files the first did not already reach.
    const second = closure(PURE);
    const fresh = [...second.files].filter((f) => !first.files.has(f)).length;
    expect(importGraphParseCount() - afterFirst).toBeLessThanOrEqual(fresh);
  });

  it('honours a source override after the file is cached, without caching the override', () => {
    const target = join(REPO, WORKER);
    expect(closure(WORKER).bare.has('next/headers')).toBe(false);

    const real = readFileSync(target, 'utf8');
    const overridden = closure(WORKER, (f) => (f === target ? `import 'next/headers';\n${real}` : undefined));
    expect(overridden.bare.has('next/headers')).toBe(true);
    expect(overridden.via.get('next/headers')).toBe(target);

    expect(closure(WORKER).bare.has('next/headers')).toBe(false);
  });
});
