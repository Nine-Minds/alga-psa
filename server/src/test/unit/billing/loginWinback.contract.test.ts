import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('login win-back contract', () => {
  it('T036/T042/T043: inactive login triggers hook before returning null and before verifyPassword', () => {
    const source = read('packages/auth/src/actions/auth.tsx');

    const inactiveGate = source.indexOf('if (user.is_inactive)');
    const hook = source.indexOf('void triggerInactiveLoginWinback(user)');
    const nullReturn = source.indexOf('return null;', hook);
    const verify = source.indexOf('verifyPassword(password, user.hashed_password)');

    expect(inactiveGate).toBeGreaterThan(-1);
    expect(hook).toBeGreaterThan(inactiveGate);
    expect(nullReturn).toBeGreaterThan(hook);
    expect(verify).toBeGreaterThan(nullReturn);
  });

  it('T040/T041/T072: shared auth uses EE injection and CE resolves to a no-op stub', () => {
    const authSource = read('packages/auth/src/actions/auth.tsx');
    const entry = read('packages/auth/src/lib/winback/enterpriseWinbackEntry.ts');
    const ceStub = read('packages/ee/src/lib/auth/loginWinback.ts');

    expect(authSource).toContain('if (!isEnterprise || !user.tenant)');
    expect(entry).toContain("import('@enterprise/lib/auth/loginWinback')");
    expect(entry).toContain('isEnterpriseLoginWinbackHookAvailable');
    expect(ceStub).toContain('isEnterpriseLoginWinbackHookAvailable = false');
  });

  it('T037/T038/T039/T047/T076: EE hook uses one conditional update returning row for the 14-day throttle', () => {
    const source = read('ee/server/src/lib/auth/loginWinback.ts');

    expect(source).toContain('const db = tenantDb(knex, input.tenantId);');
    expect(source).toContain("db.table('pending_tenant_deletions')");
    expect(source).toContain(".whereIn('status', ['pending', 'awaiting_confirmation', 'confirmed'])");
    expect(source).toContain("whereNull('last_winback_email_at')");
    expect(source).toContain("NOW() - INTERVAL '14 days'");
    expect(source).toContain(".update({");
    expect(source).toContain(".returning([");
  });

  it('T059: EE hook resolves the tenant billing/admin email and never sends to the attempter', () => {
    const source = read('ee/server/src/lib/auth/loginWinback.ts');

    expect(source).toContain('resolveReactivationContactEmail(input.tenantId');
    expect(source).toContain('to: adminEmail.email');
    expect(source).not.toContain('attempt');
  });
});
