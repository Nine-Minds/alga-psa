import { describe, expect, it } from 'vitest';
import { buildCoManagedPortableWorkspaceManifest as build, validateCoManagedPortableWorkspaceManifest as validate, PORTABLE_BASE_EXCLUSIONS }
  from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { createPortableContributorRegistry } from '../../../../../packages/co-managed/src/portableContributorRegistry';
import { collectPortableWorkspace, portableCanonicalJson } from '../../../../../packages/co-managed/src/portableWorkspaceGraph';

const TENANT = '11111111-1111-4111-8111-111111111111', PACKAGE = '22222222-2222-4222-8222-222222222222';
const FILE = `file:33333333-3333-4333-8333-333333333333`;
const context = { packageId: PACKAGE, sourceTenant: TENANT, capturedAt: '2026-01-01T00:00:00.000Z' };
const ctx = { db: {} as any, actor: { kind: 'session', tenant: TENANT, userId: 'u', sessionId: 's' } as any, packageId: PACKAGE, snapshot: { capturedAt: context.capturedAt } };
const registry = () => createPortableContributorRegistry([{
  id: 'stub', version: 1, reason: 'test', columns: { things: ['thing_id', 'owner_id'] },
  references: [['things', 'owner_id', 'users', 'user_id']],
  export: async () => ({ records: { things: [{ thing_id: 't2', owner_id: 'u' }, { thing_id: 't1', owner_id: 'u' }] } }),
  retain: async () => ({ records: { things: [] } }), validate: () => {},
}]);
const file = { id: FILE, size: 3, sha256: 'a'.repeat(64), path: '/unused', contributor: 'stub' };

async function manifest(vault: any = null, files = [file]) {
  const reg = registry(), collected = await collectPortableWorkspace(reg, ctx);
  return build({ context, collected: { sections: collected.sections, edges: collected.edges, files }, registry: reg, credentialVault: vault });
}

describe('portable workspace manifest', () => {
  it('round-trips through JSON and validates against its registry', async () => {
    const built = await manifest();
    const again = JSON.parse(JSON.stringify(built));
    expect(validate(again, context, [file], registry())).toEqual(built);
  });
  it('is byte-identical for the same data (no timestamps beyond the declared capture context)', async () => {
    const [a, b] = [await manifest(), await manifest()];
    expect(portableCanonicalJson(a)).toBe(portableCanonicalJson(b));
    expect(JSON.stringify(a.sections.map(s => s.sha256))).toBe(JSON.stringify(b.sections.map(s => s.sha256)));
    // Same records captured later: only the context may differ, never a section digest.
    const later = build({ context: { ...context, capturedAt: '2027-01-01T00:00:00.000Z' }, registry: registry(),
      collected: { ...(await collectPortableWorkspace(registry(), ctx)), files: [file] } });
    expect(later.sections.map(s => s.sha256)).toEqual(a.sections.map(s => s.sha256));
  });
  it('records every base exclusion and an explicit vault exclusion when no vault is present', async () => {
    const built = await manifest();
    const names = built.exclusions.map(e => e.name);
    for (const e of PORTABLE_BASE_EXCLUSIONS) expect(names).toContain(e.name);
    expect(built.exclusions.find(e => e.name === 'credential_vault')).toMatchObject({ class: 'secret' });
    // No base entry defers a domain: time, schedule, meetings, conversations and documents are delivered by their contributors.
    expect(new Set(built.exclusions.map(e => e.class))).toEqual(new Set(['msp_private', 'commercial', 'secret']));
    expect(PORTABLE_BASE_EXCLUSIONS.some(e => e.class === 'deferred_domain')).toBe(false);
    expect(built.credentialVault).toBeNull();
  });
  it('carries the edge to an undelivered domain as external', async () => {
    expect((await manifest()).references).toEqual([expect.objectContaining({ parent: 'users', status: 'external' })]);
  });
  it('rejects tampered records, mixed packages, hidden fields and file mismatches', async () => {
    const built = JSON.parse(JSON.stringify(await manifest()));
    const edit = (fn: (m: any) => void) => { const m = structuredClone(built); fn(m); return m; };
    expect(() => validate(edit(m => { m.sections[0].records.things[0].owner_id = 'other'; }), context, [file], registry())).toThrow('Invalid portable workspace manifest');
    expect(() => validate(built, { ...context, packageId: '44444444-4444-4444-8444-444444444444' })).toThrow();
    expect(() => validate(edit(m => { m.extra = 1; }))).toThrow();
    expect(() => validate(built, context, [{ ...file, size: 4 }])).toThrow();
    expect(() => validate(built, context, [])).toThrow();
    expect(() => validate(edit(m => { m.sections[0].records.things[0].tenant = 'x'; m.sections[0].columns.things.push('tenant'); }))).toThrow();
    expect(() => validate(edit(m => { m.exclusions = m.exclusions.filter((e: any) => e.name !== 'credential_vault'); }))).toThrow();
  });
  it('refuses a section from a tenant other than the declared source tenant', async () => {
    const reg = createPortableContributorRegistry([{ ...registry().list()[0], columns: { things: ['thing_id', 'owner_id', 'tenant'] },
      export: async () => ({ records: { things: [{ thing_id: 't', owner_id: 'u', tenant: '99999999-9999-4999-8999-999999999999' }] } }) }]);
    const collected = await collectPortableWorkspace(reg, ctx);
    expect(() => build({ context, collected: { ...collected, files: [] }, registry: reg })).toThrow('Invalid portable workspace manifest');
  });
  it('accepts only an opaque, parameter-recorded vault envelope and never plaintext secret fields', async () => {
    const b64 = (n: number) => Buffer.alloc(n, 1).toString('base64');
    const vault = { vault: { format: 'alga-credential-vault:scrypt-aes-256-gcm:v1', kdf: { name: 'scrypt', N: 131072, r: 8, p: 1, keyBytes: 32, cipher: 'aes-256-gcm' },
      packageId: PACKAGE, sourceTenant: TENANT, salt: b64(16), iv: b64(12), tag: b64(16), ciphertext: b64(40) }, credentials: [], grants: [], associations: [] };
    expect((await manifest(vault)).credentialVault).toEqual(vault);
    await expect(manifest({ ...vault, vault: { ...vault.vault, kdf: { ...vault.vault.kdf, N: 2 } } })).rejects.toThrow();
    await expect(manifest({ ...vault, credentials: [{ password_ciphertext: 'x' }] })).rejects.toThrow();
  });
});
