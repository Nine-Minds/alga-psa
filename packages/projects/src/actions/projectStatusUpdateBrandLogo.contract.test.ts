import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectStatusUpdateActions.ts'), 'utf8');

/**
 * The status update renders a tenant template and hands it to the provider
 * without passing through BaseEmailService, where the rest of the outbound
 * paths get their logo embedded. A branded row references the logo by
 * content-id, so skipping the pass here would mail a dangling `cid:`.
 */
describe('project status update brand logo contract', () => {
  it('embeds the branded logo before handing the message to the provider', () => {
    expect(source).toContain("import { embedBrandLogo, SystemEmailProviderFactory, resolveTenantCompanyName } from '@alga-psa/email'");
    expect(source).toContain('const branded = await embedBrandLogo(html, {');
    expect(source).toContain('html: branded.html,');
    expect(source).toContain('attachments: branded.attachments.length > 0 ? branded.attachments : undefined,');

    expect(source.indexOf('await embedBrandLogo(')).toBeLessThan(source.indexOf('await emailProvider.sendEmail('));
  });

  it('never sends the unembedded HTML', () => {
    const message = source.slice(source.indexOf('const message: EmailMessage = {'));

    expect(message.slice(0, message.indexOf('};'))).not.toMatch(/^\s*html,$/m);
  });
});
