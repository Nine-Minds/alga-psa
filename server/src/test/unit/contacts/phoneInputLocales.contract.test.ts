import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const locales = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy'];

function readLocale(locale: string, namespace: string): any {
  return JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'server', 'public', 'locales', locale, 'msp', `${namespace}.json`),
    'utf8',
  ));
}

describe('phone input locale coverage', () => {
  it.each(locales)('%s translates the phone extension and international-prefix validation', (locale) => {
    const contacts = readLocale(locale, 'contacts');
    const clients = readLocale(locale, 'clients');
    const profile = readLocale(locale, 'profile');

    expect(contacts.contactPhoneNumbersEditor.fields.extension).toBeTruthy();
    expect(contacts.contactPhoneNumbersEditor.validation.includeCountryCallingCode).toBeTruthy();
    expect(clients.quickAddClient.extension).toBeTruthy();
    expect(clients.clients.locations.form.extension).toBeTruthy();
    expect(profile.profile.fields.phoneExtension.label).toBeTruthy();
  });
});
