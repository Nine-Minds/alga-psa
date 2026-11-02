import { describe, expect, it } from 'vitest';
import { getRoleAssignmentViolation } from './userTypes';

describe('getRoleAssignmentViolation (F021)', () => {
  const mspRole = { msp: true, client: false };
  const clientRole = { msp: false, client: true };

  it('internal: MSP roles only (unchanged)', () => {
    expect(getRoleAssignmentViolation('internal', mspRole)).toBeNull();
    expect(getRoleAssignmentViolation('internal', clientRole)).toBe('portal_role_on_msp_user');
  });

  it('client: client roles only (unchanged)', () => {
    expect(getRoleAssignmentViolation('client', clientRole)).toBeNull();
    expect(getRoleAssignmentViolation('client', mspRole)).toBe('msp_role_on_portal_user');
  });

  it('service: MSP roles only, never client roles', () => {
    expect(getRoleAssignmentViolation('service', mspRole)).toBeNull();
    expect(getRoleAssignmentViolation('service', clientRole)).toBe('portal_role_on_msp_user');
  });

  it('unknown types are rejected', () => {
    expect(getRoleAssignmentViolation(null, mspRole)).not.toBeNull();
    expect(getRoleAssignmentViolation('bogus', clientRole)).not.toBeNull();
  });
});
