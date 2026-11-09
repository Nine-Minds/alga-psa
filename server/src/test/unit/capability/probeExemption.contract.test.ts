import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { CAPABILITY_KEYS } from '@alga-psa/core/capability/keys';
import { shouldSkipApiKeyAuth } from 'server/src/middleware';
import { CAPABILITY_PROBE_PATHS, CAPABILITY_PROBE_ROOT, capabilityProbePath } from 'server/src/lib/capability/probePaths';
import { REPO } from './importGraph';

/**
 * The API-key exemption for the capability probes and the capability registry must agree exactly, in both
 * directions: every registered key's probe is exempt, and nothing else under /api/v1/capabilities is. The
 * exemption is generated from CAPABILITY_KEYS (lib/capability/probePaths.ts); these checks fail if a probe path
 * is hand-listed in the middleware, if the generator drifts from the registry, or if a static probe route is
 * added beside the generic [key] handler (it would answer for a key the registry does not know).
 */

const MIDDLEWARE = join(REPO, 'server/src/middleware.ts');
const PROBE_ROUTES = join(REPO, 'server/src/app/api/v1/capabilities');

/** Every string/template literal fragment in `source` that names a path under the probe root. */
function probeLiteralsIn(source: string): string[] {
  const sf = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.filter((s) => s.includes(CAPABILITY_PROBE_ROOT));
}

describe('capability probe exemption ⇔ capability registry', () => {
  it('the generator emits exactly each registered key, with and without a trailing slash', () => {
    const expected = CAPABILITY_KEYS.flatMap((k) => [`/api/v1/capabilities/${k}`, `/api/v1/capabilities/${k}/`]);
    expect([...CAPABILITY_PROBE_PATHS].sort()).toEqual(expected.sort());
  });

  it('registry ⊆ exemption: every registered key reaches its probe without an API key', () => {
    for (const key of CAPABILITY_KEYS) {
      expect(shouldSkipApiKeyAuth(capabilityProbePath(key)), key).toBe(true);
      expect(shouldSkipApiKeyAuth(`${capabilityProbePath(key)}/`), key).toBe(true);
    }
  });

  it('exemption ⊆ registry: the middleware hand-lists no probe path', () => {
    expect(probeLiteralsIn(readFileSync(MIDDLEWARE, 'utf8'))).toEqual([]);
  });

  it('exemption ⊆ registry: unregistered keys, lookalikes, the root and deeper paths need an API key', () => {
    const candidates = [
      CAPABILITY_PROBE_ROOT,
      `${CAPABILITY_PROBE_ROOT}/`,
      `${CAPABILITY_PROBE_ROOT}/other`,
      `${CAPABILITY_PROBE_ROOT}/[key]`,
      ...CAPABILITY_KEYS.flatMap((k) => [
        `${capabilityProbePath(k)}/extra`,
        `${capabilityProbePath(k)}-evil`,
        `${capabilityProbePath(k)}//`,
        capabilityProbePath(k).slice(0, -1),
        capabilityProbePath(k).toUpperCase(),
      ]),
    ];
    for (const path of candidates) expect(shouldSkipApiKeyAuth(path), path).toBe(false);
  });

  it('the only probe route is the generic [key] handler (no static route can answer for an unregistered key)', () => {
    const entries = readdirSync(PROBE_ROUTES, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    expect(entries).toEqual(['[key]/']);
  });

  it('negative fixture: a hand-listed or template-built probe in middleware source is caught', () => {
    expect(
      probeLiteralsIn(
        "const exactApiKeySkipPaths = ['/api/v1/capabilities/co-managed', `/api/v1/capabilities/${k}/`, ...CAPABILITY_PROBE_PATHS];",
      ),
    ).toEqual(['/api/v1/capabilities/co-managed', '/api/v1/capabilities/']);
  });
});
