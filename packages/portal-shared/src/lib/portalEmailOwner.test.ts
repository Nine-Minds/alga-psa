import { describe, expect, it } from 'vitest';
import {
  classifyPortalEmailOwner,
  portalEmailOwnerConflictMessage,
  type PortalEmailOwnerRow,
} from './portalEmailOwner';

const CONTACT = 'contact-being-invited';

const owner = (overrides: Partial<PortalEmailOwnerRow> = {}): PortalEmailOwnerRow => ({
  user_id: 'user-1',
  user_type: 'client',
  contact_id: CONTACT,
  username: 'dorothy@emeraldcity.oz',
  linked_contact_id: CONTACT,
  ...overrides,
});

describe('classifyPortalEmailOwner', () => {
  it('recognizes the portal user already linked to this contact', () => {
    expect(classifyPortalEmailOwner(owner(), CONTACT)).toBe('linked_this_contact');
  });

  it('recognizes a portal user linked to a different live contact', () => {
    const row = owner({ contact_id: 'other-contact', linked_contact_id: 'other-contact' });
    expect(classifyPortalEmailOwner(row, CONTACT)).toBe('linked_other_contact');
  });

  it('treats a client user whose contact row is gone as orphaned', () => {
    // The contact was hard-deleted; users.contact_id still points at the dead id,
    // so the left join produces no contact row.
    const row = owner({ contact_id: 'deleted-contact', linked_contact_id: null });
    expect(classifyPortalEmailOwner(row, CONTACT)).toBe('orphaned');
  });

  it('treats a client user with no contact link as orphaned', () => {
    const row = owner({ contact_id: null, linked_contact_id: null });
    expect(classifyPortalEmailOwner(row, CONTACT)).toBe('orphaned');
  });

  it('never adopts an internal user, even when its contact link is dangling', () => {
    expect(classifyPortalEmailOwner(owner({ user_type: 'internal' }), CONTACT)).toBe('internal');
    expect(
      classifyPortalEmailOwner(
        owner({ user_type: 'internal', contact_id: null, linked_contact_id: null }),
        CONTACT
      )
    ).toBe('internal');
  });

  it('treats an unknown user type as internal rather than adoptable', () => {
    const row = owner({ user_type: null, contact_id: null, linked_contact_id: null });
    expect(classifyPortalEmailOwner(row, CONTACT)).toBe('internal');
  });
});

describe('portalEmailOwnerConflictMessage', () => {
  it('names the actual conflict so the MSP user knows what to fix', () => {
    expect(portalEmailOwnerConflictMessage('internal')).toContain('internal user');
    expect(portalEmailOwnerConflictMessage('linked_other_contact')).toContain('another contact');
  });
});
