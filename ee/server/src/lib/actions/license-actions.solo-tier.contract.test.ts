/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, './license-actions.ts'), 'utf8');

describe('license-actions solo tier contract', () => {
  it('routes Solo -> Pro upgrades through upgradeTierAction', () => {
    expect(source).toContain("export async function upgradeTierAction(");
    expect(source).toContain("targetTier: 'pro' | 'premium'");
    expect(source).toContain('return await stripeService.upgradeTier(session.user.tenant, targetTier, interval);');
  });

  it('wraps StripeService.downgradeTier in downgradeTierAction', () => {
    expect(source).toContain('export async function downgradeTierAction(');
    expect(source).toContain('return await stripeService.downgradeTier(session.user.tenant, interval);');
  });

  it('starts Solo -> Pro trials through startSoloProTrialAction', () => {
    expect(source).toContain('export async function startSoloProTrialAction()');
    expect(source).toContain('return await stripeService.startSoloProTrial(session.user.tenant);');
  });
});
