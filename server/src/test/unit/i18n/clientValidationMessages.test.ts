import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_VALIDATION_MESSAGES_EN } from '@alga-psa/validation';

/**
 * The web reads `clients.validation.*` from its locale file and mobile reads the
 * same keys from the validation package. Both must say the same thing.
 */
describe('client validation messages', () => {
  it('match between the validation package and the web common locale', () => {
    const common = JSON.parse(readFileSync(resolve(__dirname, '../../../../public/locales/en/common.json'), 'utf8'));
    expect(common.clients.validation).toEqual(CLIENT_VALIDATION_MESSAGES_EN);
  });
});
