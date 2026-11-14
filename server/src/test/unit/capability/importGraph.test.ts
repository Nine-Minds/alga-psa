import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REPO, closure } from './importGraph';

const parses = vi.hoisted(() => ({ count: 0 }));
const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:fs', async (importOriginal) => {
  const real = (await importOriginal()) as typeof import('node:fs');
  const readFileSync: typeof real.readFileSync = ((...args: Parameters<typeof real.readFileSync>) => {
    reads.count += 1;
    return real.readFileSync(...args);
  }) as typeof real.readFileSync;
  return { ...real, default: { ...real, readFileSync }, readFileSync };
});
vi.mock('typescript', async (importOriginal) => {
  const real = ((await importOriginal()) as { default: typeof import('typescript') }).default;
  const createSourceFile: typeof real.createSourceFile = (...args) => {
    parses.count += 1;
    return real.createSourceFile(...args);
  };
  return { default: { ...real, createSourceFile } };
});

const ENTRY = 'services/email-service/src/index.ts';

describe('importGraph closure', () => {
  it('parses each file once across closures, so repeated whole-graph walks stay cheap', () => {
    const first = closure(ENTRY);
    expect(parses.count).toBeGreaterThan(0);
    const before = parses.count;
    const second = closure(ENTRY);
    expect(parses.count).toBe(before);
    expect([...second.files]).toEqual([...first.files]);
    expect([...second.bare]).toEqual([...first.bare]);
  });

  it('a repeated walk reads nothing from disk: the cache hit is the parse, not a verifying re-read', () => {
    closure(ENTRY);
    const before = reads.count;
    closure(ENTRY);
    expect(reads.count).toBe(before);
  });

  it('an injected source still overrides a cached parse, and the real source is honoured again afterwards', () => {
    const target = join(REPO, ENTRY);
    const real = readFileSync(target, 'utf8');
    expect(closure(ENTRY).bare.has('next/headers')).toBe(false);
    expect(closure(ENTRY, (f) => (f === target ? `import 'next/headers';\n${real}` : undefined)).bare.has('next/headers')).toBe(true);
    expect(closure(ENTRY).bare.has('next/headers')).toBe(false);
  });
});
