import { describe, expect, it } from 'vitest';
import { evaluateCoManagedAccess, type CoManagedAccessFacts, type CoManagedVisibilityMode } from '../policy';

// Personas (L1a vocabulary): MT = assigned technician, MV = assigned viewer, MX = unassigned Oz technician.
const personas = { MT: ['technician'], MV: ['viewer'], MX: [] } as const;
const live = { relationshipState: 'active', ended: false, workspacesAvailable: true, canWrite: true } as const;
const homeAll = { read: true, update: true };

function facts(over: Partial<{ roles: readonly ('viewer' | 'technician')[]; mode: CoManagedVisibilityMode; scope: boolean | null;
  lifecycle: Partial<CoManagedAccessFacts['lifecycle']>; home: { read: boolean; update: boolean } }> = {}): CoManagedAccessFacts {
  return {
    lifecycle: { ...live, ...over.lifecycle },
    staff: { roles: over.roles ?? personas.MT },
    grant: { visibilityMode: over.mode ?? 'board_scope', scope: over.scope === null ? null : { canCollaborate: over.scope ?? true } },
    home: over.home ?? homeAll,
  };
}

describe('access matrix: customer grant ∩ staff assignment ∩ home RBAC ∩ lifecycle', () => {
  it('MT: assigned technician on a Collaborate board can read, write and delegate', () => {
    const d = evaluateCoManagedAccess(facts());
    expect(d).toMatchObject({ read: true, write: true, delegate: true });
    expect(d.deniedBy).toBeUndefined();
  });

  it('MV: assigned viewer can read but not write or delegate', () => {
    expect(evaluateCoManagedAccess(facts({ roles: personas.MV }))).toMatchObject({ read: true, write: false, delegate: false });
  });

  it('MX: an unassigned technician is denied everything, naming the staff layer', () => {
    const d = evaluateCoManagedAccess(facts({ roles: personas.MX }));
    expect(d).toMatchObject({ read: false, write: false, delegate: false });
    expect(d.deniedBy).toEqual({ layer: 'staff', reason: 'no_staff_assignment' });
  });

  it('a View-only board lets even a technician read but not write', () => {
    expect(evaluateCoManagedAccess(facts({ scope: false }))).toMatchObject({ read: true, write: false });
  });

  it('no board grant: denied by the grant layer', () => {
    expect(evaluateCoManagedAccess(facts({ scope: null })).deniedBy).toEqual({ layer: 'grant', reason: 'no_customer_grant' });
  });

  it('escalation_only makes board grants dormant (retained, not deleted) for every persona', () => {
    for (const roles of [personas.MT, personas.MV]) {
      const d = evaluateCoManagedAccess(facts({ roles, mode: 'escalation_only' }));
      expect(d.read).toBe(false);
      expect(d.deniedBy).toEqual({ layer: 'grant', reason: 'grant_dormant_escalation_only' });
    }
    // Switching back re-activates the very same grant: nothing was discarded.
    expect(evaluateCoManagedAccess(facts({ mode: 'board_scope' })).read).toBe(true);
  });

  it('an explicit per-resource grant is live even under escalation_only (L3 hook)', () => {
    const f = facts({ mode: 'escalation_only' });
    f.grant.explicit = { canCollaborate: true };
    expect(evaluateCoManagedAccess(f)).toMatchObject({ read: true, write: true });
  });

  it('home RBAC: read-only home permission reads but cannot write; none cannot read', () => {
    expect(evaluateCoManagedAccess(facts({ home: { read: true, update: false } }))).toMatchObject({ read: true, write: false });
    const none = evaluateCoManagedAccess(facts({ home: { read: false, update: false } }));
    expect(none.read).toBe(false);
    expect(none.deniedBy).toEqual({ layer: 'home', reason: 'home_permission_denied' });
  });

  describe('lifecycle', () => {
    it.each(['provisioning', 'pending_acceptance', 'terminated', 'missing'] as const)('%s relationship is not readable', state => {
      expect(evaluateCoManagedAccess(facts({ lifecycle: { relationshipState: state } })).deniedBy)
        .toEqual({ layer: 'lifecycle', reason: 'relationship_not_active' });
    });
    it('an ended relationship is not readable', () => {
      expect(evaluateCoManagedAccess(facts({ lifecycle: { ended: true } })).read).toBe(false);
    });
    it('an unavailable (suspended / wrong product) workspace is not readable', () => {
      expect(evaluateCoManagedAccess(facts({ lifecycle: { workspacesAvailable: false } })).deniedBy)
        .toEqual({ layer: 'lifecycle', reason: 'workspace_unavailable' });
    });
    it('read-only lifecycle (paused license) keeps reads but refuses writes and delegation', () => {
      expect(evaluateCoManagedAccess(facts({ lifecycle: { canWrite: false } }))).toMatchObject({ read: true, write: false, delegate: false });
    });
  });

  it('exhaustive persona × scope × mode × lifecycle: write implies read; delegate equals write; MX never reads', () => {
    for (const [name, roles] of Object.entries(personas)) for (const scope of [true, false, null] as const)
      for (const mode of ['board_scope', 'escalation_only'] as const) for (const state of ['active', 'terminated'] as const) {
        const d = evaluateCoManagedAccess(facts({ roles, scope, mode, lifecycle: { relationshipState: state } }));
        const expectRead = name !== 'MX' && scope !== null && mode === 'board_scope' && state === 'active';
        expect(d.read, `${name}/${scope}/${mode}/${state}`).toBe(expectRead);
        expect(d.write, `${name}/${scope}/${mode}/${state}`).toBe(expectRead && name === 'MT' && scope === true);
        expect(d.delegate).toBe(d.write);
        if (d.write) expect(d.read).toBe(true);
      }
  });

  describe('revocation takes effect on the very next evaluation (no caching)', () => {
    const base = facts();
    const revocations: Array<[string, (f: CoManagedAccessFacts) => CoManagedAccessFacts]> = [
      ['board scope removed', f => ({ ...f, grant: { ...f.grant, scope: null } })],
      ['staff assignment removed', f => ({ ...f, staff: { roles: [] } })],
      ['home RBAC permission removed', f => ({ ...f, home: { read: false, update: false } })],
      ['lifecycle ended', f => ({ ...f, lifecycle: { ...f.lifecycle, ended: true } })],
    ];
    it.each(revocations)('%s', (_name, revoke) => {
      expect(evaluateCoManagedAccess(base).read).toBe(true);
      expect(evaluateCoManagedAccess(revoke(base)).read).toBe(false);
    });
  });
});
