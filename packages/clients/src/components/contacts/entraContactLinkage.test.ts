import { describe, expect, it } from 'vitest';
import {
  findOverwritingEntraRule,
  readEntraContactLinkage,
  readEntraInactiveReason,
} from './entraContactLinkage';

const linkedContact = (overrides: Record<string, unknown> = {}) => ({
  contact_name_id: 'contact-1',
  full_name: 'Ada Lovelace',
  is_inactive: false,
  entra_sync_source: 'entra_sync',
  entra_object_id: 'entra-object-1',
  entra_user_principal_name: 'ada@contoso.com',
  last_entra_sync_at: '2026-07-25T10:00:00.000Z',
  entra_account_enabled: true,
  entra_sync_status: 'active',
  entra_sync_status_reason: null,
  ...overrides,
});

describe('readEntraContactLinkage', () => {
  it('reads the provenance the sync has been writing all along', () => {
    expect(readEntraContactLinkage(linkedContact())).toEqual({
      isLinked: true,
      userPrincipalName: 'ada@contoso.com',
      lastSyncedAt: '2026-07-25T10:00:00.000Z',
      accountEnabled: true,
      syncStatus: 'active',
      syncStatusReason: null,
    });
  });

  it('reports no linkage for an ordinary contact', () => {
    expect(readEntraContactLinkage({ contact_name_id: 'c', full_name: 'Manual Contact' }).isLinked)
      .toBe(false);
    expect(readEntraContactLinkage(null).isLinked).toBe(false);
    expect(readEntraContactLinkage(undefined).isLinked).toBe(false);
  });

  it('treats blank strings as absent rather than as a link', () => {
    expect(readEntraContactLinkage({ entra_sync_source: '   ' }).isLinked).toBe(false);
    expect(readEntraContactLinkage({ entra_object_id: 'entra-1' }).isLinked).toBe(true);
  });
});

describe('readEntraInactiveReason', () => {
  it('names the cause instead of leaving "Inactive" unexplained', () => {
    expect(
      readEntraInactiveReason(
        linkedContact({ is_inactive: true, entra_sync_status_reason: 'disabled_upstream' })
      )
    ).toBe('disabled_upstream');

    expect(
      readEntraInactiveReason(
        linkedContact({ is_inactive: true, entra_sync_status_reason: 'deleted_upstream' })
      )
    ).toBe('deleted_upstream');
  });

  it('falls back to the account state for rows written before the reason column was used', () => {
    expect(
      readEntraInactiveReason(
        linkedContact({ is_inactive: true, entra_sync_status_reason: null, entra_account_enabled: false })
      )
    ).toBe('disabled_upstream');
  });

  it('claims nothing when the contact was deactivated by a person', () => {
    // An operator marking a contact inactive is not Entra's doing, and saying it
    // was would send someone to fix a Microsoft account that is perfectly fine.
    expect(
      readEntraInactiveReason(
        linkedContact({ is_inactive: true, entra_sync_status_reason: null, entra_account_enabled: true })
      )
    ).toBeNull();
    expect(readEntraInactiveReason(linkedContact({ is_inactive: false }))).toBeNull();
    expect(readEntraInactiveReason({ is_inactive: true })).toBeNull();
  });
});

describe('findOverwritingEntraRule', () => {
  it('warns only about fields an enabled rule actually syncs', () => {
    const contact = linkedContact();

    expect(
      findOverwritingEntraRule({ contact, field: 'full_name', fieldSyncConfig: { displayName: true } })
    ).toBe('displayName');
    expect(
      findOverwritingEntraRule({ contact, field: 'phone_numbers', fieldSyncConfig: { phone: true } })
    ).toBe('phone');
    expect(
      findOverwritingEntraRule({ contact, field: 'full_name', fieldSyncConfig: { displayName: false } })
    ).toBeNull();
    expect(
      findOverwritingEntraRule({ contact, field: 'notes', fieldSyncConfig: { displayName: true } })
    ).toBeNull();
  });

  it('says nothing on a contact no directory maintains', () => {
    expect(
      findOverwritingEntraRule({
        contact: { full_name: 'Manual Contact' },
        field: 'full_name',
        fieldSyncConfig: { displayName: true },
      })
    ).toBeNull();
  });

  it('says nothing when the rules could not be loaded', () => {
    // A wrong warning is worse than no warning.
    expect(
      findOverwritingEntraRule({ contact: linkedContact(), field: 'full_name', fieldSyncConfig: null })
    ).toBeNull();
  });
});
