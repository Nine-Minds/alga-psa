import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OAUTH_MAPPING_FAILURE_CODES,
  oauthMappingFailureFallbackMessage,
} from './types';

// The sign-in pages fetch their namespace, so the failure message renders from
// this fallback for the first paint. If it drifts from the shipped en copy the
// visitor reads one sentence and then watches it change under them.
function localesDir(): string {
  let dir = process.cwd();
  while (!fs.existsSync(path.join(dir, 'server/public/locales/en'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Unable to locate server/public/locales/en');
    }
    dir = parent;
  }
  return path.join(dir, 'server/public/locales/en');
}

function readMessages(relativePath: string, keyPath: string[]): Record<string, string> {
  const bundle = JSON.parse(
    fs.readFileSync(path.join(localesDir(), relativePath), 'utf8')
  ) as Record<string, unknown>;

  let node: unknown = bundle;
  for (const segment of keyPath) {
    node = (node as Record<string, unknown>)?.[segment];
  }
  return node as Record<string, string>;
}

const PROVIDER_EMAIL = 'nd@computerbutlereurope.onmicrosoft.com';

const AUDIENCES = [
  {
    audience: 'internal' as const,
    messages: readMessages('msp/auth.json', ['signIn', 'alerts', 'ssoNoMatch']),
  },
  {
    audience: 'client' as const,
    messages: readMessages('client-portal.json', ['auth', 'ssoNoMatch']),
  },
];

describe('oauthMappingFailureFallbackMessage', () => {
  for (const { audience, messages } of AUDIENCES) {
    it(`matches the shipped en copy for every ${audience} failure code`, () => {
      for (const code of OAUTH_MAPPING_FAILURE_CODES) {
        const expected = messages[code].replace(/\{\{providerEmail\}\}/g, PROVIDER_EMAIL);
        expect(oauthMappingFailureFallbackMessage(code, audience, PROVIDER_EMAIL)).toBe(expected);
      }
    });

    it(`leaves no interpolation placeholder in ${audience} copy`, () => {
      for (const code of OAUTH_MAPPING_FAILURE_CODES) {
        expect(oauthMappingFailureFallbackMessage(code, audience, PROVIDER_EMAIL)).not.toContain(
          '{{'
        );
      }
    });
  }
});
