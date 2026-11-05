import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'notificationActions.ts'), 'utf8');

/**
 * Template and settings writes feed real outbound mail, so no entry point here
 * may be reachable without a session or trust a tenant the caller names.
 */
const SETTINGS_ACTIONS = [
  'getNotificationSettingsAction',
  'updateNotificationSettingsAction',
  'getTemplatesAction',
  'createTenantTemplateAction',
  'cloneSystemTemplateAction',
  'updateTenantTemplateAction',
  'deactivateTenantTemplateAction',
] as const;

const MUTATIONS = [
  'updateNotificationSettingsAction',
  'createTenantTemplateAction',
  'cloneSystemTemplateAction',
  'updateTenantTemplateAction',
  'deactivateTenantTemplateAction',
] as const;

const READS = ['getNotificationSettingsAction', 'getTemplatesAction'] as const;

function actionBody(name: string): string {
  const start = source.indexOf(`export const ${name} = withAuth(`);
  expect(start, `${name} is not a withAuth-wrapped export`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const end = rest.indexOf('\n});');
  return rest.slice(0, end === -1 ? undefined : end);
}

/** Just the parameter list, up to the return-type annotation. */
function actionSignature(name: string): string {
  const marker = 'withAuth(async (';
  const params = actionBody(name).split(marker)[1] ?? '';
  const end = params.search(/\)\s*(:|=>)/);
  return end === -1 ? params : params.slice(0, end);
}

describe('notification actions auth boundary contract', () => {
  it('exports every action as a withAuth-wrapped const', () => {
    const wrapped = [...source.matchAll(/export const (\w+) = withAuth\(/g)].map((match) => match[1]);
    for (const action of SETTINGS_ACTIONS) {
      expect(wrapped).toContain(action);
    }

    // A plain exported async function in a "use server" module is an
    // unauthenticated endpoint; every export must go through withAuth.
    expect(source).not.toMatch(/^export async function /m);
    expect(source).not.toMatch(/^export function /m);
  });

  it('never accepts a tenant parameter from the caller', () => {
    for (const action of SETTINGS_ACTIONS) {
      const signature = actionSignature(action);
      expect(signature, `${action} must take its tenant from the auth context`).not.toMatch(/\btenant\s*:\s*string/);
      expect(signature).toContain('{ tenant }');
    }

    expect(source).not.toMatch(/export const \w+ = withAuth\(async \(\s*\w+,\s*\{ tenant \},\s*tenant/);
  });

  it('gates every mutation on settings:update inside a transaction', () => {
    expect(source).toContain("hasPermission(user, 'settings', 'update', trx)");
    expect(source).toContain("throw new Error('Permission denied: Cannot update settings')");

    for (const action of MUTATIONS) {
      expect(actionBody(action)).toContain('requireSettingsUpdate(user, trx)');
    }
  });

  it('gates every read on settings:read inside a transaction', () => {
    expect(source).toContain("hasPermission(user, 'settings', 'read', trx)");
    expect(source).toContain("throw new Error('Permission denied: Cannot read settings')");

    for (const action of READS) {
      expect(actionBody(action)).toContain('requireSettingsRead(user, trx)');
    }
  });

  it('keeps the NotificationActionError return convention on the clone action', () => {
    expect(actionBody('cloneSystemTemplateAction')).toContain('notificationActionErrorFrom(error)');
  });
});
