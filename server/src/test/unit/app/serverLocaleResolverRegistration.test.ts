import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The root layout must register the server locale resolver.
 *
 * `getServerLocale()` reaches the user → client → tenant hierarchy only through
 * a resolver held in a module-level variable. Steps 2–4 of its own chain are
 * gated on caller-supplied `options` that no route passes, so with no resolver
 * the whole DB hierarchy is skipped and every server-rendered string falls back
 * to the browser's Accept-Language.
 *
 * `instrumentation.ts` registers it too, but Next compiles that entry into a
 * different webpack layer than server rendering, so the copy of the singleton
 * it sets is invisible to RSC. The root layout is the registration that counts:
 * it is in every route's module graph and in the right layer.
 *
 * This is asserted against the source rather than at runtime because neither
 * level can see it. Vitest has a single module registry, so a unit test would
 * always find the resolver registered; and an unauthenticated end-to-end
 * request cannot tell the difference either, because with the resolver dead the
 * chain still lands on Accept-Language and renders the same locale. Only an
 * authenticated request whose stored preference disagrees with its browser
 * header distinguishes the two.
 */

const repoRoot = path.resolve(process.cwd(), '..');
const ROOT_LAYOUT = 'server/src/app/layout.tsx';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('server locale resolver registration', () => {
  const layout = read(ROOT_LAYOUT);

  it('registers the hierarchical resolver from the root layout', () => {
    expect(layout).toMatch(/registerServerLocaleResolver\(\s*\(\)\s*=>\s*getHierarchicalLocaleAction\(\)\s*\)/);
  });

  it('registers at module scope, not inside a component or generateMetadata', () => {
    // Metadata for a nested route can resolve before the root layout component
    // body ever runs, so the call has to happen at import time.
    const callIndex = layout.indexOf('registerServerLocaleResolver(');
    expect(callIndex).toBeGreaterThan(-1);

    // Module scope means the call sits at column 0 of its line.
    const lineStart = layout.lastIndexOf('\n', callIndex) + 1;
    expect(layout.slice(lineStart, callIndex)).toBe('');
  });

  it('imports the resolver and the action it registers', () => {
    expect(layout).toContain('registerServerLocaleResolver');
    expect(layout).toMatch(/import \{[^}]*getHierarchicalLocaleAction[^}]*\} from/);
  });

  it('keeps getServerLocale driving the html lang attribute', () => {
    // The same resolution feeds screen-reader pronunciation and CSS :lang();
    // a hardcoded lang would mask a broken resolver in any visual check.
    expect(layout).toMatch(/<html\s+lang=\{locale\}/);
  });
});
