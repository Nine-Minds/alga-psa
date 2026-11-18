import { describe, expect, it } from 'vitest';
import { resolveSystemEmailState, isSystemEmailConfigured } from '../system/systemEmailState';

type Env = Record<string, string | undefined>;

describe('resolveSystemEmailState', () => {
  const cases: Array<[string, Env, ReturnType<typeof resolveSystemEmailState>]> = [
    ['flag unset + resend key', { RESEND_API_KEY: 're_x' }, { state: 'configured', providerType: 'resend' }],
    ['flag empty + resend key', { EMAIL_ENABLE: '', RESEND_API_KEY: 're_x' }, { state: 'configured', providerType: 'resend' }],
    ['flag "true" + resend key', { EMAIL_ENABLE: 'true', RESEND_API_KEY: 're_x' }, { state: 'configured', providerType: 'resend' }],
    ['flag "TRUE" + resend key', { EMAIL_ENABLE: 'TRUE', RESEND_API_KEY: 're_x' }, { state: 'configured', providerType: 'resend' }],
    ['flag "yes" + resend key', { EMAIL_ENABLE: 'yes', RESEND_API_KEY: 're_x' }, { state: 'configured', providerType: 'resend' }],
    ['flag unset + only EMAIL_HOST', { EMAIL_HOST: 'smtp.example.com' }, { state: 'configured', providerType: 'smtp' }],
    ['resend key wins over host when type unset', { RESEND_API_KEY: 're_x', EMAIL_HOST: 'h' }, { state: 'configured', providerType: 'resend' }],
    ['flag "false" + credentials', { EMAIL_ENABLE: 'false', RESEND_API_KEY: 're_x' }, { state: 'disabled' }],
    ['flag " False " + credentials', { EMAIL_ENABLE: ' False ', EMAIL_HOST: 'h' }, { state: 'disabled' }],
    ['flag "false" + nothing', { EMAIL_ENABLE: 'false' }, { state: 'disabled' }],
    ['no credentials, no flag', {}, { state: 'unconfigured' }],
    ['whitespace-only credentials', { RESEND_API_KEY: '  ', EMAIL_HOST: ' ' }, { state: 'unconfigured' }],
    ['EMAIL_PROVIDER_TYPE=resend without key', { EMAIL_PROVIDER_TYPE: 'resend', EMAIL_HOST: 'h' }, { state: 'unconfigured' }],
    ['EMAIL_PROVIDER_TYPE=smtp without host', { EMAIL_PROVIDER_TYPE: 'smtp', RESEND_API_KEY: 're_x' }, { state: 'unconfigured' }],
    ['EMAIL_PROVIDER_TYPE=smtp with host and a resend key', { EMAIL_PROVIDER_TYPE: 'smtp', EMAIL_HOST: 'h', RESEND_API_KEY: 're_x' }, { state: 'configured', providerType: 'smtp' }],
    ['EMAIL_PROVIDER_TYPE=RESEND with key', { EMAIL_PROVIDER_TYPE: 'RESEND', RESEND_API_KEY: 're_x' }, { state: 'configured', providerType: 'resend' }],
  ];

  it.each(cases)('%s', (_name, env, expected) => {
    expect(resolveSystemEmailState(env as NodeJS.ProcessEnv)).toEqual(expected);
  });

  it('reads process.env by default', () => {
    const saved = { ...process.env };
    try {
      delete process.env.EMAIL_ENABLE;
      delete process.env.EMAIL_PROVIDER_TYPE;
      delete process.env.EMAIL_HOST;
      process.env.RESEND_API_KEY = 're_x';
      expect(isSystemEmailConfigured()).toBe(true);
      process.env.EMAIL_ENABLE = 'false';
      expect(isSystemEmailConfigured()).toBe(false);
    } finally {
      process.env = saved;
    }
  });
});
