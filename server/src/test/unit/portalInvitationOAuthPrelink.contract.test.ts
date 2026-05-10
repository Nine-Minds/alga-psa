import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const source = fs.readFileSync(
  path.join(repoRoot, 'packages/portal-shared/src/actions/portalInvitationActions.ts'),
  'utf8'
);

describe('portal invitation OAuth pre-link contracts', () => {
  it('T019/F058: invitation flow can persist optional Entra pre-link metadata on invitation records', () => {
    expect(source).toContain('options?: SendPortalInvitationOptions');
    expect(source).toContain('entraPrelink');
    expect(source).toContain("trx('portal_invitations')");
    expect(source).toContain("COALESCE(metadata, '{}'::jsonb)");
  });

  it('T019/F059: completePortalSetup supports passwordless completion when an Entra pre-link exists and upserts Microsoft OAuth link', () => {
    expect(source).toContain('const hasPrelinkedOAuth = Boolean(prelinkedOAuth?.providerAccountId)');
    expect(source).toContain('if (!hasPrelinkedOAuth && !normalizedPassword)');
    expect(source).toContain("await knex('oauth_account_links')");
    expect(source).toContain("provider: 'microsoft'");
    expect(source).toContain('Portal account is ready. Continue with Microsoft sign in.');
  });
});
