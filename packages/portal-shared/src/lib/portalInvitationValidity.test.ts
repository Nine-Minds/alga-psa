import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PORTAL_INVITATION_VALIDITY_DAYS,
  MAX_PORTAL_INVITATION_VALIDITY_DAYS,
  MIN_PORTAL_INVITATION_VALIDITY_DAYS,
  clampPortalInvitationValidityDays,
  resolvePortalInvitationValidityDays,
} from './portalInvitationValidity';

describe('portal invitation validity', () => {
  it('gives every tenant a week when nothing has been configured', () => {
    expect(resolvePortalInvitationValidityDays(undefined)).toBe(DEFAULT_PORTAL_INVITATION_VALIDITY_DAYS);
    expect(resolvePortalInvitationValidityDays({})).toBe(7);
    expect(resolvePortalInvitationValidityDays({ clientPortal: {} })).toBe(7);
    expect(resolvePortalInvitationValidityDays({ clientPortal: { invitationValidityDays: null } })).toBe(7);
  });

  it('reads the tenant\'s own validity, from an object or a JSON string', () => {
    expect(resolvePortalInvitationValidityDays({ clientPortal: { invitationValidityDays: 14 } })).toBe(14);
    expect(resolvePortalInvitationValidityDays(
      JSON.stringify({ clientPortal: { invitationValidityDays: 3 } }),
    )).toBe(3);
  });

  it('clamps a value outside the allowed range to the nearest allowed validity', () => {
    expect(resolvePortalInvitationValidityDays({ clientPortal: { invitationValidityDays: 0 } }))
      .toBe(MIN_PORTAL_INVITATION_VALIDITY_DAYS);
    expect(resolvePortalInvitationValidityDays({ clientPortal: { invitationValidityDays: -5 } }))
      .toBe(MIN_PORTAL_INVITATION_VALIDITY_DAYS);
    expect(resolvePortalInvitationValidityDays({ clientPortal: { invitationValidityDays: 365 } }))
      .toBe(MAX_PORTAL_INVITATION_VALIDITY_DAYS);
  });

  it('answers with whole days, and with the default for anything that is not a number', () => {
    expect(clampPortalInvitationValidityDays(7.4)).toBe(7);
    expect(clampPortalInvitationValidityDays('14')).toBe(14);
    expect(resolvePortalInvitationValidityDays({ clientPortal: { invitationValidityDays: 'forever' } })).toBe(7);
    expect(resolvePortalInvitationValidityDays({ clientPortal: { invitationValidityDays: {} } })).toBe(7);
    expect(resolvePortalInvitationValidityDays({ clientPortal: { invitationValidityDays: Number.NaN } })).toBe(7);
    expect(resolvePortalInvitationValidityDays('{not-json')).toBe(7);
    expect(resolvePortalInvitationValidityDays([{ invitationValidityDays: 2 }])).toBe(7);
  });
});
