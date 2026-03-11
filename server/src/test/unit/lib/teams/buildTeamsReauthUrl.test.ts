import { describe, expect, it } from 'vitest';
import { buildTeamsReauthPath, buildTeamsReauthUrl } from '../../../../../../ee/server/src/lib/teams/buildTeamsReauthUrl';

describe('buildTeamsReauthUrl', () => {
  it('builds a Teams-safe reauthentication redirect that preserves the callback destination', () => {
    expect(buildTeamsReauthPath('/teams/tab?context=%7B%7D')).toBe(
      '/auth/msp/signin?callbackUrl=%2Fteams%2Ftab%3Fcontext%3D%257B%257D&teamsReauth=1'
    );

    expect(buildTeamsReauthUrl('https://example.com', '/api/teams/auth/callback/bot?tenantId=tenant-1').toString()).toBe(
      'https://example.com/auth/msp/signin?callbackUrl=%2Fapi%2Fteams%2Fauth%2Fcallback%2Fbot%3FtenantId%3Dtenant-1&teamsReauth=1'
    );
  });
});
