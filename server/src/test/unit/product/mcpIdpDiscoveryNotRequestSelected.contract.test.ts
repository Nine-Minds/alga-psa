import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CF007 — "no URL/request-selected issuer".
 *
 * `resolveIdpFromPreset` accepts a `discoveryBaseUrl` seam so tests can point
 * discovery at a mock IdP. Whatever URL that seam receives decides which host
 * gets to name the trusted issuer for an agent IdP, so it must stay
 * server-controlled: reachable from a test, never from a request body.
 *
 * Today it is safe by OMISSION — `POST /api/v1/mcp/idp-providers` destructures
 * the body into an explicit field list that does not include it, and passes
 * those fields one by one. That is easy to undo by accident: a single
 * `...body` spread, or adding the key to the destructure, would turn a test
 * seam into an attacker-selected issuer. This pins it.
 *
 * `oidcDiscovery` validates the issuer against the URL independently
 * (mcpOidcDiscoveryHardening.test.ts), so this is the second of two locks, not
 * the only one.
 */

const ROUTE = 'src/app/api/v1/mcp/idp-providers/route.ts';

/** Source with comments stripped, so prose mentioning the field cannot pass or fail this. */
function code(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('MCP trusted-IdP discovery origin is not request-selected', () => {
  it('the route never reads discoveryBaseUrl from the request body', () => {
    expect(code(ROUTE)).not.toContain('discoveryBaseUrl');
  });

  it('the route never spreads the request body into addTrustedIdp', () => {
    // An explicit field list is what keeps unknown keys — including this one —
    // from reaching the resolver.
    const source = code(ROUTE);
    expect(source).toMatch(/addTrustedIdp\(\{/);
    expect(source).not.toMatch(/addTrustedIdp\(\{[^}]*\.\.\.body/);
    expect(source).not.toMatch(/\.\.\.\s*body/);
  });

  it('the seam still exists for tests, so this contract is about reachability not deletion', () => {
    // If the seam is removed the pin above passes vacuously; assert the thing
    // being protected is still there.
    expect(code('../ee/server/src/lib/mcp/idpPresets.ts')).toContain('discoveryBaseUrl');
  });
});
