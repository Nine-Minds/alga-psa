import { describe, expect, it } from 'vitest';
import {
  INTERACTIVE_USER_TYPES,
  isClientUserType,
  isInteractiveUserType,
  isLicensedUserType,
  isMspPrincipalUserType,
} from './userTypes';

// T007: user-type predicates truth table
describe('T007 user-type predicates', () => {
  const cases: Array<[string | null | undefined, boolean, boolean, boolean, boolean]> = [
    // type,        client, mspPrincipal, interactive, licensed
    ['internal',    false,  true,         true,        true],
    ['client',      true,   false,        true,        false],
    ['service',     false,  true,         false,       false],
    ['admin',       false,  false,        false,       false],
    ['',            false,  false,        false,       false],
    [null,          false,  false,        false,       false],
    [undefined,     false,  false,        false,       false],
  ];

  it.each(cases)('%s', (type, client, msp, interactive, licensed) => {
    expect(isClientUserType(type)).toBe(client);
    expect(isMspPrincipalUserType(type)).toBe(msp);
    expect(isInteractiveUserType(type)).toBe(interactive);
    expect(isLicensedUserType(type)).toBe(licensed);
  });

  it('INTERACTIVE_USER_TYPES is exactly internal | client', () => {
    expect([...INTERACTIVE_USER_TYPES].sort()).toEqual(['client', 'internal']);
  });
});
