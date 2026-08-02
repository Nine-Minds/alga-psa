import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'onboardingActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('transaction-owned onboarding progress persistence contract', () => {
  it.each([
    ['tenant details', 'export const saveClientInfo', 'export const addTeamMembers', 'progressData'],
    ['team members', 'export const addTeamMembers', 'export const createClient', '{'],
    ['billing', 'export const setupBilling', 'export const configureTicketing', '{'],
    ['ticketing', 'export const configureTicketing', 'export const validateOnboardingDefaults', '{'],
  ])('%s uses its active transaction for progress writes', (_name, startMarker, endMarker, progressArgument) => {
    const section = sectionBetween(startMarker, endMarker);

    expect(section).toContain(`await persistTenantOnboardingProgress(trx, tenant, ${progressArgument}`);
    expect(section).not.toContain('await saveTenantOnboardingProgress(');
  });
});
