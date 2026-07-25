import { describe, expect, it } from 'vitest';
import {
  ENTRA_CONTACT_EFFECT_KEYS,
  ENTRA_SCOPE_DISCLOSURES,
  buildEntraChangeRecord,
  deriveEntraSetupSteps,
  selectEntraSurfaceMode,
} from '@ee/components/settings/integrations/entra/entraSetupModel';
import { ENTRA_DIRECT_DELEGATED_SCOPES } from '@ee/lib/integrations/entra/auth/directScopes';

describe('deriveEntraSetupSteps', () => {
  const stateOf = (steps: ReturnType<typeof deriveEntraSetupSteps>) =>
    steps.map((step) => `${step.id}:${step.state}`);

  it('puts a fresh tenant on connect with everything after it locked', () => {
    expect(
      stateOf(
        deriveEntraSetupSteps({
          isConnected: false,
          hasDiscovery: false,
          hasConfirmedMappings: false,
        })
      )
    ).toEqual(['connect:current', 'discover:locked', 'map:locked', 'sync:locked']);
  });

  it('advances one step at a time as the work behind each is done', () => {
    expect(
      stateOf(
        deriveEntraSetupSteps({ isConnected: true, hasDiscovery: false, hasConfirmedMappings: false })
      )
    ).toEqual(['connect:complete', 'discover:current', 'map:locked', 'sync:locked']);

    expect(
      stateOf(
        deriveEntraSetupSteps({ isConnected: true, hasDiscovery: true, hasConfirmedMappings: false })
      )
    ).toEqual(['connect:complete', 'discover:complete', 'map:current', 'sync:locked']);

    expect(
      stateOf(
        deriveEntraSetupSteps({ isConnected: true, hasDiscovery: true, hasConfirmedMappings: true })
      )
    ).toEqual(['connect:complete', 'discover:complete', 'map:complete', 'sync:current']);
  });

  it('does not skip ahead when later work exists but the connection is gone', () => {
    // A disconnected tenant with old discovery data still has to reconnect first;
    // the ladder must not present discovery as the next thing to do.
    expect(
      stateOf(
        deriveEntraSetupSteps({ isConnected: false, hasDiscovery: true, hasConfirmedMappings: true })
      )
    ).toEqual(['connect:current', 'discover:locked', 'map:locked', 'sync:locked']);
  });
});

describe('selectEntraSurfaceMode', () => {
  it('keeps setup until one real sync has completed', () => {
    expect(selectEntraSurfaceMode({ hasCompletedFirstSync: false })).toBe('setup');
    expect(selectEntraSurfaceMode({ hasCompletedFirstSync: undefined })).toBe('setup');
    expect(selectEntraSurfaceMode({ hasCompletedFirstSync: null })).toBe('setup');
  });

  it('switches to the console once a sync has completed', () => {
    expect(selectEntraSurfaceMode({ hasCompletedFirstSync: true })).toBe('console');
  });
});

describe('disclosure content', () => {
  it('discloses exactly the scopes the OAuth request asks for', () => {
    expect(ENTRA_SCOPE_DISCLOSURES.map((entry) => entry.scope)).toEqual([
      ...ENTRA_DIRECT_DELEGATED_SCOPES,
    ]);
  });

  it('gives every disclosed scope a plain-English gloss key', () => {
    for (const entry of ENTRA_SCOPE_DISCLOSURES) {
      expect(entry.glossKey).not.toBe('integrations.entra.setup.disclosure.scopes.unknown');
    }
  });

  it('states the contact contract, including that nothing is deleted', () => {
    expect(ENTRA_CONTACT_EFFECT_KEYS).toContain(
      'integrations.entra.setup.disclosure.contacts.deletion'
    );
    expect(ENTRA_CONTACT_EFFECT_KEYS).toHaveLength(4);
  });
});

describe('buildEntraChangeRecord', () => {
  it('produces pasteable text carrying every scope and effect', () => {
    const record = buildEntraChangeRecord({
      heading: 'Change record',
      generatedAtLine: 'Prepared 2026-07-25',
      scopesHeading: 'Permissions requested',
      scopes: [
        { scope: 'https://graph.microsoft.com/User.Read', gloss: 'Reads your own profile.' },
        { scope: 'offline_access', gloss: 'Keeps the connection working.' },
      ],
      contactsHeading: 'What happens to your contacts',
      contactEffects: ['Matched by email.', 'Nothing is ever deleted.'],
    });

    expect(record).toBe(
      [
        'Change record',
        'Prepared 2026-07-25',
        '',
        'Permissions requested',
        '- https://graph.microsoft.com/User.Read: Reads your own profile.',
        '- offline_access: Keeps the connection working.',
        '',
        'What happens to your contacts',
        '- Matched by email.',
        '- Nothing is ever deleted.',
      ].join('\n')
    );
  });
});
