import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const migration = readFileSync(
  path.resolve(__dirname, '../../../../migrations/20260309183000_drop_contacts_phone_number_column.cjs'),
  'utf8'
);

describe('contact phone number cutover migration contract', () => {
  it('T037: migration B drops contacts.phone_number and restores it on down', () => {
    expect(migration).toContain("hasColumn('contacts', 'phone_number')");
    expect(migration).toContain("table.dropColumn('phone_number')");
    expect(migration).toContain("table.text('phone_number')");
  });
});
