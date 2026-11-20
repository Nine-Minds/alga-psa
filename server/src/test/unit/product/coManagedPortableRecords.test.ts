import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validatePortableRecordSection, validatePortableRecordReferences } from '../../../../../packages/co-managed/src/portableRecordValidation';
const userId = randomUUID(), roleId = randomUUID();
const schema = {
  columns: { users: ['id', 'role'], roles: ['id'], workdays: ['user', 'day'], settings: ['name'] },
  identities: { workdays: ['user', 'day'], settings: [] },
  valueTypes: { workdays: { day: 'integer' as const } },
  counts: { settings: { min: 1, max: 1 } },
  references: [['users', 'role', 'roles', 'id'], ['workdays', 'user', 'users', 'id']] as const,
};
const records = () => ({ users: [{ id: userId, role: roleId }], roles: [{ id: roleId }],
  workdays: [{ user: userId, day: 0 }, { user: userId, day: 1 }], settings: [{ name: 'Calendar' }] });
describe('portable record section integrity', () => {
  it('validates composite identities, singleton tables and PostgreSQL UUID casing', () => {
    const input = records(); input.users[0].role = roleId.toUpperCase();
    expect(() => validatePortableRecordSection(input, schema)).not.toThrow();
    input.workdays.push({ user: userId.toUpperCase(), day: 0 });
    expect(() => validatePortableRecordSection(input, schema)).toThrow('Duplicate');
  });
  it('rejects unexpected authentication columns and malformed or incomplete graphs', () => {
    expect(() => validatePortableRecordSection({ ...records(), users: [{ ...records().users[0], hashed_password: 'must not enter restore' }] }, schema)).toThrow('record columns');
    expect(() => validatePortableRecordSection({ ...records(), roles: [] }, schema)).toThrow('reference is missing');
    expect(() => validatePortableRecordSection({ ...records(), settings: [] }, schema)).toThrow('record count');
    expect(() => validatePortableRecordSection({ ...records(), roles: [{ id: 'invalid' }] }, schema)).toThrow('identity');
    expect(() => validatePortableRecordSection({ ...records(), roles: undefined }, schema)).toThrow('count');
    expect(() => validatePortableRecordSection({ ...records(), live_sessions: [] }, schema)).toThrow('tables');
  });
  it('rejects malformed columns even when joined key names resemble the expected set', () => {
    expect(() => validatePortableRecordSection({ users: [{ 'id\0role': userId }], roles: [{ id: roleId }], workdays: [], settings: [{ name: 'Calendar' }] }, schema)).toThrow('columns');
  });
  it('requires declared cross-section parents after assembly and checks their identity', () => {
    const reference = [['users', 'role', 'roles', 'id']] as const;
    const users = { users: [{ id: userId, role: roleId }] };
    expect(() => validatePortableRecordSection(users, { columns: { users: ['id', 'role'] }, references: reference })).not.toThrow();
    expect(() => validatePortableRecordReferences(users, reference)).toThrow('section is missing');
    expect(() => validatePortableRecordReferences({ ...users, roles: [{ id: randomUUID() }] }, reference)).toThrow('reference is missing');
    expect(() => validatePortableRecordReferences({ ...users, roles: [{ id: roleId }] }, reference)).not.toThrow();
  });
  it('supports declared text registry keys without loosening UUID identities', () => {
    const catalog = { columns: { assets: ['id', 'type'], types: ['slug'] },
      valueTypes: { assets: { type: 'text' as const }, types: { slug: 'text' as const } },
      references: [['assets', 'type', 'types', 'slug']] as const };
    const input = { assets: [{ id: userId, type: 'workstation' }], types: [{ slug: 'workstation' }] };
    expect(() => validatePortableRecordSection(input, catalog)).not.toThrow();
    expect(() => validatePortableRecordSection({ ...input, assets: [{ id: 'not-uuid', type: 'workstation' }] }, catalog)).toThrow('identity');
  });
});
