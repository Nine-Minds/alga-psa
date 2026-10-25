/**
 * T038 (F096): static edition-boundary guard. CE code must not reference the
 * service_principals table, X-Alga-Act-As, the 'service' key purpose or the
 * service-principal entitlement. Logic lives in scripts/guard-service-principals-boundary.mjs.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs script without type declarations
import * as guard from '../../../../../scripts/guard-service-principals-boundary.mjs';

const REPO_ROOT = resolve(__dirname, '../../../../..');

describe('T038: service-principal edition-boundary guard', () => {
  it('passes on the tree as it stands', () => {
    const violations = guard.findViolations(guard.collectRepoFiles(REPO_ROOT));
    expect(guard.formatViolations(violations)).toBe('');
  });

  it.each([
    ['service_principals table', 'await knex("service_principals").select()'],
    ['X-Alga-Act-As header', "const h = req.headers.get('x-alga-act-as');"],
    ['X-Alga-Act-As header', "headers['X-Alga-Act-As'] = id;"],
    ["'service' key purpose", "if (record.purpose === 'service') return;"],
    ["'service' key purpose", "type Purpose = 'general' | 'mobile' | 'service'; // key purpose"],
    ["'service' key purpose", 'const apiKeyPurpose = "service";'],
    ['service-principal entitlement', 'import { SERVICE_PRINCIPAL_ENTITLEMENT } from "./x";'],
    ['service-principal entitlement', 'select service_principal_limit from tenants'],
  ])('catches a violation outside the allowed trees: %s', (pattern, content) => {
    const violations = guard.findViolations([{ path: 'server/src/lib/foo.ts', content }]);
    expect(violations.map((v: { pattern: string }) => v.pattern)).toContain(pattern);
  });

  it('allows the same references inside ee/, packages/product-service-principals/ and packages/ee/', () => {
    const content = "knex('service_principals'); 'X-Alga-Act-As'; purpose: 'service'; SERVICE_PRINCIPAL_ENTITLEMENT";
    for (const path of [
      'ee/server/src/lib/service-principals/service.ts',
      'ee/docs/plans/2026-10-18-service-principals/PRD.md',
      'packages/product-service-principals/ee/entry.ts',
      'packages/ee/src/components/service-principals/ViaPrincipalLabel.tsx',
    ]) {
      expect(guard.findViolations([{ path, content }])).toEqual([]);
    }
  });

  it('does not flag the edition-neutral names the plan allows in CE', () => {
    const content = [
      "export const SERVICE_PRINCIPALS = 'SERVICE_PRINCIPALS' as TIER_FEATURES;",
      "[TIER_FEATURES.SERVICE_PRINCIPALS]: 'pro',",
      "export const USER_TYPES = ['internal', 'client', 'service'] as const;",
      'principal: { userId, userType, kind },',
      'viaPrincipalUserId?: string | null;',
      'withViaPrincipal(ctx, row);',
      "const purpose = 'general';",
    ].join('\n');
    expect(guard.findViolations([{ path: 'packages/types/src/constants/tierFeatures.ts', content }])).toEqual([]);
  });
});
