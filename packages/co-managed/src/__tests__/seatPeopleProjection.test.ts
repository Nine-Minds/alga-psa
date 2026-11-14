import { describe, expect, it } from 'vitest';
import {
  SEAT_PEOPLE_FIELD_MASK, coManagedSeatPeopleProjector, maskSeatPerson, projectSeatPeople, type ProjectedPersonKind,
} from '../seatPeopleProjection';

const everything = {
  userId: 'u1', contactId: 'c1', clientId: 'x', displayName: ' Sam Staff ', firstName: 'Sam', lastName: 'Staff',
  username: 'sam.login', email: 'sam@msp.test', phone: '+1-555-0100',
};

describe('seat people field mask', () => {
  it('releases MSP staff by name only', () => {
    expect([...SEAT_PEOPLE_FIELD_MASK.msp_staff].sort()).toEqual(['displayName', 'firstName', 'lastName']);
    const person = JSON.parse(JSON.stringify(maskSeatPerson('msp_staff', everything)));
    expect(person).toEqual({ kind: 'msp_staff', userId: 'u1', contactId: null, displayName: 'Sam Staff', firstName: 'Sam', lastName: 'Staff' });
    for (const key of ['email', 'phone', 'username', 'clientId']) expect(person).not.toHaveProperty(key);
  });

  it('never releases a phone number for any kind', () => {
    for (const kind of Object.keys(SEAT_PEOPLE_FIELD_MASK) as ProjectedPersonKind[]) {
      expect(SEAT_PEOPLE_FIELD_MASK[kind]).not.toContain('phone');
      expect(maskSeatPerson(kind, everything)).not.toHaveProperty('phone');
    }
  });

  it('gives technicians and contacts the email a colleague needs, and contacts their client', () => {
    expect(maskSeatPerson('client_technician', everything)).toMatchObject({ kind: 'client_technician', email: 'sam@msp.test', username: 'sam.login' });
    const contact = maskSeatPerson('contact', everything);
    expect(contact).toMatchObject({ kind: 'contact', contactId: 'c1', clientId: 'x', email: 'sam@msp.test' });
    expect(contact).not.toHaveProperty('username');
  });

  it('applies the mask it is given, so a narrower mask releases less', () => {
    const narrow = { ...SEAT_PEOPLE_FIELD_MASK, client_technician: ['displayName'] as const };
    expect(maskSeatPerson('client_technician', everything, narrow)).not.toHaveProperty('email');
  });

  it('a subject with no scope sees nobody, without touching the database', async () => {
    expect(await projectSeatPeople(null as never, 'tenant', null)).toEqual([]);
  });

  it('claims only seat subjects', () => {
    expect(coManagedSeatPeopleProjector.appliesTo({ resolverFacts: undefined } as never)).toBe(false);
  });
});
