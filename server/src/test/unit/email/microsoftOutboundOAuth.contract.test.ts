import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Microsoft outbound OAuth contract', () => {
  it('uses the common email scope set for authorization, token exchange, and refresh', () => {
    const callback = readFileSync(
      resolve(process.cwd(), 'src/app/api/auth/microsoft/callback/route.ts'),
      'utf8'
    );
    const adapter = readFileSync(
      resolve(process.cwd(), '../shared/services/email/providers/MicrosoftGraphAdapter.ts'),
      'utf8'
    );
    const scopes = readFileSync(
      resolve(process.cwd(), '../shared/services/email/microsoftGraphEndpoints.ts'),
      'utf8'
    );

    expect(scopes).toContain("'https://graph.microsoft.com/Mail.Send'");
    expect(callback).toContain("scope: MICROSOFT_EMAIL_OAUTH_SCOPES.join(' ')");
    expect(adapter).toContain("scope: MICROSOFT_EMAIL_OAUTH_SCOPES.join(' ')");
  });
});
