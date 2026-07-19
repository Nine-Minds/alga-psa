import { afterEach, describe, expect, it } from 'vitest';
import {
  getMicrosoftAuthorizeUrl,
  getMicrosoftGraphBaseUrl,
  getMicrosoftTokenUrl,
} from '@alga-psa/shared/services/email/microsoftGraphEndpoints';

const originalGraphBaseUrl = process.env.MICROSOFT_GRAPH_BASE_URL;
const originalLoginBaseUrl = process.env.MICROSOFT_LOGIN_BASE_URL;

afterEach(() => {
  if (originalGraphBaseUrl === undefined) delete process.env.MICROSOFT_GRAPH_BASE_URL;
  else process.env.MICROSOFT_GRAPH_BASE_URL = originalGraphBaseUrl;
  if (originalLoginBaseUrl === undefined) delete process.env.MICROSOFT_LOGIN_BASE_URL;
  else process.env.MICROSOFT_LOGIN_BASE_URL = originalLoginBaseUrl;
});

describe('Microsoft endpoint overrides', () => {
  it('uses emulator base URLs without trailing slash duplication', () => {
    process.env.MICROSOFT_GRAPH_BASE_URL = 'http://graph-emulator:4010/v1.0/';
    process.env.MICROSOFT_LOGIN_BASE_URL = 'http://graph-emulator:4010/';

    expect(getMicrosoftGraphBaseUrl()).toBe('http://graph-emulator:4010/v1.0');
    expect(getMicrosoftAuthorizeUrl('common')).toBe(
      'http://graph-emulator:4010/common/oauth2/v2.0/authorize'
    );
    expect(getMicrosoftTokenUrl('tenant-id')).toBe(
      'http://graph-emulator:4010/tenant-id/oauth2/v2.0/token'
    );
  });
});
